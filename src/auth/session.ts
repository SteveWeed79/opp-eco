import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ActorContext, ActorRole } from "@/domain/types";
import { contextFor, demoAccounts } from "@/data/session";
import { PORTAL_PATH, SIGN_IN_PATH } from "@/routes";
import { anonymousFallbackAllowed, authConfig } from "./config";

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
 * The real session cookie, holding an opaque token.
 *
 * A different name from the demo cookie on purpose. Switching a deployment from
 * the role picker to real sign-on must not leave a browser presenting the
 * string "board" to a resolver that now expects a token — one name for two
 * meanings is how a mode switch becomes an authentication bug.
 */
export const AUTH_COOKIE = "oe_session";

/**
 * Somebody between the two factors.
 *
 * A different name from the session cookie on purpose, and holding a value that
 * resolves to nothing: `codeSessionProvider` looks up `oe_session` and knows
 * nothing about this one, so a challenge token presented as a session is simply
 * not a session. One name for two meanings is how a half-finished sign-in
 * becomes a finished one.
 */
export const MFA_COOKIE = "oe_mfa";

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

/**
 * Real sign-on: an opaque token resolved against a server-side session.
 *
 * Deliberately the same interface as the demo provider. That is the seam the
 * original file promised — "replacing simulated sign-on touches this and
 * nothing else" — and this is it being cashed in.
 */
export const codeSessionProvider: SessionProvider = {
  name: "email-code",
  async resolve() {
    const store = await cookies();
    const token = store.get(AUTH_COOKIE)?.value;
    if (!token) return null;
    const { resolveSessionToken } = await import("@/services/auth");
    return resolveSessionToken(token);
  },
};

function providerForMode(): SessionProvider {
  return authConfig().mode === "code" ? codeSessionProvider : demoSessionProvider;
}

let provider: SessionProvider | null = null;

/** Swap the provider — used by tests, and by whatever replaces the demo. */
export function setSessionProvider(next: SessionProvider | null) {
  provider = next;
}

export function currentProvider(): SessionProvider {
  provider ??= providerForMode();
  return provider;
}

/**
 * Who is calling, resolved once per request.
 *
 * Memoized, because a single portal render asks four times over — the root
 * layout for the masthead and theme, the segment layout for the gate, the page
 * for its scoping, and the page again to decide what is linkable. Each ask is
 * four round trips and a write to the session's last-seen stamp, so without
 * this the cheapest page in the application does sixteen queries to answer one
 * question. React's `cache` is scoped to the request, so signing in during one
 * and reading in the next still sees the new session.
 */
export const getActor = cache(
  async (): Promise<ActorContext | null> => currentProvider().resolve(),
);

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
 *  - **Signed out.** Under real sign-on, redirected to sign in. Under the demo
 *    it falls back to the portal's own account, because a demonstration has to
 *    be walkable from a bare link — see `anonymousFallbackAllowed`.
 *
 * **Call this from the segment's `layout`, not only its `page`.** Every portal
 * has a `loading.tsx`, which wraps the page in a Suspense boundary; by the time
 * a component inside that boundary runs, the response has committed and begun
 * streaming, and Next can no longer answer with a 307. It appends a client-side
 * navigation instead — a browser flicks to the sign-in page, but the status is
 * 200 and the shell has already gone out on the wire. A layout renders above
 * its own loading boundary, so the same call there refuses before anything is
 * flushed. `src/auth/portal-layout.tsx` is that gate; the pages still call this
 * as well, because they need the actor and because a check that disappears when
 * one file is deleted is not a check.
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
  if (!anonymousFallbackAllowed()) redirect(SIGN_IN_PATH);
  return contextFor(portal);
}

/**
 * The actor for a page that is not a portal.
 *
 * An opportunity listing belongs to no single role — a student reads it to
 * decide whether to apply, a college reads it to review it, an employer reads
 * their own and their competitors'. So it cannot use `actorForPortal`, which
 * would redirect four roles in five away from a link they were sent.
 *
 * Signed out falls back to the demo student, for the same reason the portals
 * do: this is a demonstration and every screen has to be reachable from a bare
 * link. Scoping still applies — the fallback is a real actor context with a
 * market and a role, not an exemption from the repository rules.
 */
export async function viewerActor(): Promise<ActorContext> {
  const session = await getActor();
  if (session) return session;
  if (!anonymousFallbackAllowed()) redirect(SIGN_IN_PATH);
  return contextFor("student");
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
