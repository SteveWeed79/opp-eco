/**
 * Rate limiting.
 *
 * Server Actions accept direct POSTs, so nothing but this bounds how fast
 * someone can call one. The two shapes that matter here are brute force
 * against sign-on and enumeration against anything that takes an identifier —
 * an attacker who can call `bookInterviewSlot` ten thousand times learns which
 * application ids exist from which errors come back.
 *
 * Deliberately in-memory. That means the limit is **per server instance**, so
 * on Vercel it degrades as functions scale out. A real deployment swaps the
 * store for Redis or Vercel KV; the interface below does not change. Saying
 * that plainly is better than pretending a per-instance counter is a
 * distributed rate limit.
 */

export interface RateLimitStore {
  /** Record a hit and return how many are in the current window. */
  hit(key: string, windowMs: number): { count: number; resetAt: number };
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function createMemoryStore(): RateLimitStore {
  const buckets = new Map<string, Bucket>();

  return {
    hit(key, windowMs) {
      const now = Date.now();
      const existing = buckets.get(key);

      if (!existing || existing.resetAt <= now) {
        const bucket = { count: 1, resetAt: now + windowMs };
        buckets.set(key, bucket);
        // Opportunistic sweep. Without it a long-lived process accumulates a
        // bucket per key seen, which is itself a slow memory exhaustion.
        if (buckets.size > 10_000) {
          for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
        }
        return { count: 1, resetAt: bucket.resetAt };
      }

      existing.count += 1;
      return { count: existing.count, resetAt: existing.resetAt };
    },
  };
}

const defaultStore = createMemoryStore();

export interface RateLimit {
  /** Requests permitted per window. */
  limit: number;
  windowMs: number;
}

/** Sign-on is the brute-force target; everything else is abuse prevention. */
export const LIMITS = {
  signIn: { limit: 10, windowMs: 60_000 },
  mutation: { limit: 30, windowMs: 60_000 },
  read: { limit: 300, windowMs: 60_000 },
} satisfies Record<string, RateLimit>;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Check and record a request.
 *
 * `key` should combine the action with something identifying the caller — a
 * session id where one exists, an address otherwise. Never the raw identifier
 * being operated on, or a caller could evade the limit by varying it.
 */
export function checkRateLimit(
  key: string,
  limit: RateLimit = LIMITS.mutation,
  store: RateLimitStore = defaultStore,
): RateLimitResult {
  const { count, resetAt } = store.hit(key, limit.windowMs);
  const remaining = Math.max(0, limit.limit - count);
  return {
    ok: count <= limit.limit,
    remaining,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
  };
}

/**
 * A caller identity for rate limiting.
 *
 * Falls back to a shared bucket when nothing identifies the caller, which is
 * blunt but fails closed — an unidentifiable flood is throttled rather than
 * waved through.
 */
export function callerKey(action: string, identity: string | null): string {
  return `${action}:${identity ?? "anonymous"}`;
}
