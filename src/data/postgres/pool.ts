/**
 * The process-wide client, and the one place a driver is chosen.
 *
 * Two adapters satisfy `PoolLike` — Neon's WebSocket driver and node-postgres
 * — and nothing above this file knows which one it got. The choice is made
 * from the connection string rather than from a build flag, so the same image
 * runs against Neon in production, a container in CI, and a local cluster on a
 * developer's machine with only `DATABASE_URL` changing.
 *
 * Both adapters are imported eagerly, which is deliberate: a dynamic import
 * would make this function async and push a promise into `backend()`, and the
 * whole point of that file is that the rest of the app reads `repositories`
 * synchronously. Neither driver opens a socket at import time, so the unused
 * one costs the bundle and nothing else.
 */

import { createPostgresClient, neonPool, type PoolLike, type PostgresClient } from "./neon";
import { nodePostgresPool } from "./node-pg";
import { databaseConfig, type DatabaseConfig } from "./config";

/** The pool the configured driver builds. */
export function poolFor(config: DatabaseConfig): PoolLike {
  return config.driver === "neon" ? neonPool(config) : nodePostgresPool(config);
}

/**
 * Resolved once per process.
 *
 * Lazy because importing this module must not require a database — most of the
 * test suite and the entire in-memory demo import things that transitively
 * reach here. Cached because a pool per request is not a pool.
 */
let cached: PostgresClient | null = null;

export function postgresClient(): PostgresClient {
  if (cached) return cached;
  const config = databaseConfig();
  cached = createPostgresClient(poolFor(config), config);
  return cached;
}

/** Drops the cached client. For tests and for scripts that need to exit. */
export async function closePostgresClient(): Promise<void> {
  if (!cached) return;
  const client = cached;
  cached = null;
  await client.end();
}
