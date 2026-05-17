/**
 * Minimal in-memory rate limiter — fixed-window counter per bucket
 * key. Suitable for unauthenticated endpoints (unlock, rekey) where
 * we want to slow down brute-force attempts without bringing in a
 * dependency or a backing store.
 *
 * Limitations the operator should know about:
 *   - In-memory only. State resets when the process restarts. For a
 *     self-hosted single-tenant app behind a firewall this is fine;
 *     a determined offline attacker could just kill and restart the
 *     container. The deterrent value is against accidental
 *     password-typo bursts + casual scripted scans, not state
 *     actors.
 *   - Fixed-window, not token-bucket: simpler to reason about,
 *     "spike then 0" rather than a smooth refill. The window size
 *     should match the cadence you actually expect — N attempts in
 *     M seconds, then wait M to reset.
 *   - Per-key buckets. The caller decides what to key on (IP,
 *     route, route+IP). On a household app with a single user the
 *     simplest sensible default is the route name (global bucket
 *     per route).
 *
 * Returns `{ ok: true }` to proceed or `{ ok: false, retryAfter }`
 * where `retryAfter` is the integer seconds the caller should set
 * in the `Retry-After` response header.
 */

interface BucketEntry {
  count: number;
  /** ms epoch when the current window opened. */
  openedAt: number;
}

interface RateLimitOptions {
  /** Max attempts allowed in one window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

const buckets = new Map<string, BucketEntry>();

export interface RateLimitOk {
  ok: true;
}
export interface RateLimitDenied {
  ok: false;
  retryAfter: number;
}

export function rateLimit(
  key: string,
  opts: RateLimitOptions,
): RateLimitOk | RateLimitDenied {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || now - existing.openedAt >= opts.windowMs) {
    buckets.set(key, { count: 1, openedAt: now });
    return { ok: true };
  }
  if (existing.count < opts.max) {
    existing.count += 1;
    return { ok: true };
  }
  const retryAfterMs = opts.windowMs - (now - existing.openedAt);
  return { ok: false, retryAfter: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
}

/** Manually clear a bucket. Used by callers that want to reset the
 *  counter after a successful attempt — otherwise a legit user who
 *  fat-fingered five times then got it right would still hit the
 *  limit on their next reasonable attempt. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Test-only: drop every bucket so a unit test starts clean. */
export function __resetAllRateLimits(): void {
  buckets.clear();
}
