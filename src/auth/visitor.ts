/**
 * Whether this request is an anonymous visitor walking the demonstration.
 *
 * A signed-out caller reaching a portal is handed the demonstration's own
 * account, so the prototype stays walkable from a bare link. That account is a
 * working actor, which is the point for reads and exactly the problem for
 * writes: on a deployment that authenticates, a write made through it is an
 * anonymous write to a database that also holds real programmes.
 *
 * Two conditions, and both matter:
 *
 *  - **The deployment authenticates.** On the demonstration's own deployment
 *    writes stay open — separate database, disposable, and clicking through it
 *    is the entire point. `writes.spec.ts` applies to a posting from a bare
 *    link without signing on, and a prototype nobody can click is a screenshot.
 *  - **Nobody is signed in.** A visitor has no session; the fallback account is
 *    minted per request and never stored.
 *
 * **This was a request-scoped flag and that was wrong.** The first version had
 * the session layer set a `cache()`-backed boolean when it handed out the
 * fallback, and the store read it. It worked in a page render and silently did
 * not in a Server Action — the two are separate requests, and the flag set
 * while rendering is not the flag read while acting. A browser driving the
 * Apply button wrote a real row to Postgres and the guard never fired. Derived
 * from the request rather than remembered about it, so there is no window
 * between setting and reading for the answer to get lost in.
 *
 * The mode check comes first deliberately: with `AUTH_MODE` unset — every unit
 * test, and the demonstration's own deployment — this returns false without
 * ever reaching for a cookie, so nothing outside a request has to pretend to be
 * in one.
 */

import { anonymousFallbackAllowed } from "./config";

export async function isDemonstrationVisitor(): Promise<boolean> {
  if (anonymousFallbackAllowed()) return false;

  // Imported here rather than at module scope because `@/data/backend` reads
  // this module back, and because a module on the path of every request should
  // not pull the session resolver in behind it.
  const { getActor } = await import("./session");
  return (await getActor()) === null;
}
