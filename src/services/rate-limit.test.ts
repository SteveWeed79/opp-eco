import { describe, it, expect } from "vitest";
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
    const store = createMemoryStore();
    const limit = { limit: 1, windowMs: 1 };
    expect(checkRateLimit("k", limit, store).ok).toBe(true);
    expect(checkRateLimit("k", limit, store).ok).toBe(false);

    const later = Date.now() + 10;
    const original = Date.now;
    Date.now = () => later;
    try {
      expect(checkRateLimit("k", limit, store).ok).toBe(true);
    } finally {
      Date.now = original;
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
