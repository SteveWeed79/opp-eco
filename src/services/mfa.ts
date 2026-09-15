/**
 * The second factor.
 *
 * A one-time code to a mailbox is single factor, and the factor is the mailbox.
 * That is a proportionate trade for a learner reading their own record and a
 * poor one for an administrator reading every market and authorising money — so
 * this closes the asymmetry at the top, where it is worst.
 *
 * Three properties, each of which is a decision:
 *
 *  1. **No session exists until both factors are in.** Proving the first factor
 *     produces an `MfaChallenge`, not a half-authenticated session, so there is
 *     no row for a missing predicate to turn into a working login.
 *  2. **A code cannot be replayed inside its own window.** The accepted counter
 *     is recorded, and a counter at or below it is refused. Shoulder-surfing
 *     six digits is easy; using them twice should not be.
 *  3. **There is always a way back in.** Recovery codes are issued with the
 *     enrolment, single use, and stored as hashes. Without them, enrolling an
 *     administrator in TOTP is a way to permanently lock out the only account
 *     that could undo it.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type {
  ActorContext,
  MfaChallenge,
  RecoveryCode,
  TotpEnrolment,
} from "@/domain/types";
import {
  MFA_CHALLENGE_TTL_MS,
  MFA_MAX_ATTEMPTS,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
} from "@/domain/identity";
import {
  counterFor,
  decodeBase32,
  encodeBase32,
  otpauthUri,
  readableSecret,
  verifyTotp,
  TOTP_WINDOW_STEPS,
} from "@/domain/totp";
import { authStore } from "@/auth/backend";
import { logger } from "@/services/logging";
import { brand } from "@/brand";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Same alphabet as the sign-in code: no 0/O/1/I/L to mistype off a printout. */
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newRecoveryCode(): string {
  let out = "";
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) {
    out += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  }
  return out;
}

/** Compared with the spacing and case somebody reads off their printout. */
function normaliseRecoveryCode(presented: string): string {
  return presented.replace(/[\s-]/g, "").toUpperCase();
}

export interface MfaDeps {
  now: () => Date;
}

const defaultDeps: MfaDeps = { now: () => new Date() };

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

export interface EnrolmentOffer {
  /** Base32, grouped in fours for whoever is typing it in by hand. */
  secret: string;
  /** What the authenticator app's camera reads. */
  uri: string;
}

/**
 * Begin enrolling. Produces a secret; nothing is required of it until confirmed.
 *
 * Calling this again before confirming replaces the pending secret, which is
 * what somebody who closed the page and came back expects. It will not touch a
 * *confirmed* enrolment — swapping that out silently would be a way to take
 * over an account by asking politely.
 */
export async function beginEnrolment(
  actor: ActorContext,
  deps: MfaDeps = defaultDeps,
): Promise<{ ok: true; offer: EnrolmentOffer } | { ok: false; error: string }> {
  const store = authStore();
  const existing = await store.findTotpEnrolment(actor.user.id);
  if (existing?.confirmedAt) {
    return {
      ok: false,
      error: "An authenticator is already enrolled. Remove it before enrolling another.",
    };
  }

  // 20 bytes, which is the RFC 4226 recommendation and what the test vectors
  // use. Longer buys nothing against HMAC-SHA1.
  const secret = encodeBase32(new Uint8Array(randomBytes(20)));
  await store.putTotpEnrolment({
    userId: actor.user.id,
    secret,
    createdAt: deps.now().toISOString(),
    confirmedAt: null,
    lastCounter: null,
  });

  logger.info("mfa.enrolment_started", { userId: actor.user.id });

  return {
    ok: true,
    offer: {
      secret: readableSecret(secret),
      uri: otpauthUri({
        issuer: brand.lead,
        account: actor.user.email,
        secret,
      }),
    },
  };
}

/**
 * Finish enrolling by proving the app works.
 *
 * The recovery codes are returned **once**, here, and never again — they are
 * stored as hashes, so there is no path by which they could be shown a second
 * time. That is the same property the sign-in code has and for the same reason.
 */
export async function confirmEnrolment(
  actor: ActorContext,
  presented: string,
  deps: MfaDeps = defaultDeps,
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
  const store = authStore();
  const enrolment = await store.findTotpEnrolment(actor.user.id);
  if (!enrolment) return { ok: false, error: "Start the enrolment again." };
  if (enrolment.confirmedAt) {
    return { ok: false, error: "That authenticator is already enrolled." };
  }

  const now = deps.now();
  if (!verifyTotp(decodeBase32(enrolment.secret), presented, now)) {
    // Not counted against a limit: nothing is protected yet, and locking
    // somebody out of enrolling is the opposite of what this is for.
    return { ok: false, error: "That code is not right. Check the app and try again." };
  }

  await store.confirmTotpEnrolment(
    actor.user.id,
    now.toISOString(),
    counterFor(now),
  );

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await store.putRecoveryCodes(
    codes.map<RecoveryCode>((code, index) => ({
      id: `${actor.user.id}:${now.getTime()}:${index}`,
      userId: actor.user.id,
      codeHash: sha256(code),
      createdAt: now.toISOString(),
      usedAt: null,
    })),
  );

  logger.info("mfa.enrolled", { userId: actor.user.id, recoveryCodes: codes.length });
  return { ok: true, recoveryCodes: codes };
}

/** Remove the second factor, and the recovery codes that only made sense with it. */
export async function removeEnrolment(actor: ActorContext): Promise<void> {
  await authStore().removeTotpEnrolment(actor.user.id);
  logger.warn("mfa.removed", { userId: actor.user.id });
}

export interface MfaStatus {
  enrolled: boolean;
  confirmedAt: string | null;
  recoveryCodesLeft: number;
}

