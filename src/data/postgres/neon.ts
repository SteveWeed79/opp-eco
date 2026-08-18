/**
 * The Neon adapter.
 *
 * `client.ts` describes the minimum a driver must provide; this is that
 * minimum, implemented over `@neondatabase/serverless`. Everything specific to
 * Neon is in this file, so swapping to `pg` against any other Postgres is a
 * second file and no change anywhere else.
 *
 * **Why the pool and not the HTTP function.** Neon ships two interfaces. The
 * `neon()` function sends one statement per HTTP request and cannot hold a
 * session, so `BEGIN` and `COMMIT` land on different connections and mean
 * nothing. `TransactionalSqlClient.transaction` hands the caller a client and
 * lets them run arbitrary work between statements, which is a session by
 * definition — so transactions go through a pooled WebSocket connection. Loose
 * `query()` calls still take the HTTP path (see `queryViaFetch`), because that
 * is most of the latency of a short read on a cold serverless invocation.
 *
 * **Why retries live here.** Serialization failures are not errors in the
 * sense the rest of the app means: nothing was wrong with the work, Postgres
 * simply refused to order it against a concurrent transaction and expects it
 * to be tried again. Leaving that to callers means every call site either
 * re-implements the backoff or, more likely, surfaces a database code to a
 * board officer authorizing funding.
 */

import { Pool, neonConfig } from "@neondatabase/serverless";
import type { SqlClient, TransactionalSqlClient } from "./client";
import { databaseConfig, type DatabaseConfig, type IsolationLevel } from "./config";

/**
 * The slice of a driver pool this adapter uses.
 *
 * Narrow on purpose: it is what lets the tests drive commit, rollback, and
 * serialization-failure retries without a database, and it documents exactly
 * how much of node-postgres' surface this depends on.
 */
export interface PoolLike {
  query(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: unknown[] }>;
  connect(): Promise<PoolClientLike>;
  end(): Promise<void>;
}

export interface PoolClientLike {
  query(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: unknown[] }>;
  /** Passing an error destroys the session instead of returning it to the pool. */
  release(destroy?: boolean | Error): void;
}

export interface TransactionOptions {
  isolation?: IsolationLevel;
  /** `BEGIN READ ONLY`. Lets Postgres refuse a write the caller did not intend. */
  readOnly?: boolean;
  /** Overrides the configured retry ceiling for this transaction. */
  maxRetries?: number;
}

/**
 * A `TransactionalSqlClient` whose `transaction` also accepts isolation and
 * retry options.
 *
 * Structurally still a `TransactionalSqlClient` — the extra argument is
 * optional — so anything typed against the plain interface keeps working, and
 * the funding path can ask for `serializable` without a cast.
 */
export interface PostgresClient extends TransactionalSqlClient {
  transaction<T>(
    work: (tx: SqlClient) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
  /** Closes pooled sessions. For scripts; a server process never calls it. */
  end(): Promise<void>;
}

/**
 * Postgres codes that mean "that did not commit, run it again".
 *
 * `40001` is a serialization failure, which is the expected outcome of two
 * board officers authorizing funding against the same allocation under
 * `serializable`. `40P01` is a deadlock, which Postgres resolves by killing
 * one side. Neither indicates the work was invalid, and both are safe to
 * repeat because the whole transaction rolled back.
 */
const RETRYABLE = new Set(["40001", "40P01"]);

function isRetryable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    RETRYABLE.has((error as { code: string }).code)
  );
}

/**
 * Build a client over any pool satisfying `PoolLike`.
 *
 * Separate from `neonPool` so the transaction logic — which is the part with
 * the interesting failure modes — is testable without a network.
 */
