import { test, expect } from "@playwright/test";

/** E2E coverage for the wrong-passphrase rate-limit on /api/unlock
 *  (#32). Pin the contract added in 0.144:
 *
 *   - The unlock endpoint enforces a 5-attempts-per-60s window per
 *     process. After the budget is consumed, further attempts
 *     return 429 with a `Retry-After` header and a friendly
 *     error body — even if the supplied passphrase would
 *     otherwise have been valid.
 *
 *  Practical realities the spec works around:
 *
 *   - The window is process-global. Anything else in the e2e
 *     suite that hits /api/unlock (lockUnlockRoundTrip goal,
 *     login flow's unlock branch) consumes the same budget. So
 *     the spec doesn't pin "the Nth attempt is rate-limited" —
 *     it fires enough wrong-passphrase attempts to drive past
 *     any plausible starting budget and asserts that AT LEAST
 *     ONE 429 fires.
 *   - The 429 body carries a `Retry-After` header per spec; the
 *     spec asserts the header is a positive integer.
 *   - The 429 body shape is `{ ok: false, error: "Too many ..." }`;
 *     the spec checks both fields.
 *
 *  No teardown — this spec deliberately leaves the rate-limit
 *  budget consumed; any spec that follows and needs unlock will
 *  wait out the window or run in a fresh process. The e2e
 *  workers:1 config keeps that deterministic. */

test.describe("unlock rate-limit (#32)", () => {
  test("rapid wrong-passphrase attempts trigger 429 + Retry-After", async ({
    request,
  }) => {
    test.setTimeout(60_000);

    // Fire 10 wrong-passphrase attempts back-to-back. The budget is
    // 5/60s; even if previous specs have already burned some, 10
    // attempts is enough to drive the bucket empty and observe the
    // 429 transition. `request` is the fresh context-less driver —
    // no NextAuth session needed, the unlock endpoint is auth-free
    // by design.
    let saw429 = false;
    let retryAfter = "";
    let body429: { ok?: boolean; error?: string } | null = null;

    for (let i = 0; i < 10; i += 1) {
      const res = await request.post("/api/unlock", {
        data: { passphrase: `wrong-passphrase-attempt-${i}` },
      });
      if (res.status() === 429) {
        saw429 = true;
        retryAfter = res.headers()["retry-after"] ?? "";
        body429 = (await res.json()) as {
          ok?: boolean;
          error?: string;
        };
        break;
      }
      // Otherwise the route returned 400 (bad passphrase / not
      // dbExists yet) — that's a valid pre-429 state. Drain the
      // body to free the connection and continue.
      await res.body().catch(() => null);
    }

    expect(saw429).toBe(true);
    expect(body429?.ok).toBe(false);
    expect(body429?.error).toMatch(/too many.*try again/i);

    // Retry-After must be a positive integer (seconds). The route
    // sources it from the rate-limit's remaining window — never
    // negative, never zero (the rate-limit returns the rounded-up
    // window remainder).
    const retryAfterNum = Number.parseInt(retryAfter, 10);
    expect(Number.isFinite(retryAfterNum)).toBe(true);
    expect(retryAfterNum).toBeGreaterThan(0);
    expect(retryAfterNum).toBeLessThanOrEqual(60);
  });
});
