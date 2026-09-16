/**
 * Whether this deployment is working, and if not, which part.
 *
 * The question an operator actually has is never "is the process running" —
 * the process is nearly always running. It is "why did nobody get told", "why
 * can't anyone sign in", and "is the database the one I think it is". So these
 * are checks against the things that have silently failed in this codebase's
 * own history: a queue that filled while nothing drained it, a mode switch that
 * made every page throw at boot, a schema one migration behind the code reading
 * it.
 *
 * **Nothing here may name a person.** A health report is the one thing in this
 * application designed to be read by a monitor, a status page, and whoever is
 * on call — none of which have the access controls the database has. Every
 * detail string is a count, a duration, or a configuration value, and
 * `health.test.ts` asserts that against every seeded learner.
 */

import { backend } from "@/data/backend";
import { postgresClient } from "@/data/postgres/pool";
import { databaseConfig } from "@/data/postgres/config";
import { outboxFor } from "@/services/outbox";
import { emailConfig } from "@/services/email/config";
import { authConfig, AuthConfigError } from "@/auth/config";
import { scannerConfig, uploadRefusalReason } from "@/services/uploads/config";

export type HealthStatus = "ok" | "degraded" | "failing";

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  /**
   * One line somebody can act on. A count, a duration, or a setting — never a
   * record, a name, or an error message that might quote one.
   */
  detail: string;
  /** How long the check took, when it did I/O worth timing. */
  ms?: number;
}

export interface HealthReport {
  status: HealthStatus;
  checkedAt: string;
  checks: HealthCheck[];
}

/**
 * The newest migration this build expects to find applied.
 *
 * A constant rather than a directory listing, because a health check must not
 * depend on the repository's files being present at runtime — on a serverless
 * deployment they are not. `migrations.test.ts` asserts this matches the last
 * file on disk, so the constant cannot drift without the suite saying so.
 */
export const EXPECTED_MIGRATION = "0014_outcome_place.sql";

/** The worst of several verdicts, which is what an overall status means. */
export function worstOf(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("failing")) return "failing";
  if (statuses.includes("degraded")) return "degraded";
  return "ok";
}

/**
 * A message still waiting after this long is stuck rather than in flight.
 *
 * Age, not depth. This read queue depth as a proxy while the queue carried no
 * timestamp, and depth answers the wrong question: thirty messages draining
 * steadily are healthy, and one that has been there since Tuesday is not, and
 * the two look identical from a count. The queue now records when each message
 * arrived — the Postgres table always had the column and nobody read it — so
 * this can ask what it meant to ask.
 */
export const STUCK_AFTER_MS = 30 * 60 * 1000;

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  const value = await work();
  return { value, ms: Date.now() - started };
}

async function checkDataLayer(): Promise<HealthCheck> {
  const { usesDatabase, readOnly } = backend();

  if (!usesDatabase) {
    // Not a fault. It is the demonstration's configuration, and saying so is
    // the point — "why did my change disappear" has this as its answer.
    return {
      name: "data",
      status: "ok",
      detail: "Seeded fixtures in the server process. Nothing is persisted.",
    };
  }

  try {
    const { ms } = await timed(() => postgresClient().query("SELECT 1"));
    return {
      name: "data",
      status: "ok",
      detail: `Postgres, ${databaseConfig().driver} driver, writes ${readOnly ? "refused" : "enabled"}.`,
      ms,
    };
  } catch {
    // The error text is deliberately dropped rather than reported. A
    // connection failure quotes the host, the user, and sometimes the
    // password, and this report is read by things that should see none of it.
    return {
      name: "data",
      status: "failing",
      detail: "Postgres is not answering.",
    };
  }
}

async function checkSchema(): Promise<HealthCheck> {
  if (!backend().usesDatabase) {
    return { name: "schema", status: "ok", detail: "No database to migrate." };
  }

  try {
    const { value: rows, ms } = await timed(() =>
      postgresClient().query<{ name: string }>(
        "SELECT name FROM schema_migrations WHERE name = $1",
        [EXPECTED_MIGRATION],
      ),
    );
    if (rows.length > 0) {
      return { name: "schema", status: "ok", detail: `Up to date at ${EXPECTED_MIGRATION}.`, ms };
    }
    // Failing rather than degraded: the code in this build reads columns the
    // database does not have yet, so this is not a service running a little
    // behind, it is one about to throw on a page nobody has opened yet.
    return {
      name: "schema",
      status: "failing",
      detail: `${EXPECTED_MIGRATION} has not been applied. Run npm run db:migrate.`,
      ms,
    };
  } catch {
    return {
      name: "schema",
      status: "failing",
      detail: "Cannot read the migration ledger.",
    };
  }
}

