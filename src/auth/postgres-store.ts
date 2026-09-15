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

import type { Membership, Session, SignInCode, User } from "@/domain/types";
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

function toCode(row: Row): SignInCode {
  return {
    userId: text(row.user_id),
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
      // Upsert, because the table is keyed by user: asking for a new code
      // replaces the outstanding one rather than leaving two live.
      await client.query(
        `INSERT INTO sign_in_codes (user_id, code_hash, created_at, expires_at, attempts, consumed_at)
         VALUES ($1,$2,$3,$4,0,NULL)
         ON CONFLICT (user_id) DO UPDATE SET
           code_hash = EXCLUDED.code_hash,
           created_at = EXCLUDED.created_at,
           expires_at = EXCLUDED.expires_at,
           attempts = 0,
           consumed_at = NULL`,
        [code.userId, code.codeHash, code.createdAt, code.expiresAt],
      );
    },

    async findSignInCode(userId) {
      const row = await first(`SELECT * FROM sign_in_codes WHERE user_id = $1`, [userId]);
      return row ? toCode(row) : null;
    },

    async recordCodeAttempt(userId, attempts) {
      await client.query(`UPDATE sign_in_codes SET attempts = $2 WHERE user_id = $1`, [
        userId,
        attempts,
      ]);
    },

    async consumeSignInCode(userId, at) {
      await client.query(`UPDATE sign_in_codes SET consumed_at = $2 WHERE user_id = $1`, [
        userId,
        at,
      ]);
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
  };
}
