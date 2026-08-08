import { cookies } from "next/headers";
import type { ActorContext, ActorRole } from "@/domain/types";
import { contextFor, demoAccounts } from "@/data/session";

/**
 * Session resolution.
 *
 * The single place the application asks "who is calling?". Pages and Server
 * Actions read from here rather than reaching into the demo fixtures, so
 * replacing simulated sign-on with a real provider changes this file and
 * nothing else.
 *
 * The shape is already the real one: a request resolves to a session, a
 * session resolves to a membership, and a membership carries the role and
 * market that every repository read is scoped by. Only the *resolution* is
 * faked — there is no credential to verify.
 */

export const SESSION_COOKIE = "oe_demo_role";

/**
 * What a real provider would implement. Auth.js, Clerk, and WorkOS all reduce
 * to this: turn an incoming request into an actor, or into nothing.
 */
export interface SessionProvider {
  readonly name: string;
  resolve(): Promise<ActorContext | null>;
}

/**
 * Reads the role chosen at sign-on from a cookie.
 *
 * Returns null when nothing is signed in, which is the honest answer — the
 * caller decides what to do about it, rather than this silently inventing an
 * identity.
 */
export const demoSessionProvider: SessionProvider = {
  name: "demo-cookie",
  async resolve() {
    const store = await cookies();
    const role = store.get(SESSION_COOKIE)?.value;
    if (!role || !isActorRole(role)) return null;
    return contextFor(role);
  },
};

let provider: SessionProvider = demoSessionProvider;

/** Swap the provider — used by tests, and by whatever replaces the demo. */
export function setSessionProvider(next: SessionProvider) {
  provider = next;
}

export function currentProvider(): SessionProvider {
  return provider;
}

export async function getActor(): Promise<ActorContext | null> {
  return provider.resolve();
}

/**
 * The actor for a portal page.
 *
 * Falls back to the portal's own role when nothing is signed in, because this
 * is a demonstration where every screen must be reachable from a bare link.
 * A real deployment replaces the fallback with `unauthorized()` — the call
 * site does not change, which is the point of routing through here.
 */
export async function actorForPortal(portal: ActorRole): Promise<ActorContext> {
  const session = await getActor();
  if (session && canView(session, portal)) return session;
  return contextFor(portal);
}

/**
 * Whether an actor may view a portal. A person can hold several memberships,
 * so this is a membership question rather than an equality check — and it is
 * the seam where multi-role users plug in.
 */
export function canView(actor: ActorContext, portal: ActorRole): boolean {
  // Administrators are the only cross-market role and may view any portal,
  // which is how they unstick work on someone else's behalf.
  return actor.membership.role === portal || actor.membership.role === "admin";
}

export function isActorRole(value: string): value is ActorRole {
  return demoAccounts.some((account) => account.role === value);
}
