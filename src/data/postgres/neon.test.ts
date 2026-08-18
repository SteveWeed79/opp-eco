/**
 * Adapter behaviour, without a database.
 *
 * The interesting things about this adapter are what it does when a
 * transaction goes wrong: whether it rolls back, whether it returns the
 * session to the pool, and whether it retries the two Postgres codes that mean
 * "run that again". A real database is a slow and unreliable way to provoke a
 * serialization failure on demand, so the pool is a fake and the failures are
 * exact.
 */

import { describe, it, expect, vi } from "vitest";
import { createPostgresClient, type PoolClientLike, type PoolLike } from "./neon";
import {
  databaseConfig,
  DatabaseConfigError,
  isDatabaseConfigured,
} from "./config";

/** A pool that records every statement and can be told to fail on cue. */
function fakePool(options: {
  failWith?: (unknown | null)[];
  rows?: unknown[];
  failRollback?: boolean;
} = {}) {
  const statements: string[] = [];
  const released: (boolean | Error | undefined)[] = [];
  const failures = [...(options.failWith ?? [])];
  let connections = 0;

  const client: PoolClientLike = {
    async query(text: string) {
      statements.push(text);
      if (text === "ROLLBACK" && options.failRollback) {
        throw new Error("connection lost");
      }
      return { rows: options.rows ?? [] };
    },
    release(destroy?: boolean | Error) {
      released.push(destroy);
    },
  };

  const pool: PoolLike = {
    async query(text: string) {
      statements.push(text);
      return { rows: options.rows ?? [] };
    },
    async connect() {
      connections++;
      // One entry per attempt; a non-null value fails that attempt's work.
      return client;
    },
    async end() {},
  };

  return {
    pool,
    statements,
    released,
    nextFailure: () => failures.shift() ?? null,
    connectionCount: () => connections,
  };
}

const config = { defaultIsolation: "read committed" as const, maxRetries: 3 };
const noSleep = async () => {};

describe("query", () => {
  it("returns rows and passes parameters through untouched", async () => {
    const fake = fakePool({ rows: [{ id: "mkt-1" }] });
    const client = createPostgresClient(fake.pool, config, noSleep);

    const rows = await client.query("SELECT * FROM markets WHERE id = $1", ["mkt-1"]);

    expect(rows).toEqual([{ id: "mkt-1" }]);
    expect(fake.statements).toEqual(["SELECT * FROM markets WHERE id = $1"]);
  });

  it("does not open a transaction", async () => {
    const fake = fakePool();
    await createPostgresClient(fake.pool, config, noSleep).query("SELECT 1");
    expect(fake.statements).not.toContain("BEGIN");
  });
});

