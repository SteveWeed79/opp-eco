/**
 * The pre-auth store.
 *
 * Deliberately outside the repository layer, and that is the point worth
 * stating. Every repository read takes an `ActorContext` and is scoped by it —
 * which is exactly what makes them safe, and exactly why they cannot serve
 * this: resolving a session is what *produces* the actor, so there is nobody to
 * scope by yet. Routing it through `repositories` would mean inventing a
 * privileged context to read the session table with, which is a back door with
 * a polite name.
 *
 * So the surface here is narrow to the point of being boring. It can look a
 * user up by address, hold one code per person, and create, read, touch or
 * revoke a session. It cannot list sessions, cannot read a code back, and has
 * no access to anything else in the database.
 */

import type {
  CodePurpose,
  StoredPassword,
  Membership,
  MfaChallenge,
  RecoveryCode,
  Session,
  SignInCode,
  TotpEnrolment,
  User,
} from "@/domain/types";

export interface AuthStore {
  /**
   * The account behind a work address, or null.
   *
   * Null covers both "no such account" and "the address is not one we hold",
   * which callers must not distinguish to the person typing — see
   * `requestSignInCode`.
   */
  findUserByEmail(email: string): Promise<User | null>;
  findUserById(id: string): Promise<User | null>;
  /**
   * The membership a session resolves to.
   *
   * One per user here. A person holding several is the seam this returns null
   * into rather than guessing at, and the day it matters the caller asks which.
   */
  membershipForUser(userId: string): Promise<Membership | null>;

  /**
   * Replaces any outstanding code of the same purpose for this user.
   *
   * Of the *same purpose*: asking to reset a password must not silently
   * invalidate the sign-in code somebody is already holding, and the reverse.
   */
  putSignInCode(code: SignInCode): Promise<void>;
  findSignInCode(userId: string, purpose: CodePurpose): Promise<SignInCode | null>;
  /** Records a failed guess without consuming the code. */
  recordCodeAttempt(
    userId: string,
    purpose: CodePurpose,
    attempts: number,
  ): Promise<void>;
  consumeSignInCode(userId: string, purpose: CodePurpose, at: string): Promise<void>;

  createSession(session: Session): Promise<void>;
  findSession(id: string): Promise<Session | null>;
  /** Moves the idle clock forward. Called on every resolved request. */
  touchSession(id: string, at: string): Promise<void>;
  revokeSession(id: string, at: string): Promise<void>;
  /** Sign out everywhere — used when a code is issued for an account. */
  revokeSessionsForUser(userId: string, at: string): Promise<void>;

  // -- Passwords ------------------------------------------------------------

  /**
   * The stored hash for somebody, or null if they have none.
   *
   * Null is a real state rather than an error: a board officer has no password
   * by design, and a college account created before it set one has not got round
   * to it. Both are answered by sending them down a different path, not by
   * failing.
   */
  findPassword(userId: string): Promise<StoredPassword | null>;
  putPassword(password: StoredPassword): Promise<void>;
  removePassword(userId: string): Promise<void>;

  // -- The second factor ----------------------------------------------------

  /** Replaces any unconfirmed enrolment; a confirmed one is not overwritten. */
  putTotpEnrolment(enrolment: TotpEnrolment): Promise<void>;
  findTotpEnrolment(userId: string): Promise<TotpEnrolment | null>;
  confirmTotpEnrolment(userId: string, at: string, counter: number): Promise<void>;
  /** Records the counter just accepted, so the same code cannot come back. */
  recordTotpCounter(userId: string, counter: number): Promise<void>;
  removeTotpEnrolment(userId: string): Promise<void>;

  /** Replaces the whole set — recovery codes are issued as a batch or not at all. */
  putRecoveryCodes(codes: RecoveryCode[]): Promise<void>;
  /** Unused codes only. A used one is kept for the audit trail, not for matching. */
  unusedRecoveryCodes(userId: string): Promise<RecoveryCode[]>;
  useRecoveryCode(id: string, at: string): Promise<void>;

  createMfaChallenge(challenge: MfaChallenge): Promise<void>;
  findMfaChallenge(id: string): Promise<MfaChallenge | null>;
  recordMfaAttempt(id: string, attempts: number): Promise<void>;
  deleteMfaChallenge(id: string): Promise<void>;
}