export function createPostgresClient(
  pool: PoolLike,
  config: Pick<DatabaseConfig, "defaultIsolation" | "maxRetries">,
  /** Injected so the retry test does not spend real time sleeping. */
  sleep: (ms: number) => Promise<void> = defaultSleep,
): PostgresClient {
  async function query<Row = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<Row[]> {
    const result = await pool.query(text, params);
    return result.rows as Row[];
  }

  async function attempt<T>(
    work: (tx: SqlClient) => Promise<T>,
    options: TransactionOptions,
  ): Promise<T> {
    const client = await pool.connect();
    let opened = false;
    try {
      await client.query(beginStatement(options, config.defaultIsolation));
      opened = true;

      const result = await work({
        query: async <Row = Record<string, unknown>>(
          text: string,
          params: readonly unknown[] = [],
        ) => (await client.query(text, params)).rows as Row[],
      });

      await client.query("COMMIT");
      client.release();
      return result;
    } catch (error) {
      // A failed ROLLBACK leaves the session in an unknown state. Returning it
      // to the pool would hand the next caller an open transaction, so it is
      // destroyed instead — the pool opens a fresh one.
      if (opened) {
        try {
          await client.query("ROLLBACK");
          client.release();
        } catch (rollbackError) {
          client.release(
            rollbackError instanceof Error ? rollbackError : true,
          );
        }
      } else {
        client.release(error instanceof Error ? error : true);
      }
      throw error;
    }
  }

  async function transaction<T>(
    work: (tx: SqlClient) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    const ceiling = options.maxRetries ?? config.maxRetries;
    let lastError: unknown;

    for (let attemptNumber = 0; attemptNumber <= ceiling; attemptNumber++) {
      try {
        return await attempt(work, options);
      } catch (error) {
        if (!isRetryable(error)) throw error;
        lastError = error;
        // Exponential with jitter: two transactions that collide and then
        // retry in lockstep collide again.
        if (attemptNumber < ceiling) {
          await sleep(2 ** attemptNumber * 10 + Math.random() * 10);
        }
      }
    }
    throw lastError;
  }

  return { query, transaction, end: () => pool.end() };
}

function beginStatement(
  options: TransactionOptions,
  fallback: IsolationLevel,
): string {
  const isolation = (options.isolation ?? fallback).toUpperCase();
  // Isolation and access mode are keywords chosen from a closed set here, not
  // caller input — there is no path for a value to reach this string.
  return `BEGIN ISOLATION LEVEL ${isolation}${options.readOnly ? " READ ONLY" : ""}`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A real Neon pool.
 *
 * `webSocketConstructor` is set from the global rather than pulling in `ws`:
 * Node has had a global `WebSocket` since 22, which is the floor this project
 * already builds on. Setting it explicitly rather than relying on the driver's
 * own lookup means a runtime without one fails here, naming the problem.
 */
export function neonPool(config: DatabaseConfig): PoolLike {
  if (!config.connectionString) {
    throw new Error(
      "No DATABASE_URL. Check isDatabaseConfigured() before building a pool.",
    );
  }

  if (!neonConfig.webSocketConstructor) {
    const ctor = (globalThis as { WebSocket?: unknown }).WebSocket;
    if (!ctor) {
      throw new Error(
        "No WebSocket implementation. Node 22+ provides one globally; on older " +
          "runtimes set neonConfig.webSocketConstructor to the 'ws' package.",
      );
    }
    neonConfig.webSocketConstructor =
      ctor as unknown as NonNullable<typeof neonConfig.webSocketConstructor>;
  }

  // Only affects `Pool.query()`, never a checked-out session, so transactions
  // keep their WebSocket regardless of this setting.
  neonConfig.poolQueryViaFetch = config.queryViaFetch;

  return new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections,
  }) as unknown as PoolLike;
}

/**
 * The process-wide client.
 *
 * Lazy because importing this module must not require a database — most of the
 * test suite and the entire in-memory demo import things that transitively
 * reach here. Cached because a pool per request is not a pool.
 */
let cached: PostgresClient | null = null;

export function postgresClient(): PostgresClient {
  if (cached) return cached;
  const config = databaseConfig();
  cached = createPostgresClient(neonPool(config), config);
  return cached;
}

/** Drops the cached client. For tests and for scripts that need to exit. */
export async function closePostgresClient(): Promise<void> {
  if (!cached) return;
  const client = cached;
  cached = null;
  await client.end();
}
