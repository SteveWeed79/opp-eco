/**
 * Signing in with a password, and getting a new one when it is lost.
 *
 * Sits alongside `auth.ts` rather than inside it, because the two answer
 * different populations. A college, an employer and a learner sign in here. A
 * public employee never does — their organization holds no password on this
 * platform, and `signInMethodFor` sends them to the code path instead.
 *
 * Everything security-relevant here is about refusing to be a directory:
 *
 *  - An address that does not exist and a password that is wrong fail
 *    identically, in the same time, with the same words.
 *  - Which *method* an address uses is answered from its **domain**, not from
 *    whether the account exists — so probing `firstname.lastname@agency.gov`
 *    tells you how that agency signs in, which is not a secret, and nothing
 *    about who works there, which is.
 *  - A reset request always reports success.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ActorContext, IdentityMode, SignInCode } from "@/domain/types";
import {
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  normaliseEmail,
  signInMethodFor,
  usesPassword,
} from "@/domain/identity";
import { checkPassword, hashPassword, needsRehash, verifyPassword } from "@/domain/password";
import { authStore } from "@/auth/backend";
import { repositories } from "@/data/backend";
import { systemContext } from "@/auth/system";
import { logger } from "@/services/logging";
import { brand } from "@/brand";

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

export interface PasswordDeps {
  now: () => Date;
  deliver: (to: string, code: string, expiresAt: Date) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Which door
// ---------------------------------------------------------------------------

/**
 * How this address signs in, answered without saying whether it exists.
 *
 * Resolved from the **domain** when there is no account: an organization that
 * has declared its email domains answers for every address on them, real or
 * not. So probing a workforce board's domain reveals that the board uses codes
 * — an institutional arrangement, not a secret about a person — and reveals
 * nothing about which officers have accounts.
 *
 * Anything else answers `password`, which is the majority case and the one that
 * fails generically a step later.
 */
export async function signInMethodForAddress(email: string): Promise<IdentityMode> {
  const address = normaliseEmail(email);
  const domain = address.split("@")[1] ?? "";
  if (!domain) return "password";

  const store = authStore();
  const user = await store.findUserByEmail(address);
  const membership = user ? await store.membershipForUser(user.id) : null;

  if (membership?.organizationId) {
    const organization = await repositories.organizations.find(
      systemContext(),
      membership.organizationId,
    );
    return signInMethodFor(organization);
  }
  if (user) {
    // A real account with no organization is the administrator.
    return signInMethodFor(null);
  }

  // No account. Answer for the domain instead, so the reply is a property of
  // the institution rather than of whether this particular person exists.
  const organizations = await repositories.organizations.list(systemContext());
  const owning = organizations.find((org) =>
    org.emailDomains.some((declared) => declared.toLowerCase() === domain),
  );
  return signInMethodFor(owning ?? null);
}

// ---------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------

export type PasswordSignInResult =
  | { ok: true; actor: ActorContext; mustChange: boolean }
  | { ok: false; error: string };

/** One message for every failure, so none of them is an answer. */
const REFUSED = {
  ok: false as const,
  error: "That address and password do not match.",
};

export async function verifyPasswordSignIn(
  email: string,
  password: string,
  deps: Pick<PasswordDeps, "now">,
): Promise<PasswordSignInResult> {
  const address = normaliseEmail(email);
  const store = authStore();

  const user = await store.findUserByEmail(address);
  const membership = user ? await store.membershipForUser(user.id) : null;
  if (!user || !membership) {
    // Deliberately still does the work: returning instantly for an unknown
    // address makes the response time the directory that the wording is not.
    await hashPassword(password).catch(() => undefined);
    return REFUSED;
  }

  const organization = membership.organizationId
    ? await repositories.organizations.find(systemContext(), membership.organizationId)
    : null;
  if (!usesPassword(signInMethodFor(organization))) {
    // A government organization has no password here. Said plainly, because the
    // person needs to know to look in their mailbox instead, and because an
    // institution's identity arrangement is not a secret about them.
    return {
      ok: false,
      error: `${organization?.name ?? "This organization"} signs in with a one-time code, not a password. Ask for a code instead.`,
    };
  }

  const stored = await store.findPassword(user.id);
  if (!stored) {
    await hashPassword(password).catch(() => undefined);
    return REFUSED;
  }

  if (!(await verifyPassword(password, stored.hash))) {
    logger.warn("auth.password_rejected", { userId: user.id });
    return REFUSED;
  }

  // Raising the cost later is a rehash on the next successful sign-in rather
  // than a migration that locks everybody out at once.
  if (needsRehash(stored.hash)) {
    await store.putPassword({
      userId: user.id,
      hash: await hashPassword(password),
      updatedAt: deps.now().toISOString(),
      mustChange: stored.mustChange,
    });
  }

  return {
    ok: true,
    actor: { user, membership },
    mustChange: stored.mustChange,
  };
}

