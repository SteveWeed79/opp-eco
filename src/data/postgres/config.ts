/**
 * Database configuration, and the guard around it.
 *
 * Absent configuration means **no database**, not a broken one. With
 * `DATABASE_URL` unset the app keeps running on the in-memory store, which is
 * the behaviour every existing test and the whole demo depend on. That is the
 * same shape as `emailConfig`: a missing secret turns a capability off rather
 * than taking the process down, because the safe direction here is "the demo
 * still works" and not "production is down because a preview branch lost an
 * environment variable".
 *
 * The one thing this *does* refuse is a connection string it cannot recognise.
 * A malformed URL that reaches the driver fails deep inside a WebSocket
 * handshake with an error nobody can act on; failing here names the variable.
 */

/**
 * Which driver opens the connection.
 *
 * `neon` speaks the wire protocol over a WebSocket to Neon's proxy and is what
 * a serverless deployment wants; `pg` is an ordinary TCP connection and is the
 * only one that can reach a local or self-hosted Postgres. Inferred from the
 * host rather than configured, because the host is what decides it — a
 * `.neon.tech` URL cannot be served by `pg` over a plain socket, and a
 * `localhost` URL cannot be served by Neon's proxy at all.
 */
export type DatabaseDriver = "neon" | "pg";

/** Postgres transaction isolation, spelled the way `BEGIN` wants it. */
export type IsolationLevel =
  | "read committed"
  | "repeatable read"
  | "serializable";

export interface DatabaseConfig {
  /** Null when unset — the caller falls back to the in-memory store. */
  connectionString: string | null;
  /**
   * The driver to open it with. Inferred from the host, overridable with
   * `DATABASE_DRIVER` for a Neon-compatible proxy that does not carry the
   * hostname — which is the only case inference cannot get right.
   */
  driver: DatabaseDriver;
  /**
   * Send non-transactional statements over HTTP rather than the WebSocket.
   *
   * Neon's driver can route a single `query()` through a plain fetch, which
   * skips the WebSocket handshake entirely. On a serverless deployment that
   * handshake is most of the latency of a short read, and every read this app
   * performs outside a transaction is a short read.
   *
   * Transactions are unaffected: they check out a session and always use the
   * WebSocket, because interactive `BEGIN … COMMIT` cannot work over one-shot
   * HTTP requests.
   */
  queryViaFetch: boolean;
  /** Ceiling on pooled sessions. Neon's free tier is small; so is this. */
  maxConnections: number;
  /**
   * Isolation for transactions that do not ask for their own.
   *
   * `read committed` matches Postgres' own default. It is deliberately not
   * `serializable` across the board: most transactions here write one row plus
   * an audit entry, and paying for predicate locks on all of them to protect
   * the one that needs it is the wrong trade. The funding authorization — the
   * read-then-write against a finite allocation — asks for `serializable`
   * explicitly at its call site, which is also where the retry belongs.
   */
  defaultIsolation: IsolationLevel;
  /**
   * How many times a transaction is retried after Postgres refuses it for
   * serialization failure or deadlock. Both are the database telling you to
   * try again, not that the work was wrong.
   */
  maxRetries: number;
  /**
   * Refuse every write.
   *
   * **On by default whenever a database is configured.** Pointing the demo at
   * real Postgres and pointing it at a writable one are different decisions,
   * and conflating them means the first person to click "Approve" on a shared
   * demo mutates data everyone else is looking at. Opt in explicitly with
   * `DATABASE_READ_ONLY=false`; the seed script bypasses this entirely,
   * because loading fixtures is not a write the web application makes.
   */
  readOnly: boolean;
}

export type DatabaseEnv = Record<string, string | undefined>;

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigError";
  }
}

export function databaseConfig(env: DatabaseEnv = process.env): DatabaseConfig {
  const raw = env.DATABASE_URL?.trim();
  const connectionString = raw ? validateConnectionString(raw) : null;

  return {
    connectionString,
    driver: driverFrom(env.DATABASE_DRIVER, connectionString),
    // Opt out rather than in. The fast path should be the default, and the
    // variable exists so a bug in it can be turned off without a deploy.
    queryViaFetch: env.DATABASE_QUERY_VIA_FETCH !== "false",
    maxConnections: positiveInt(env.DATABASE_MAX_CONNECTIONS, 10),
    defaultIsolation: isolationFrom(env.DATABASE_ISOLATION),
    maxRetries: positiveInt(env.DATABASE_MAX_RETRIES, 3),
    readOnly: env.DATABASE_READ_ONLY !== "false",
  };
}

/** Whether the app should use Postgres at all. */
export function isDatabaseConfigured(env: DatabaseEnv = process.env): boolean {
  return databaseConfig(env).connectionString !== null;
}

/**
 * Reject what the driver would only reject later, and less usefully.
 *
 * Neon hands you two connection strings — a direct one and a pooled one whose
 * host carries `-pooler`. Both work; the pooled one is what a serverless
 * deployment wants, because the direct endpoint gives every cold start its own
 * backend and a free-tier project runs out of those quickly. That is a warning
 * rather than an error: a direct URL is correct for migrations, and this same
 * config loads them.
 */
function validateConnectionString(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DatabaseConfigError(
      "DATABASE_URL is not a URL. Expected postgresql://user:password@host/db?sslmode=require",
    );
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new DatabaseConfigError(
      `DATABASE_URL must be a postgres:// or postgresql:// URL, got ${url.protocol}//`,
    );
  }
  if (!url.hostname) {
    throw new DatabaseConfigError("DATABASE_URL has no host");
  }
  if (!url.pathname.replace(/^\//, "")) {
    throw new DatabaseConfigError("DATABASE_URL names no database");
  }

  return raw;
}

const DRIVERS: DatabaseDriver[] = ["neon", "pg"];

/**
 * Pick a driver, preferring what the operator said over what the host implies.
 *
 * The inference is one-directional on purpose: a Neon host *must* use Neon's
 * driver, and everything else must use `pg`. There is no host for which both
 * work, so this is a dispatch rather than a preference — and getting it wrong
 * fails inside a handshake with an error that names neither the host nor the
 * driver, which is why it is decided here where both are in hand.
 */
function driverFrom(
  value: string | undefined,
  connectionString: string | null,
): DatabaseDriver {
  if (value !== undefined && value.trim() !== "") {
    const normalized = value.trim().toLowerCase();
    const match = DRIVERS.find((driver) => driver === normalized);
    if (!match) {
      throw new DatabaseConfigError(
        `DATABASE_DRIVER must be one of ${DRIVERS.join(", ")} — got "${value}"`,
      );
    }
    return match;
  }

  if (!connectionString) return "pg";
  const host = new URL(connectionString).hostname.toLowerCase();
  return host === "neon.tech" || host.endsWith(".neon.tech") ? "neon" : "pg";
}

const ISOLATION_LEVELS: IsolationLevel[] = [
  "read committed",
  "repeatable read",
  "serializable",
];

function isolationFrom(value: string | undefined): IsolationLevel {
  if (!value) return "read committed";
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ");
  const match = ISOLATION_LEVELS.find((level) => level === normalized);
  if (!match) {
    throw new DatabaseConfigError(
      `DATABASE_ISOLATION must be one of ${ISOLATION_LEVELS.join(", ")} — got "${value}"`,
    );
  }
  return match;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}
