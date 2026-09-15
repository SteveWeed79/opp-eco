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

import type { Membership, Session, SignInCode, User } from "@/domain/types";

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

  /** Replaces any outstanding code for this user. */
  putSignInCode(code: SignInCode): Promise<void>;
  findSignInCode(userId: string): Promise<SignInCode | null>;
  /** Records a failed guess without consuming the code. */
  recordCodeAttempt(userId: string, attempts: number): Promise<void>;
  consumeSignInCode(userId: string, at: string): Promise<void>;

  createSession(session: Session): Promise<void>;
  findSession(id: string): Promise<Session | null>;
  /** Moves the idle clock forward. Called on every resolved request. */
  touchSession(id: string, at: string): Promise<void>;
  revokeSession(id: string, at: string): Promise<void>;
  /** Sign out everywhere — used when a code is issued for an account. */
  revokeSessionsForUser(userId: string, at: string): Promise<void>;
}
