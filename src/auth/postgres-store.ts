/**
 * The Postgres auth store.
 *
 * Plain statements rather than the `sql` template the repositories use, because
 * this layer has no `ActorContext` to scope by and therefore none of the
 * scoping fragments that template exists to compose. Parameterised the same
 * way; the safety property is identical.
 *
 * Every write here is a single statement, so none of them opens a transaction.
 * That is a real decision rather than laziness: a session resolve runs on every
 * request, and taking a session out of the pool to touch one timestamp would
 * make the cheapest thing the app does the most expensive.
 */

import type {
  Membership,
  MfaChallenge,
  RecoveryCode,
  Session,
  SignInCode,
  TotpEnrolment,
  User,
} from "@/domain/types";
import type { PostgresClient } from "@/data/postgres/neon";
import { normaliseEmail } from "@/domain/identity";
import type { AuthStore } from "./store";

type Row = Record<string, unknown>;

const text = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

const nullableText = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

/** `timestamptz` arrives as a Date; everything downstream wants the ISO string. */
function stamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return value === null || value === undefined ? "" : String(value);
}

function nullableStamp(value: unknown): string | null {
  const at = stamp(value);
  return at === "" ? null : at;
}

function toSession(row: Row): Session {
  return {
    id: text(row.id),
    userId: text(row.user_id),
    createdAt: stamp(row.created_at),
    expiresAt: stamp(row.expires_at),
    lastSeenAt: stamp(row.last_seen_at),
    revokedAt: nullableStamp(row.revoked_at),
  };
}

function toEnrolment(row: Row): TotpEnrolment {
  return {
    userId: text(row.user_id),
    secret: text(row.secret),
    createdAt: stamp(row.created_at),
    confirmedAt: nullableStamp(row.confirmed_at),
    lastCounter:
      row.last_counter === null || row.last_counter === undefined
        ? null
        : Number(row.last_counter),
  };
}

function toRecoveryCode(row: Row): RecoveryCode {
  return {
    id: text(row.id),
    userId: text(row.user_id),
    codeHash: text(row.code_hash),
    createdAt: stamp(row.created_at),
    usedAt: nullableStamp(row.used_at),
  };
}

function toChallenge(row: Row): MfaChallenge {
  return {
    id: text(row.id),
    userId: text(row.user_id),
    createdAt: stamp(row.created_at),
    expiresAt: stamp(row.expires_at),
    attempts: Number(row.attempts ?? 0),
  };
}

function toCode(row: Row): SignInCode {
  return {
    userId: text(row.user_id),
    purpose: text(row.purpose) as SignInCode["purpose"],
    codeHash: text(row.code_hash),
    createdAt: stamp(row.created_at),
    expiresAt: stamp(row.expires_at),
    attempts: Number(row.attempts ?? 0),
    consumedAt: nullableStamp(row.consumed_at),
  };
}

