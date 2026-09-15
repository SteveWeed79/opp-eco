/**
 * The node-postgres adapter.
 *
 * The second driver `neon.ts` said would be a second file and no change
 * anywhere else. It exists because Neon's driver cannot reach an ordinary
 * Postgres: it speaks the wire protocol over a WebSocket to Neon's proxy, so
 * `postgres://localhost/oppeco` fails inside a handshake rather than
 * connecting. That ruled out the two things a schema most needs — running it
 * on a developer's machine, and running it in CI — and left every statement in
 * this directory verified only against a recording client, which proves the
 * text and nothing about whether Postgres accepts it.
 *
 * Nothing above `PoolLike` can tell the two apart. The retry logic, the
 * transaction handling, and every repository are the driver-agnostic half, and
 * they are shared rather than reimplemented — otherwise the integration suite
 * would be exercising code the deployment does not run.
 */

import { Pool } from "pg";
import type { PoolClientLike, PoolLike } from "./neon";
import type { DatabaseConfig } from "./config";

/**
 * A pool over `pg`.
 *
 * `pg.Pool` already satisfies `PoolLike` structurally — `query(text, params)`,
 * `connect()`, `end()`, and a `release(err?)` that destroys the session when
 * handed an error, which is what the rollback path in `createPostgresClient`
 * depends on. The cast is narrowing to the slice this app uses, not papering
 * over a mismatch.
 *
 * SSL comes from the connection string's `sslmode`, which `pg` parses itself.
 * A local database is reached without one; a managed database is reached with
 * `?sslmode=require`, the same as the Neon path.
 */
export function nodePostgresPool(config: DatabaseConfig): PoolLike {
  if (!config.connectionString) {
    throw new Error(
      "No DATABASE_URL. Check isDatabaseConfigured() before building a pool.",
    );
  }

  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections,
  });

  // An idle client erroring — the database restarting, a proxy dropping the
  // connection — is emitted on the pool. Unhandled, it is an `error` event on
  // an EventEmitter, which Node turns into an uncaught exception and a dead
  // process. The pool discards the client either way; this only stops a
  // routine disconnect from taking the server down with it.
  pool.on("error", (error) => {
    console.error("[postgres] idle client error:", error.message);
  });

  return pool as unknown as PoolLike & { connect(): Promise<PoolClientLike> };
}
