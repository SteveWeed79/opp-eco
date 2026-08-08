import { describe, it, expect, vi } from "vitest";
import {
  callerKey,
  checkRateLimit,
  createMemoryStore,
  LIMITS,
} from "./rate-limit";

describe("rate limiting", () => {
  it("allows requests up to the limit", () => {
    const store = createMemoryStore();
    const limit = { limit: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit("k", limit, store).ok).toBe(true);
    }
  });

  it("refuses the request after the limit", () => {
    const store = createMemoryStore();
    const limit = { limit: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) checkRateLimit("k", limit, store);
    expect(checkRateLimit("k", limit, store).ok).toBe(false);
  });

  it("reports how long to wait", () => {
    const store = createMemoryStore();
    const limit = { limit: 1, windowMs: 60_000 };
    checkRateLimit("k", limit, store);
    const blocked = checkRateLimit("k", limit, store);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("keeps separate callers in separate buckets", () => {
    const store = createMemoryStore();
    const limit = { limit: 1, windowMs: 60_000 };
    expect(checkRateLimit("a", limit, store).ok).toBe(true);
    // One caller exhausting their bucket must not block anyone else.
    expect(checkRateLimit("b", limit, store).ok).toBe(true);
  });

  it("keeps separate actions in separate buckets", () => {
    const store = createMemoryStore();
    const limit = { limit: 1, windowMs: 60_000 };
    checkRateLimit(callerKey("signIn", "u-1"), limit, store);
    expect(checkRateLimit(callerKey("book", "u-1"), limit, store).ok).toBe(true);
  });

  it("resets once the window elapses", () => {
    // The clock is controlled for the whole test, not just the last third.
    //
    // This previously used `windowMs: 1` and let the first two calls run on
    // the real clock, which quietly assumed both landed inside the same
    // millisecond. They did locally and did not on a loaded CI runner: the
    // bucket expired between them, the limiter correctly allowed the second
    // request, and the test failed for being wrong rather than the code being
    // broken. A window measured in milliseconds is not a realistic limit
    // anyway — the real ones are a minute.
    vi.useFakeTimers();
    try {
      const store = createMemoryStore();
      const limit = { limit: 1, windowMs: 60_000 };

      expect(checkRateLimit("k", limit, store).ok).toBe(true);
      expect(checkRateLimit("k", limit, store).ok).toBe(false);

      // Just past the window, so the next request opens a fresh bucket.
      vi.advanceTimersByTime(60_001);
      expect(checkRateLimit("k", limit, store).ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the limit for the whole window, not just the first moment", () => {
    // The complement of the test above: advancing partway through must *not*
    // reset the bucket. Without this, a limiter that reset on any clock
    // movement would still pass the reset test.
    vi.useFakeTimers();
    try {
      const store = createMemoryStore();
      const limit = { limit: 1, windowMs: 60_000 };

      expect(checkRateLimit("k", limit, store).ok).toBe(true);
      vi.advanceTimersByTime(59_000);
      expect(checkRateLimit("k", limit, store).ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares one bucket for unidentified callers, failing closed", () => {
    const store = createMemoryStore();
    const limit = { limit: 1, windowMs: 60_000 };
    expect(checkRateLimit(callerKey("signIn", null), limit, store).ok).toBe(true);
    // A second anonymous caller lands in the same bucket rather than a fresh
    // one, so a flood cannot evade the limit by staying unidentified.
    expect(checkRateLimit(callerKey("signIn", null), limit, store).ok).toBe(false);
  });

  it("sets sign-on tighter than ordinary mutations", () => {
    expect(LIMITS.signIn.limit).toBeLessThan(LIMITS.mutation.limit);
  });
});
