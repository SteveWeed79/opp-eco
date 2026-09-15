/**
 * The in-memory auth store.
 *
 * Process-local, which is right for the demo and for the unit suite and wrong
 * for anything with more than one instance — a session created on one server
 * would not resolve on the next. That is the same limitation the rate limiter
 * has, and the same fix: a shared store. Stated here rather than discovered.
 */

import type {
  MfaChallenge,
  RecoveryCode,
  Session,
  SignInCode,
  TotpEnrolment,
} from "@/domain/types";
import * as seed from "@/data/seed";
import { membershipForUser } from "@/data/session";
import { normaliseEmail } from "@/domain/identity";
import type { AuthStore } from "./store";

const sessions = new Map<string, Session>();
const codes = new Map<string, SignInCode>();
const enrolments = new Map<string, TotpEnrolment>();
const recoveryCodes = new Map<string, RecoveryCode>();
const challenges = new Map<string, MfaChallenge>();

/** Emptied between tests, and on nothing else. */
export function resetAuthState() {
  sessions.clear();
  codes.clear();
  enrolments.clear();
  recoveryCodes.clear();
  challenges.clear();
}

export const memoryAuthStore: AuthStore = {
  async findUserByEmail(email) {
    const wanted = normaliseEmail(email);
    return seed.users.find((u) => normaliseEmail(u.email) === wanted) ?? null;
  },

  async findUserById(id) {
    return seed.users.find((u) => u.id === id) ?? null;
  },

  async membershipForUser(userId) {
    return membershipForUser(userId);
  },

  async putSignInCode(code) {
    codes.set(`${code.userId}:${code.purpose}`, code);
  },

  async findSignInCode(userId, purpose) {
    return codes.get(`${userId}:${purpose}`) ?? null;
  },

  async recordCodeAttempt(userId, purpose, attempts) {
    const key = `${userId}:${purpose}`;
    const code = codes.get(key);
    if (code) codes.set(key, { ...code, attempts });
  },

  async consumeSignInCode(userId, purpose, at) {
    const key = `${userId}:${purpose}`;
    const code = codes.get(key);
    if (code) codes.set(key, { ...code, consumedAt: at });
  },

  async createSession(session) {
    sessions.set(session.id, session);
  },

  async findSession(id) {
    return sessions.get(id) ?? null;
  },

  async touchSession(id, at) {
    const session = sessions.get(id);
    if (session) sessions.set(id, { ...session, lastSeenAt: at });
  },

  async revokeSession(id, at) {
    const session = sessions.get(id);
    if (session) sessions.set(id, { ...session, revokedAt: at });
  },

  async revokeSessionsForUser(userId, at) {
    for (const [id, session] of sessions) {
      if (session.userId === userId && !session.revokedAt) {
        sessions.set(id, { ...session, revokedAt: at });
      }
    }
  },

  // -- The second factor ----------------------------------------------------

  async putTotpEnrolment(enrolment) {
    // A confirmed enrolment is not silently replaced. Re-enrolling is a
    // deliberate act that removes the old one first, so a stray call cannot
    // swap somebody's authenticator out from under them.
    const existing = enrolments.get(enrolment.userId);
    if (existing?.confirmedAt) return;
    enrolments.set(enrolment.userId, enrolment);
  },

  async findTotpEnrolment(userId) {
    return enrolments.get(userId) ?? null;
  },

  async confirmTotpEnrolment(userId, at, counter) {
    const existing = enrolments.get(userId);
    if (existing) {
      enrolments.set(userId, { ...existing, confirmedAt: at, lastCounter: counter });
    }
  },

  async recordTotpCounter(userId, counter) {
    const existing = enrolments.get(userId);
    if (existing) enrolments.set(userId, { ...existing, lastCounter: counter });
  },

  async removeTotpEnrolment(userId) {
    enrolments.delete(userId);
    for (const [id, code] of recoveryCodes) {
      if (code.userId === userId) recoveryCodes.delete(id);
    }
  },

  async putRecoveryCodes(codesToStore) {
    // Issued as a batch or not at all: a set half replaced is a set where some
    // of the codes on somebody's printout no longer work and they cannot tell
    // which.
    for (const [id, code] of recoveryCodes) {
      if (code.userId === codesToStore[0]?.userId) recoveryCodes.delete(id);
    }
    for (const code of codesToStore) recoveryCodes.set(code.id, code);
  },

  async unusedRecoveryCodes(userId) {
    return [...recoveryCodes.values()].filter(
      (code) => code.userId === userId && !code.usedAt,
    );
  },

  async useRecoveryCode(id, at) {
    const code = recoveryCodes.get(id);
    if (code) recoveryCodes.set(id, { ...code, usedAt: at });
  },

  async createMfaChallenge(challenge) {
    challenges.set(challenge.id, challenge);
  },

  async findMfaChallenge(id) {
    return challenges.get(id) ?? null;
  },

  async recordMfaAttempt(id, attempts) {
    const challenge = challenges.get(id);
    if (challenge) challenges.set(id, { ...challenge, attempts });
  },

  async deleteMfaChallenge(id) {
    challenges.delete(id);
  },
};
