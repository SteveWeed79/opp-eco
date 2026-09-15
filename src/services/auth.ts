/**
 * Real sign-on: a one-time code to a work address, and a session held server
 * side.
 *
 * What this replaces was a cookie containing the string "board". Everything
 * downstream was already correct — a session resolves to a membership, the
 * membership carries the role and market every read is scoped by — so this is
 * the one piece that was theatre, and nothing above it changes.
 *
 * Three properties worth naming, because each is a decision rather than a
 * convention:
 *
 *  1. **Nothing here can be replayed.** The cookie holds a random token; the
 *     database holds its SHA-256. The mailbox holds a code; the database holds
 *     its SHA-256. A dump of either table yields nothing presentable.
 *  2. **A request for a code never says whether the account exists.** Sign-on
 *     is the one endpoint anyone can reach, and an honest "no such account" is
 *     a free directory of who takes part in this programme — including which
 *     public employees work on it.
 *  3. **Federated organizations are refused outright.** A workforce board's
 *     officers are public employees whose agency owns their identity. No SSO
 *     adapter ships, so they cannot sign in here at all, and that is correct:
 *     the alternative is this platform minting a credential for a government
 *     employee because it was easier than waiting for the IdP.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { ActorContext, Session, SignInCode } from "@/domain/types";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  normaliseEmail,
  sessionLifetimeFor,
  sessionState,
  signInBlockReason,
} from "@/domain/identity";
import { authStore } from "@/auth/backend";
import { authConfig } from "@/auth/config";
import { repositories } from "@/data/backend";
import { systemContext } from "@/auth/system";
import { resendChannel } from "@/services/email/resend";
import { emailConfig } from "@/services/email/config";
import { logger } from "@/services/logging";

export interface SignInDeps {
  now: () => Date;
  /** Injected so a test can assert on the code without reading a mailbox. */
  deliver: (to: string, code: string, expiresAt: Date) => Promise<void>;
}

/**
 * The generic answer to a code request.
 *
 * Returned whether or not the address matched anything, so the endpoint cannot
 * be used to enumerate accounts. The one exception is a *federated*
 * organization, which is told plainly — that is not a leak, because the person
 * needs to know to go to their agency's login, and an organization's identity
 * arrangement is not a secret about a person.
 */
export type SignInRequestResult =
  | { ok: true }
  | { ok: false; error: string };

export type SignInVerifyResult =
  | { ok: true; token: string; actor: ActorContext }
  | { ok: false; error: string };

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

/**
 * Compared in constant time.
 *
 * Both sides are fixed-length hex of the same hash, so the length check can
 * only fail on a malformed stored value — but `timingSafeEqual` throws on a
 * mismatch rather than returning false, so it is checked first.
 */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** `randomInt` rather than `%` on random bytes, which biases toward the low end. */
function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

async function deliverByEmail(to: string, code: string, expiresAt: Date): Promise<void> {
  const config = authConfig();
  const minutes = Math.round(CODE_TTL_MS / 60_000);

  if (config.echoCodes) {
    // Development only — `authConfig` refuses this in production. Logged rather
    // than returned, so no code path can leak it to a browser.
    logger.warn("auth.code_echoed", { to, code, expiresAt: expiresAt.toISOString() });
    return;
  }

  // Sent directly rather than through the notification outbox, and that is the
  // point: the outbox persists every payload and renders it on a screen. A code
  // is a bearer token for somebody's account and belongs in exactly one place.
  const channel = resendChannel("auth.sign_in_code", {}, emailConfig());
  await channel.send({
    recipientUserId: "auth",
    recipientEmail: to,
    subject: `Your sign-in code: ${code}`,
    body:
      `Use ${code} to sign in. It is good for ${minutes} minutes and can be used once.\n\n` +
      `If you did not ask to sign in, you can ignore this — somebody typed your address and got nothing else.`,
  });
}

const defaultDeps: SignInDeps = {
  now: () => new Date(),
  deliver: deliverByEmail,
};

/**
 * Ask for a code.
 *
 * The shape of the refusals is the interesting part. An unknown address, a
 * known address with no membership, and a suspended organization all return
 * success — because each of those answers, given honestly, tells a stranger
 * something about who is involved in this programme.
 */
