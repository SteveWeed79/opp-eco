/**
 * The in-memory auth store.
 *
 * Process-local, which is right for the demo and for the unit suite and wrong
 * for anything with more than one instance — a session created on one server
 * would not resolve on the next. That is the same limitation the rate limiter
 * has, and the same fix: a shared store. Stated here rather than discovered.
 */

import type { Session, SignInCode } from "@/domain/types";
import * as seed from "@/data/seed";
import { membershipForUser } from "@/data/session";
import { normaliseEmail } from "@/domain/identity";
import type { AuthStore } from "./store";

const sessions = new Map<string, Session>();
const codes = new Map<string, SignInCode>();

/** Emptied between tests, and on nothing else. */
export function resetAuthState() {
  sessions.clear();
  codes.clear();
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
    codes.set(code.userId, code);
  },

  async findSignInCode(userId) {
    return codes.get(userId) ?? null;
  },

  async recordCodeAttempt(userId, attempts) {
    const code = codes.get(userId);
    if (code) codes.set(userId, { ...code, attempts });
  },

  async consumeSignInCode(userId, at) {
    const code = codes.get(userId);
    if (code) codes.set(userId, { ...code, consumedAt: at });
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
};
