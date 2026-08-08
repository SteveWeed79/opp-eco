import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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

/** Where each role's own portal lives. */
export const PORTAL_PATH: Record<ActorRole, string> = {
  admin: "/admin",
  student: "/student",
  business: "/business",
  college: "/college",
  board: "/board",
};

/**
 * The actor for a portal page.
 *
 * Three cases, in order:
 *
 *  - **Signed in, and this is your portal.** You get your own session.
 *  - **Signed in as somebody else.** Redirected to your own portal. Previously
 *    an administrator's session was handed to any portal it asked for, on the
 *    theory that unsticking work means seeing what others see. It does not:
 *    every portal reads `membership.organizationId` and `membership.marketId`,
 *    and an administrator holds neither, so all four non-admin portals threw
 *    on a null dereference and rendered the error boundary. The administrator
 *    already sees every market through the admin console, which is the read
 *    path built for the purpose and the one that redacts.
 *  - **Signed out.** Falls back to the portal's own demo account, because this
 *    is a demonstration where every screen must be reachable from a bare link.
 *    A real deployment replaces that fallback with `unauthorized()`.
 */
export async function actorForPortal(portal: ActorRole): Promise<ActorContext> {
  const session = await getActor();
  if (session) {
    if (canView(session, portal)) return session;
    // Not `contextFor(portal)`: silently rendering someone else's portal under
    // a header that still says "Signed in as Steve Weed" is worse than the
    // crash it replaces.
    redirect(PORTAL_PATH[session.membership.role]);
  }
  return contextFor(portal);
}

/**
 * Whether an actor may view a portal.
 *
 * A person can hold several memberships, so this is a membership question
 * rather than an equality check — and it is the seam where multi-role users
 * plug in.
 *
 * Administrators are deliberately **not** exempt. Cross-market oversight is a
 * property of the admin console's queries, not a licence to inhabit a
 * student's session; the difference matters for a system holding education
 * records, where "who can see this" has to survive being asked by a regulator.
 */
export function canView(actor: ActorContext, portal: ActorRole): boolean {
  return actor.membership.role === portal;
}

export function isActorRole(value: string): value is ActorRole {
  return demoAccounts.some((account) => account.role === value);
}
