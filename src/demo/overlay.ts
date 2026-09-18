/**
 * What a visitor did while walking the demonstration, held in their own browser.
 *
 * The demonstration is browsable on a deployment that authenticates, and a
 * visitor holding the demonstration's own account may read with it but not
 * write — a write made through an account nobody authenticated for is an
 * anonymous write to a database that also holds real programmes. That left the
 * prototype honest and inert: a visitor could look at the Apply button and not
 * press it.
 *
 * So their actions live in a cookie instead, and the repositories render the
 * consequence. Nothing reaches the database, every visitor gets the
 * demonstration exactly as seeded, and clearing the cookie is the whole of the
 * wipe.
 *
 * **Intentions, not records.** The obvious design stores the application row.
 * A row is a few hundred bytes of ids, statuses and timestamps, and the whole
 * fixture set is 85KB — a cookie holds 4KB and is sent on every request, so
 * that design runs out almost immediately. What the visitor actually did is
 * `applied to p-apex-web`: twelve bytes, and the server already holds the
 * posting, the learner and the scoring function needed to derive the rest.
 * A hundred actions fit comfortably, which is far more than anyone clicks.
 *
 * **Why a cookie rather than localStorage.** Not size — 85KB fits in
 * localStorage a hundred times over. The portals are Server Components, so
 * whatever holds this has to be readable on the server, and a cookie is the
 * only browser store that is. Moving the demonstration into localStorage means
 * rendering it in the browser, which means a second data path through every
 * page, forever. The demonstration's most valuable property is that it is not a
 * copy of the product — it *is* the product, pointed at fixtures — and that is
 * not worth trading for storage nobody needs.
 */

import { cookies } from "next/headers";

export const DEMO_ACTIONS_COOKIE = "oe_demo_actions";

/**
 * A ceiling well under the 4KB a browser will accept.
 *
 * Reached only by someone clicking far past the point of being convinced, and
 * the failure is the oldest action falling off rather than a cookie the browser
 * silently refuses to store.
 */
export const MAX_ACTIONS = 100;

export interface DemoOverlay {
  /** Posting ids the visitor has applied to, oldest first. */
  applied: string[];
}

export const EMPTY: DemoOverlay = { applied: [] };

/**
 * `a=p-apex-web,p-frontier-clin`
 *
 * Deliberately not JSON. This is a cookie value, so every quote and brace costs
 * a URL-encoded triple, and the format has exactly one field to express.
 */
export function serialise(overlay: DemoOverlay): string {
  return overlay.applied.length ? `a=${overlay.applied.join(",")}` : "";
}

export function parse(value: string | undefined): DemoOverlay {
  if (!value) return EMPTY;
  const applied: string[] = [];
  for (const part of value.split(";")) {
    const [key, list] = part.split("=");
    if (key !== "a" || !list) continue;
    for (const id of list.split(",")) {
      // Ids only, and shaped like the ones this system mints. A cookie is
      // attacker-controlled: it decides what the visitor is shown and nothing
      // else, but it is still read into a query, so it does not get to carry
      // arbitrary text.
      if (/^[a-z0-9-]{1,64}$/i.test(id) && !applied.includes(id)) applied.push(id);
    }
  }
  return { applied: applied.slice(-MAX_ACTIONS) };
}

/** What this visitor has done, or nothing at all. */
export async function readOverlay(): Promise<DemoOverlay> {
  const store = await cookies();
  return parse(store.get(DEMO_ACTIONS_COOKIE)?.value);
}

/**
 * Record an action.
 *
 * `httpOnly` because nothing in the browser reads this — the server derives
 * everything from it. Session-scoped (no `maxAge`), so closing the tab is the
 * wipe and a visitor returning tomorrow meets the demonstration as seeded.
 */
export async function recordApplied(postingId: string): Promise<void> {
  const store = await cookies();
  const overlay = parse(store.get(DEMO_ACTIONS_COOKIE)?.value);
  if (overlay.applied.includes(postingId)) return;

  const next: DemoOverlay = {
    applied: [...overlay.applied, postingId].slice(-MAX_ACTIONS),
  };
  store.set(DEMO_ACTIONS_COOKIE, serialise(next), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}
