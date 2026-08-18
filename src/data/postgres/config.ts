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

/** Postgres transaction isolation, spelled the way `BEGIN` wants it. */
export type IsolationLevel =
  | "read committed"
  | "repeatable read"
  | "serializable";

export interface DatabaseConfig {
  /** Null when unset — the caller falls back to the in-memory store. */
  connectionString: string | null;
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

  return {
    connectionString: raw ? validateConnectionString(raw) : null,
    // Opt out rather than in. The fast path should be the default, and the
    // variable exists so a bug in it can be turned off without a deploy.
    queryViaFetch: env.DATABASE_QUERY_VIA_FETCH !== "false",
    maxConnections: positiveInt(env.DATABASE_MAX_CONNECTIONS, 10),
    defaultIsolation: isolationFrom(env.DATABASE_ISOLATION),
    maxRetries: positiveInt(env.DATABASE_MAX_RETRIES, 3),
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