export async function mfaStatus(actor: ActorContext): Promise<MfaStatus> {
  const store = authStore();
  const enrolment = await store.findTotpEnrolment(actor.user.id);
  const codes = enrolment?.confirmedAt
    ? await store.unusedRecoveryCodes(actor.user.id)
    : [];
  return {
    enrolled: Boolean(enrolment?.confirmedAt),
    confirmedAt: enrolment?.confirmedAt ?? null,
    recoveryCodesLeft: codes.length,
  };
}

// ---------------------------------------------------------------------------
// The challenge, between the two factors
// ---------------------------------------------------------------------------

export interface Challenge {
  /** Held in a cookie. The database holds its SHA-256, exactly like a session. */
  token: string;
  expiresAt: string;
}

export async function issueChallenge(
  userId: string,
  deps: MfaDeps = defaultDeps,
): Promise<Challenge> {
  const now = deps.now();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + MFA_CHALLENGE_TTL_MS).toISOString();

  await authStore().createMfaChallenge({
    id: sha256(token),
    userId,
    createdAt: now.toISOString(),
    expiresAt,
    attempts: 0,
  });

  return { token, expiresAt };
}

export type ChallengeResult =
  | { ok: true; userId: string }
  | { ok: false; error: string };

/**
 * Answer a challenge with either an authenticator code or a recovery code.
 *
 * One entry point for both, because the person at the keyboard is answering one
 * question — "prove it is you" — and making them pick which kind of secret they
 * are holding first is a worse experience for no security gain. A six-digit
 * string is tried as TOTP; anything else is tried as a recovery code.
 */
export async function answerChallenge(
  token: string,
  presented: string,
  deps: MfaDeps = defaultDeps,
): Promise<ChallengeResult> {
  const store = authStore();
  const now = deps.now();
  const id = sha256(token);

  const challenge = await store.findMfaChallenge(id);
  if (!challenge) return { ok: false, error: "Start signing in again." };

  if (new Date(challenge.expiresAt).getTime() <= now.getTime()) {
    await store.deleteMfaChallenge(id);
    return { ok: false, error: "That took too long. Start signing in again." };
  }

  if (challenge.attempts >= MFA_MAX_ATTEMPTS) {
    await store.deleteMfaChallenge(id);
    return { ok: false, error: "Too many attempts. Start signing in again." };
  }

  const enrolment = await store.findTotpEnrolment(challenge.userId);
  if (!enrolment?.confirmedAt) {
    // The enrolment went away between the two factors. Refusing is the only
    // safe answer: this is the moment nothing is proving who they are.
    await store.deleteMfaChallenge(id);
    return { ok: false, error: "Start signing in again." };
  }

  const cleaned = presented.replace(/\s/g, "");
  const accepted = /^\d{6}$/.test(cleaned)
    ? await acceptTotp(enrolment, cleaned, now)
    : await acceptRecoveryCode(challenge, cleaned, now);

  if (!accepted) {
    await store.recordMfaAttempt(id, challenge.attempts + 1);
    logger.warn("mfa.rejected", {
      userId: challenge.userId,
      attempts: challenge.attempts + 1,
    });
    return { ok: false, error: "That code is not valid." };
  }

  await store.deleteMfaChallenge(id);
  logger.info("mfa.accepted", { userId: challenge.userId });
  return { ok: true, userId: challenge.userId };
}

async function acceptTotp(
  enrolment: TotpEnrolment,
  cleaned: string,
  now: Date,
): Promise<boolean> {
  if (!verifyTotp(decodeBase32(enrolment.secret), cleaned, now)) return false;

  // Replay: the window accepts a step either side, so a code somebody read over
  // a shoulder stays valid for up to ninety seconds. Recording the counter and
  // refusing anything at or below it closes that.
  const current = counterFor(now);
  if (enrolment.lastCounter !== null && current - TOTP_WINDOW_STEPS <= enrolment.lastCounter) {
    // Work out which step actually matched, so a legitimate later code in the
    // same window is not refused along with a replayed earlier one.
    const matched = matchedCounter(enrolment, cleaned, now);
    if (matched === null || matched <= enrolment.lastCounter) return false;
    await authStore().recordTotpCounter(enrolment.userId, matched);
    return true;
  }

  const matched = matchedCounter(enrolment, cleaned, now) ?? current;
  await authStore().recordTotpCounter(enrolment.userId, matched);
  return true;
}

/** Which step in the window produced this code, or null. */
function matchedCounter(
  enrolment: TotpEnrolment,
  cleaned: string,
  now: Date,
): number | null {
  const secret = decodeBase32(enrolment.secret);
  const current = counterFor(now);
  for (let step = -TOTP_WINDOW_STEPS; step <= TOTP_WINDOW_STEPS; step++) {
    if (verifyTotp(secret, cleaned, new Date((current + step) * 30_000), 0)) {
      return current + step;
    }
  }
  return null;
}

async function acceptRecoveryCode(
  challenge: MfaChallenge,
  cleaned: string,
  now: Date,
): Promise<boolean> {
  const store = authStore();
  const wanted = sha256(normaliseRecoveryCode(cleaned));
  const codes = await store.unusedRecoveryCodes(challenge.userId);

  // Every candidate is compared, without returning early, so the time taken
  // says nothing about how many codes are left or where the match was.
  let match: RecoveryCode | null = null;
  for (const code of codes) {
    const equal =
      code.codeHash.length === wanted.length &&
      timingSafeEqual(Buffer.from(code.codeHash), Buffer.from(wanted));
    if (equal) match = code;
  }
  if (!match) return false;

  await store.useRecoveryCode(match.id, now.toISOString());
  logger.warn("mfa.recovery_code_used", {
    userId: challenge.userId,
    remaining: codes.length - 1,
  });
  return true;
}