export function postgresAuthStore(client: PostgresClient): AuthStore {
  async function first(sql: string, params: readonly unknown[]): Promise<Row | null> {
    const rows = await client.query<Row>(sql, params);
    return rows[0] ?? null;
  }

  return {
    async findUserByEmail(email) {
      // Compared lower-case on both sides rather than relying on the column's
      // collation, so the behaviour is the same on either data layer.
      const row = await first(
        `SELECT id, name, email FROM users WHERE lower(email) = $1 LIMIT 1`,
        [normaliseEmail(email)],
      );
      return row
        ? ({ id: text(row.id), name: text(row.name), email: text(row.email) } as User)
        : null;
    },

    async findUserById(id) {
      const row = await first(`SELECT id, name, email FROM users WHERE id = $1`, [id]);
      return row
        ? ({ id: text(row.id), name: text(row.name), email: text(row.email) } as User)
        : null;
    },

    async membershipForUser(userId) {
      const row = await first(
        `SELECT id, user_id, organization_id, market_id, role
           FROM memberships WHERE user_id = $1 LIMIT 1`,
        [userId],
      );
      return row
        ? ({
            id: text(row.id),
            userId: text(row.user_id),
            organizationId: nullableText(row.organization_id),
            marketId: nullableText(row.market_id),
            role: text(row.role),
          } as Membership)
        : null;
    },

    async putSignInCode(code) {
      // Upsert on (user, purpose): asking for a new sign-in code replaces the
      // outstanding sign-in code rather than leaving two live, and leaves an
      // outstanding password reset alone.
      await client.query(
        `INSERT INTO sign_in_codes
           (user_id, purpose, code_hash, created_at, expires_at, attempts, consumed_at)
         VALUES ($1,$2,$3,$4,$5,0,NULL)
         ON CONFLICT (user_id, purpose) DO UPDATE SET
           code_hash = EXCLUDED.code_hash,
           created_at = EXCLUDED.created_at,
           expires_at = EXCLUDED.expires_at,
           attempts = 0,
           consumed_at = NULL`,
        [code.userId, code.purpose, code.codeHash, code.createdAt, code.expiresAt],
      );
    },

    async findSignInCode(userId, purpose) {
      const row = await first(
        `SELECT * FROM sign_in_codes WHERE user_id = $1 AND purpose = $2`,
        [userId, purpose],
      );
      return row ? toCode(row) : null;
    },

    async recordCodeAttempt(userId, purpose, attempts) {
      await client.query(
        `UPDATE sign_in_codes SET attempts = $3 WHERE user_id = $1 AND purpose = $2`,
        [userId, purpose, attempts],
      );
    },

    async consumeSignInCode(userId, purpose, at) {
      await client.query(
        `UPDATE sign_in_codes SET consumed_at = $3 WHERE user_id = $1 AND purpose = $2`,
        [userId, purpose, at],
      );
    },

    async createSession(session) {
      await client.query(
        `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, revoked_at)
         VALUES ($1,$2,$3,$4,$5,NULL)`,
        [
          session.id,
          session.userId,
          session.createdAt,
          session.expiresAt,
          session.lastSeenAt,
        ],
      );
    },

    async findSession(id) {
      const row = await first(`SELECT * FROM sessions WHERE id = $1`, [id]);
      return row ? toSession(row) : null;
    },

    async touchSession(id, at) {
      await client.query(`UPDATE sessions SET last_seen_at = $2 WHERE id = $1`, [id, at]);
    },

    async revokeSession(id, at) {
      await client.query(
        `UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL`,
        [id, at],
      );
    },

    async revokeSessionsForUser(userId, at) {
      await client.query(
        `UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId, at],
      );
    },

    // -- The second factor --------------------------------------------------

    async putTotpEnrolment(enrolment) {
      // `WHERE confirmed_at IS NULL` on the update half is the guard: a fresh
      // enrolment may replace one somebody started and abandoned, and may not
      // replace one they are currently relying on. Re-enrolling removes the old
      // one first, deliberately and visibly.
      await client.query(
        `INSERT INTO user_totp (user_id, secret, created_at, confirmed_at, last_counter)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE
           SET secret = EXCLUDED.secret,
               created_at = EXCLUDED.created_at,
               confirmed_at = NULL,
               last_counter = NULL
           WHERE user_totp.confirmed_at IS NULL`,
        [
          enrolment.userId,
          enrolment.secret,
          enrolment.createdAt,
          enrolment.confirmedAt,
          enrolment.lastCounter,
        ],
      );
    },

    async findTotpEnrolment(userId) {
      const row = await first(`SELECT * FROM user_totp WHERE user_id = $1`, [userId]);
      return row ? toEnrolment(row) : null;
    },

    async confirmTotpEnrolment(userId, at, counter) {
      await client.query(
        `UPDATE user_totp SET confirmed_at = $2, last_counter = $3 WHERE user_id = $1`,
        [userId, at, counter],
      );
    },

    async recordTotpCounter(userId, counter) {
      await client.query(`UPDATE user_totp SET last_counter = $2 WHERE user_id = $1`, [
        userId,
        counter,
      ]);
    },

    async removeTotpEnrolment(userId) {
      // The recovery codes go with it. A code that opens an account with no
      // second factor left to recover is just a password nobody remembers
      // issuing.
      await client.query(`DELETE FROM user_recovery_codes WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM user_totp WHERE user_id = $1`, [userId]);
    },

    async putRecoveryCodes(codes) {
      const userId = codes[0]?.userId;
      if (!userId) return;
      // Replaced wholesale. A set half replaced is a set where some of the
      // codes on somebody's printout no longer work and they cannot tell which.
      await client.query(`DELETE FROM user_recovery_codes WHERE user_id = $1`, [userId]);
      for (const code of codes) {
        await client.query(
          `INSERT INTO user_recovery_codes (id, user_id, code_hash, created_at, used_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [code.id, code.userId, code.codeHash, code.createdAt, code.usedAt],
        );
      }
    },

    async unusedRecoveryCodes(userId) {
      const rows = await client.query<Row>(
        `SELECT * FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
        [userId],
      );
      return rows.map(toRecoveryCode);
    },

    async useRecoveryCode(id, at) {
      // `AND used_at IS NULL` makes the single-use property the database's
      // rather than the caller's: two requests racing the same code cannot both
      // find it unused.
      await client.query(
        `UPDATE user_recovery_codes SET used_at = $2 WHERE id = $1 AND used_at IS NULL`,
        [id, at],
      );
    },

    async createMfaChallenge(challenge) {
      await client.query(
        `INSERT INTO mfa_challenges (id, user_id, created_at, expires_at, attempts)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          challenge.id,
          challenge.userId,
          challenge.createdAt,
          challenge.expiresAt,
          challenge.attempts,
        ],
      );
    },

    async findMfaChallenge(id) {
      const row = await first(`SELECT * FROM mfa_challenges WHERE id = $1`, [id]);
      return row ? toChallenge(row) : null;
    },

    async recordMfaAttempt(id, attempts) {
      await client.query(`UPDATE mfa_challenges SET attempts = $2 WHERE id = $1`, [
        id,
        attempts,
      ]);
    },

    async deleteMfaChallenge(id) {
      await client.query(`DELETE FROM mfa_challenges WHERE id = $1`, [id]);
    },
  };
}
