/**
 * Who someone is, and what it takes to prove it.
 *
 * Sign-on used to be a cookie holding a role string: you asked to be a board
 * officer and you were one. Everything downstream of it was already the real
 * shape — a session resolves to a membership, the membership carries the role
 * and market every read is scoped by — so this file replaces the one part that
 * was theatre.
 *
 * Three rules shape it, and the first two come from the data rules rather than
 * from any general idea about authentication:
 *
 *  1. **No password, for anyone.** There is no credential field in the schema.
 *     One set of users here are public employees, and the rule for their
 *     identity is to federate it and never replicate it — so the platform holds
 *     nothing that could be replayed, phished or dumped.
 *  2. **A government organization can be locked to its own identity provider**,
 *     and until one is wired that means locked out. See `IdentityMode`.
 *  3. **Privileged sessions are short.** An administrator and a board officer
 *     see cross-market data and move public money; a student sees their own
 *     applications. The same session lifetime for both is a decision nobody
 *     would defend out loud.
 */

import type { ActorRole, IdentityMode, Organization, Session } from "./types";

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/**
 * The alphabet a code is drawn from.
 *
 * No `0`, `O`, `1`, `I` or `L`. People read these off a phone and type them
 * into a laptop, and a code that is ambiguous in a sans-serif font produces
 * failed attempts that look exactly like an attack.
 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Eight characters from a 31-symbol alphabet — about 39 bits. */
export const CODE_LENGTH = 8;

/**
 * Ten minutes.
 *
 * Long enough to fetch a phone, short enough that an unconsumed code sitting in
 * a mailbox is not a standing key to somebody's account.
 */
export const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Five guesses, then the code is dead.
 *
 * With 39 bits of entropy the attempt limit is not what stops brute force —
 * the entropy is. It is what stops a code being ground down by someone who has
 * seen part of it, and it bounds the damage of a weaker alphabet if anyone ever
 * shortens one of these.
 */
export const CODE_MAX_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionLifetime {
  /** Hard stop from creation, whatever the person is doing. */
  absoluteMs: number;
  /** Stop after this long without a request. */
  idleMs: number;
}

/**
 * How long a session lasts, by what the role can do with it.
 *
 * The administrator and the board are the privileged tier: cross-market reads,
 * eligibility determinations, and money. A shared laptop in a workforce office
 * left signed in overnight is the realistic threat, and the idle window is what
 * addresses it.
 *
 * A student's session is long because the alternative is a learner being asked
 * to check their email again in the middle of logging a timesheet — friction
 * that lands on the party with the least reason to tolerate it and the least
 * to compromise.
 */
const LIFETIMES: Record<ActorRole, SessionLifetime> = {
  admin: { absoluteMs: 8 * 3_600_000, idleMs: 30 * 60_000 },
  board: { absoluteMs: 8 * 3_600_000, idleMs: 30 * 60_000 },
  college: { absoluteMs: 12 * 3_600_000, idleMs: 2 * 3_600_000 },
  business: { absoluteMs: 12 * 3_600_000, idleMs: 2 * 3_600_000 },
  student: { absoluteMs: 24 * 3_600_000, idleMs: 4 * 3_600_000 },
};

export function sessionLifetimeFor(role: ActorRole): SessionLifetime {
  return LIFETIMES[role];
}

/** Roles whose sessions are deliberately shortest. Named so a test can say so. */
export function isPrivileged(role: ActorRole): boolean {
  return role === "admin" || role === "board";
}

/**
 * Whether a session is still good, and if not, why.
 *
 * Both windows are checked here rather than at the call site, because "expired"
 * has two meanings and a caller that checked only one would hold a session open
 * forever on a machine nobody had touched since Friday.
 */
export function sessionState(
  session: Session,
  role: ActorRole,
  now: Date,
): "active" | "revoked" | "expired" | "idle" {
  if (session.revokedAt) return "revoked";

  const at = now.getTime();
  if (new Date(session.expiresAt).getTime() <= at) return "expired";

  const { idleMs } = sessionLifetimeFor(role);
  if (new Date(session.lastSeenAt).getTime() + idleMs <= at) return "idle";

  return "active";
}

// ---------------------------------------------------------------------------
// Who may sign in, and how
// ---------------------------------------------------------------------------

/** Normalised for comparison. Addresses are case-insensitive in practice. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function domainOf(email: string): string {
  const at = normaliseEmail(email).lastIndexOf("@");
  return at === -1 ? "" : normaliseEmail(email).slice(at + 1);
}

/**
 * Whether an address is on one of an organization's declared work domains.
 *
 * Subdomains count — `wioa.sekwp.example.org` is the board's, and an agency
 * that runs its mail on a subdomain should not have to enumerate them. An
 * organization declaring no domains accepts whatever address is already on the
 * user record, which is the state every organization starts in.
 */
export function addressMatchesOrganization(
  email: string,
  organization: Pick<Organization, "emailDomains">,
): boolean {
  if (organization.emailDomains.length === 0) return true;
  const domain = domainOf(email);
  return organization.emailDomains.some(
    (allowed) =>
      domain === allowed.toLowerCase() || domain.endsWith(`.${allowed.toLowerCase()}`),
  );
}

/**
 * Why this organization's people cannot sign in through the platform's own
 * path, or null.
 *
 * The federated case is the one that matters. It is not a fallback to something
 * else — no adapter ships — so an organization marked `federated` genuinely
 * cannot sign in here. That is the whole intent: a workforce board's officers
 * are public employees, their agency owns their identity, and the platform
 * issuing them one of its own would be replicating exactly what the data rules
 * say to federate. Locked out is the right answer until the IdP is wired.
 */
export function signInBlockReason(
  organization: Pick<Organization, "name" | "identityMode" | "emailDomains" | "status">,
  email: string,
): string | null {
  if (organization.identityMode === "federated") {
    return `${organization.name} signs in through its own identity provider. This platform does not issue credentials for it.`;
  }
  if (organization.status === "suspended" || organization.status === "rejected") {
    return `${organization.name} is not currently taking part in the program.`;
  }
  if (!addressMatchesOrganization(email, organization)) {
    // Named rather than blurred into "unknown account", because the person
    // typing a personal address needs to know to use their work one — and the
    // account already exists, so this leaks nothing they could not confirm by
    // trying their work address instead.
    return `Sign in with your ${organization.name} work address.`;
  }
  return null;
}

/**
 * The mode an organization should start in.
 *
 * Boards default to `federated`, which is the claim this whole file is about:
 * a government organization is locked to its own identity provider unless
 * somebody deliberately says otherwise. Everything else starts on email codes,
 * which is what a small employer or a college department can actually use on
 * the day they join.
 */
export function defaultIdentityMode(kind: Organization["kind"]): IdentityMode {
  return kind === "board" ? "federated" : "email_code";
}
