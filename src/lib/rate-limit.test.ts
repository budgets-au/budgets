import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAllRateLimits, rateLimit, resetRateLimit } from "./rate-limit";

describe("rateLimit (fixed-window counter)", () => {
  beforeEach(() => {
    __resetAllRateLimits();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetAllRateLimits();
  });

  it("first call in a fresh window is always allowed", () => {
    expect(rateLimit("k1", { max: 3, windowMs: 1000 })).toEqual({ ok: true });
  });

  it("allows up to `max` calls within one window, denies the next", () => {
    const opts = { max: 3, windowMs: 1000 };
    expect(rateLimit("k1", opts).ok).toBe(true);
    expect(rateLimit("k1", opts).ok).toBe(true);
    expect(rateLimit("k1", opts).ok).toBe(true);
    const denied = rateLimit("k1", opts);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.retryAfter).toBeGreaterThanOrEqual(1);
    }
  });

  it("buckets are per-key — denying one doesn't deny another", () => {
    const opts = { max: 1, windowMs: 1000 };
    expect(rateLimit("alice", opts).ok).toBe(true);
    expect(rateLimit("alice", opts).ok).toBe(false);
    expect(rateLimit("bob", opts).ok).toBe(true);
  });

  it("window resets after windowMs elapses", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const opts = { max: 1, windowMs: 1000 };
    expect(rateLimit("k", opts).ok).toBe(true);
    expect(rateLimit("k", opts).ok).toBe(false);
    // Advance past the window — next call opens a fresh bucket.
    vi.setSystemTime(new Date("2026-01-01T00:00:02Z"));
    expect(rateLimit("k", opts).ok).toBe(true);
  });

  it("retryAfter is the remaining seconds in the current window, rounded up", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const opts = { max: 1, windowMs: 10_000 };
    expect(rateLimit("k", opts).ok).toBe(true);
    // 3 s into a 10 s window; denied call should report ~7 s left.
    vi.setSystemTime(new Date("2026-01-01T00:00:03Z"));
    const denied = rateLimit("k", opts);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.retryAfter).toBe(7);
    }
  });

  it("resetRateLimit clears a single bucket", () => {
    const opts = { max: 1, windowMs: 1000 };
    expect(rateLimit("k", opts).ok).toBe(true);
    expect(rateLimit("k", opts).ok).toBe(false);
    resetRateLimit("k");
    expect(rateLimit("k", opts).ok).toBe(true);
  });
});
