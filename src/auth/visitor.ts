/**
 * Whether this request is an anonymous visitor walking the demonstration.
 *
 * A signed-out caller reaching a portal is handed the demonstration's own
 * account, so the prototype stays walkable from a bare link. That account is a
 * working actor, which is the point for reads — and exactly the problem for
 * writes: on a deployment that authenticates, a write made through it is an
 * anonymous write to a production database.
 *
 * So the session layer says when it has done that, and the store refuses.
 *
 * **Why a flag rather than asking who is signed in.** The store is the only
 * layer every write passes through — `readOnlyStore` is there for the same
 * reason — but it cannot call `getActor`, which reads cookies and therefore
 * needs a request. Every service test drives the real store outside one, so a
 * guard that asked would fail 118 of them, and a guard that swallowed the
 * failure would be one that fails open.
 *
 * **Why this is request-scoped and not module state.** `cache` is React's
 * per-request memo, so each request gets its own object and two visitors
 * cannot see each other's flag. Outside a request — a unit test — it simply
 * calls the factory, which returns a fresh `false`. That is not a loophole:
 * a test has no anonymous visitor in it.
 */

import { cache } from "react";

const state = cache(() => ({ anonymous: false }));

/** Called when the session layer hands out the demonstration's own account. */
export function markAnonymousVisitor(): void {
  state().anonymous = true;
}

export function isAnonymousVisitor(): boolean {
  return state().anonymous;
}