describe("transaction", () => {
  it("commits and releases when the work succeeds", async () => {
    const fake = fakePool();
    const client = createPostgresClient(fake.pool, config, noSleep);

    const result = await client.transaction(async (tx) => {
      await tx.query("UPDATE applications SET status = $1", ["cleared"]);
      return "done";
    });

    expect(result).toBe("done");
    expect(fake.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "UPDATE applications SET status = $1",
      "COMMIT",
    ]);
    // Released without a destroy argument: the session goes back to the pool.
    expect(fake.released).toEqual([undefined]);
  });

  it("rolls back and releases when the work throws", async () => {
    const fake = fakePool();
    const client = createPostgresClient(fake.pool, config, noSleep);

    await expect(
      client.transaction(async () => {
        throw new Error("guard refused the transition");
      }),
    ).rejects.toThrow("guard refused the transition");

    expect(fake.statements).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "ROLLBACK",
    ]);
    expect(fake.released).toEqual([undefined]);
  });

  it("destroys the session when the rollback itself fails", async () => {
    // A session whose ROLLBACK failed is in an unknown state. Handing it back
    // to the pool would give the next caller an open transaction.
    const fake = fakePool({ failRollback: true });
    const client = createPostgresClient(fake.pool, config, noSleep);

    await expect(
      client.transaction(async () => {
        throw new Error("original failure");
      }),
    ).rejects.toThrow("original failure");

    expect(fake.released).toHaveLength(1);
    expect(fake.released[0]).toBeInstanceOf(Error);
  });

  it("honours a requested isolation level", async () => {
    const fake = fakePool();
    const client = createPostgresClient(fake.pool, config, noSleep);

    await client.transaction(async () => "ok", { isolation: "serializable" });

    expect(fake.statements[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
  });

  it("can open read-only, so an unintended write is refused by the server", async () => {
    const fake = fakePool();
    const client = createPostgresClient(fake.pool, config, noSleep);

    await client.transaction(async () => "ok", {
      isolation: "repeatable read",
      readOnly: true,
    });

    expect(fake.statements[0]).toBe(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
  });
});

describe("retrying what Postgres asks to be retried", () => {
  /** The error shape node-postgres raises: a `code` carrying the SQLSTATE. */
  function sqlState(code: string) {
    return Object.assign(new Error(`postgres ${code}`), { code });
  }

  it("retries a serialization failure and returns the eventual success", async () => {
    const fake = fakePool();
    const client = createPostgresClient(fake.pool, config, noSleep);
    let attempts = 0;

    const result = await client.transaction(async () => {
      attempts++;
      // Two officers authorizing funding against one allocation: the first
      // transaction to commit wins and the second is told to try again.
      if (attempts < 3) throw sqlState("40001");
      return "authorized";
    });

    expect(result).toBe("authorized");
    expect(attempts).toBe(3);
    expect(fake.connectionCount()).toBe(3);
  });

  it("retries a deadlock", async () => {
    const fake = fakePool();
    const client = createPostgresClient(fake.pool, config, noSleep);
    let attempts = 0;

    await client.transaction(async () => {
      attempts++;
      if (attempts < 2) throw sqlState("40P01");
      return "ok";
    });

    expect(attempts).toBe(2);
  });

  it("gives up after the configured ceiling and rethrows the last failure", async () => {
    const fake = fakePool();
    const client = createPostgresClient(fake.pool, { ...config, maxRetries: 2 }, noSleep);
    let attempts = 0;

    await expect(
      client.transaction(async () => {
        attempts++;
        throw sqlState("40001");
      }),
    ).rejects.toMatchObject({ code: "40001" });

    // The first try plus two retries.
    expect(attempts).toBe(3);
  });

  it("never retries an ordinary failure", async () => {
    const fake = fakePool();
    const client = createPostgresClient(fake.pool, config, noSleep);
    let attempts = 0;

    await expect(
      client.transaction(async () => {
        attempts++;
        // A constraint violation is the database rejecting the work itself.
        // Repeating it would fail identically every time.
        throw sqlState("23505");
      }),
    ).rejects.toMatchObject({ code: "23505" });

    expect(attempts).toBe(1);
  });

  it("backs off between attempts", async () => {
    const fake = fakePool();
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const client = createPostgresClient(fake.pool, config, sleep);
    let attempts = 0;

    await client.transaction(async () => {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error("x"), { code: "40001" });
      return "ok";
    });

    expect(sleep).toHaveBeenCalledTimes(2);
    const first = sleep.mock.calls[0][0];
    const second = sleep.mock.calls[1][0];
    // Growing, and jittered so two colliding transactions do not retry in step.
    expect(second).toBeGreaterThan(first);
  });
});

describe("configuration", () => {
  it("treats an absent DATABASE_URL as 'no database', not an error", () => {
    expect(isDatabaseConfigured({})).toBe(false);
    expect(databaseConfig({}).connectionString).toBeNull();
  });

  it("accepts a Neon connection string", () => {
    const url =
      "postgresql://user:pw@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/opp_eco?sslmode=require";
    expect(databaseConfig({ DATABASE_URL: url }).connectionString).toBe(url);
    expect(isDatabaseConfigured({ DATABASE_URL: url })).toBe(true);
  });

  it("names the variable when the URL is unusable", () => {
    // Deep inside a WebSocket handshake is the wrong place to find this out.
    expect(() => databaseConfig({ DATABASE_URL: "not-a-url" })).toThrow(
      DatabaseConfigError,
    );
    expect(() => databaseConfig({ DATABASE_URL: "mysql://h/db" })).toThrow(
      /postgres:\/\//,
    );
    expect(() => databaseConfig({ DATABASE_URL: "postgresql://host" })).toThrow(
      /names no database/,
    );
  });

  it("defaults to read committed, and accepts the levels Postgres spells", () => {
    expect(databaseConfig({}).defaultIsolation).toBe("read committed");
    expect(
      databaseConfig({ DATABASE_ISOLATION: "SERIALIZABLE" }).defaultIsolation,
    ).toBe("serializable");
    expect(
      databaseConfig({ DATABASE_ISOLATION: "repeatable_read" }).defaultIsolation,
    ).toBe("repeatable read");
    expect(() => databaseConfig({ DATABASE_ISOLATION: "eventual" })).toThrow(
      DatabaseConfigError,
    );
  });

  it("routes loose reads over HTTP unless told otherwise", () => {
    expect(databaseConfig({}).queryViaFetch).toBe(true);
    expect(databaseConfig({ DATABASE_QUERY_VIA_FETCH: "false" }).queryViaFetch).toBe(
      false,
    );
  });

  it("ignores nonsense tuning rather than failing on it", () => {
    expect(databaseConfig({ DATABASE_MAX_CONNECTIONS: "0" }).maxConnections).toBe(10);
    expect(databaseConfig({ DATABASE_MAX_CONNECTIONS: "twelve" }).maxConnections).toBe(10);
    expect(databaseConfig({ DATABASE_MAX_CONNECTIONS: "4" }).maxConnections).toBe(4);
  });
});