export async function requestSignInCode(
  email: string,
  deps: SignInDeps = defaultDeps,
): Promise<SignInRequestResult> {
  const address = normaliseEmail(email);
  if (!address.includes("@")) {
    return { ok: false, error: "That does not look like an email address." };
  }

  const store = authStore();
  const user = await store.findUserByEmail(address);
  const membership = user ? await store.membershipForUser(user.id) : null;

  if (!user || !membership) {
    logger.info("auth.code_requested", { known: false });
    return { ok: true };
  }

  // The organization decides how its people sign in. Read through the system
  // context because there is no actor yet — this is the pre-auth plane.
  const organization = membership.organizationId
    ? await repositories.organizations.find(systemContext(), membership.organizationId)
    : null;

  if (organization) {
    const blocked = signInBlockReason(organization, address);
    if (blocked) {
      logger.info("auth.code_refused", {
        organizationId: organization.id,
        mode: organization.identityMode,
      });
      return { ok: false, error: blocked };
    }
  }

  const now = deps.now();
  const code = generateCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);

  const record: SignInCode = {
    userId: user.id,
    codeHash: sha256(code),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    attempts: 0,
    consumedAt: null,
  };

  await store.putSignInCode(record);
  await deps.deliver(user.email, code, expiresAt);

  logger.info("auth.code_requested", { known: true, userId: user.id });
  return { ok: true };
}

/**
 * Present a code, and get a session.
 *
 * A failed guess increments the attempt count and a spent code is dead, so the
 * window in which a code is worth anything is minutes wide and five guesses
 * deep. The generic error text is shared by every failure for the same reason
 * the request path is generic.
 */
export async function verifySignInCode(
  email: string,
  code: string,
  deps: SignInDeps = defaultDeps,
): Promise<SignInVerifyResult> {
  const generic = { ok: false as const, error: "That code is not valid. Ask for a new one." };

  const address = normaliseEmail(email);
  const store = authStore();
  const user = await store.findUserByEmail(address);
  if (!user) return generic;

  const record = await store.findSignInCode(user.id);
  if (!record || record.consumedAt) return generic;

  const now = deps.now();
  if (new Date(record.expiresAt).getTime() <= now.getTime()) return generic;
  if (record.attempts >= CODE_MAX_ATTEMPTS) return generic;

  if (!hashesMatch(record.codeHash, sha256(code.trim().toUpperCase()))) {
    await store.recordCodeAttempt(user.id, record.attempts + 1);
    logger.warn("auth.code_rejected", { userId: user.id, attempts: record.attempts + 1 });
    return generic;
  }

  const membership = await store.membershipForUser(user.id);
  if (!membership) return generic;

  // Spent before the session exists. A crash between the two leaves somebody
  // unable to sign in, which is recoverable; the other order leaves a code that
  // has already produced a session still usable.
  await store.consumeSignInCode(user.id, now.toISOString());

  // Every other session for this account goes. Signing in is the moment a
  // person can prove who they are, and it is the cheapest place to make a
  // stolen session on another machine stop working.
  await store.revokeSessionsForUser(user.id, now.toISOString());

  const token = randomBytes(32).toString("base64url");
  const { absoluteMs } = sessionLifetimeFor(membership.role);
  const session: Session = {
    id: sha256(token),
    userId: user.id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + absoluteMs).toISOString(),
    lastSeenAt: now.toISOString(),
    revokedAt: null,
  };
  await store.createSession(session);

  logger.info("auth.signed_in", { userId: user.id, role: membership.role });
  return { ok: true, token, actor: { user, membership } };
}

/**
 * Turn a cookie token into an actor, or nothing.
 *
 * Touches the session on the way through, which is what makes the idle window
 * mean anything. Both windows are checked in the domain — an expired session
 * and one nobody has touched since Friday are different failures with the same
 * consequence, and a caller that checked only one would hold the second open
 * forever.
 */
export async function resolveSessionToken(
  token: string,
  deps: SignInDeps = defaultDeps,
): Promise<ActorContext | null> {
  const store = authStore();
  const session = await store.findSession(sha256(token));
  if (!session) return null;

  const membership = await store.membershipForUser(session.userId);
  if (!membership) return null;

  const now = deps.now();
  const state = sessionState(session, membership.role, now);
  if (state !== "active") {
    if (state === "idle") await store.revokeSession(session.id, now.toISOString());
    return null;
  }

  const user = await store.findUserById(session.userId);
  if (!user) return null;

  await store.touchSession(session.id, now.toISOString());
  return { user, membership };
}

/** Sign out. Revokes rather than deletes, so the row can be swept on schedule. */
export async function endSession(
  token: string,
  deps: SignInDeps = defaultDeps,
): Promise<void> {
  await authStore().revokeSession(sha256(token), deps.now().toISOString());
}