// ---------------------------------------------------------------------------
// Setting one
// ---------------------------------------------------------------------------

export type SetPasswordResult = { ok: true } | { ok: false; error: string };

/**
 * Choose your own password.
 *
 * Every other session for the account goes. Changing a password is what
 * somebody does after they think it was seen, and leaving the sessions it
 * protected alive would make the change cosmetic.
 */
export async function setOwnPassword(
  actor: ActorContext,
  next: string,
  deps: Pick<PasswordDeps, "now">,
): Promise<SetPasswordResult> {
  const problem = checkPassword(next, {
    email: actor.user.email,
    siteName: brand.lead,
  });
  if (!problem.ok) return { ok: false, error: problem.reason };

  const now = deps.now();
  const store = authStore();
  await store.putPassword({
    userId: actor.user.id,
    hash: await hashPassword(next),
    updatedAt: now.toISOString(),
    mustChange: false,
  });
  await store.revokeSessionsForUser(actor.user.id, now.toISOString());

  logger.info("auth.password_set", { userId: actor.user.id });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Forgetting one
// ---------------------------------------------------------------------------

/** Always reports success, for the same reason a code request does. */
export async function requestPasswordReset(
  email: string,
  deps: PasswordDeps,
): Promise<{ ok: true }> {
  const address = normaliseEmail(email);
  const store = authStore();
  const user = await store.findUserByEmail(address);
  const membership = user ? await store.membershipForUser(user.id) : null;

  if (!user || !membership) {
    logger.info("auth.reset_requested", { known: false });
    return { ok: true };
  }

  const organization = membership.organizationId
    ? await repositories.organizations.find(systemContext(), membership.organizationId)
    : null;
  if (!usesPassword(signInMethodFor(organization))) {
    // Nothing to reset. Sending a reset code to somebody who signs in with a
    // code would be handing them a second one that does something different.
    logger.info("auth.reset_refused", { organizationId: organization?.id });
    return { ok: true };
  }

  const now = deps.now();
  const code = resetCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);

  await store.putSignInCode({
    userId: user.id,
    // Its own purpose, so it cannot be spent as a sign-in code and does not
    // invalidate one the person is already holding.
    purpose: "password_reset",
    codeHash: sha256(code),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    attempts: 0,
    consumedAt: null,
  });

  await deps.deliver(user.email, code, expiresAt);
  logger.info("auth.reset_requested", { known: true, userId: user.id });
  return { ok: true };
}

/** Same alphabet as a sign-in code: no 0/O/1/I/L to mistype. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function resetCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export async function resetPassword(
  email: string,
  code: string,
  next: string,
  deps: Pick<PasswordDeps, "now">,
): Promise<SetPasswordResult> {
  const generic = {
    ok: false as const,
    error: "That code is not valid. Ask for a new one.",
  };

  const address = normaliseEmail(email);
  const store = authStore();
  const user = await store.findUserByEmail(address);
  if (!user) return generic;

  const record = await store.findSignInCode(user.id, "password_reset");
  if (!record || record.consumedAt) return generic;

  const now = deps.now();
  if (new Date(record.expiresAt).getTime() <= now.getTime()) return generic;
  if (record.attempts >= CODE_MAX_ATTEMPTS) return generic;

  if (!matches(record, code)) {
    await store.recordCodeAttempt(user.id, "password_reset", record.attempts + 1);
    return generic;
  }

  // Checked *after* the code, so a wrong password on a valid code does not
  // burn the code — and before anything is written, so a refused password
  // leaves the account exactly as it was.
  const problem = checkPassword(next, { email: user.email, siteName: brand.lead });
  if (!problem.ok) return { ok: false, error: problem.reason };

  const membership = await store.membershipForUser(user.id);
  if (!membership) return generic;

  await store.consumeSignInCode(user.id, "password_reset", now.toISOString());
  await store.putPassword({
    userId: user.id,
    hash: await hashPassword(next),
    updatedAt: now.toISOString(),
    mustChange: false,
  });
  // Everywhere. A reset is what somebody does when they believe the account is
  // compromised, and the sessions are the thing that was compromised.
  await store.revokeSessionsForUser(user.id, now.toISOString());

  logger.info("auth.password_reset", { userId: user.id });
  return { ok: true };
}

function matches(record: SignInCode, presented: string): boolean {
  const expected = record.codeHash;
  const actual = sha256(presented.trim().toUpperCase());
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