async function checkNotifications(now: Date): Promise<HealthCheck> {
  const email = emailConfig();

  try {
    const { value, ms } = await timed(() => outboxFor(null));
    const undeliverable = value.delivered.filter((n) => n.state === "undeliverable").length;
    const failed = value.delivered.filter((n) => n.state === "failed").length;
    const oldest = value.pending.reduce<number>((worst, waiting) => {
      const waited = now.getTime() - new Date(waiting.queuedAt).getTime();
      return Number.isFinite(waited) && waited > worst ? waited : worst;
    }, 0);
    const stuck = oldest > STUCK_AFTER_MS;

    const notes: string[] = [];
    if (undeliverable) notes.push(`${undeliverable} undeliverable`);
    if (failed) notes.push(`${failed} failed`);
    if (stuck) {
      notes.push(`oldest has waited ${Math.round(oldest / 60_000)} minutes`);
    }

    // Said first and always, because it is the thing that surprises people:
    // a queue that looks healthy and a mailbox nobody is filling are the same
    // picture from here.
    const delivery = !email.enabled
      ? "Sending is off; messages are recorded only"
      : email.redirectTo
        ? "Sending is on, redirected to a single address"
        : "Sending is on";

    if (notes.length === 0) {
      return {
        name: "notifications",
        status: "ok",
        detail: `${delivery}. ${value.pending.length} queued.`,
        ms,
      };
    }
    return {
      name: "notifications",
      status: "degraded",
      detail: `${delivery}. ${notes.join(", ")}.`,
      ms,
    };
  } catch {
    return {
      name: "notifications",
      status: "failing",
      detail: "Cannot read the outbox.",
    };
  }
}

function checkSignOn(): HealthCheck {
  try {
    const { mode, echoCodes } = authConfig();
    return {
      name: "sign-on",
      status: "ok",
      detail:
        mode === "code"
          ? `One-time codes${echoCodes ? ", echoed to the server log" : ""}.`
          : "The demonstration's role picker.",
    };
  } catch (error) {
    // This one is worth its own check because of how it fails: `authConfig`
    // throws at the top of every render, so a misconfigured deployment serves
    // 500s on every page including the one an operator would open to find out
    // why. The message is safe — it is this codebase's own text about
    // environment variables, and names no value.
    return {
      name: "sign-on",
      status: "failing",
      detail:
        error instanceof AuthConfigError
          ? error.message
          : "Sign-on configuration is invalid.",
    };
  }
}

function checkUploads(): HealthCheck {
  const refusal = uploadRefusalReason();
  if (refusal) {
    // Degraded, not failing. Everything else works; files are turned off, on
    // purpose, and the operator needs to know it is a setting rather than a
    // bug they should go looking for.
    return { name: "uploads", status: "degraded", detail: refusal };
  }

  const scanner = scannerConfig();
  return {
    name: "uploads",
    status: "ok",
    detail:
      scanner.mode === "clamav"
        ? `Scanned by clamd at ${scanner.host}:${scanner.port}.`
        : "Scanned by the stand-in, which detects the EICAR test string only.",
  };
}

/**
 * Run everything, in parallel, and report the worst.
 *
 * In parallel because a health check that takes as long as the sum of its parts
 * is one that times out under exactly the conditions it exists to report.
 */
export async function healthReport(now: Date = new Date()): Promise<HealthReport> {
  const checks = await Promise.all([
    checkDataLayer(),
    checkSchema(),
    checkNotifications(now),
    Promise.resolve(checkSignOn()),
    Promise.resolve(checkUploads()),
  ]);

  return {
    status: worstOf(checks.map((check) => check.status)),
    checkedAt: now.toISOString(),
    checks,
  };
}
