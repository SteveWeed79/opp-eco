import { NextResponse } from "next/server";
import { getActor } from "@/auth/session";
import { logger } from "@/services/logging";
import { healthReport, type HealthStatus } from "@/services/health";
import { requestId } from "@/services/request-id";

/**
 * Health, in two resolutions.
 *
 * An uptime monitor needs an unauthenticated endpoint, and an unauthenticated
 * endpoint is reconnaissance if it answers in detail. "Postgres is not
 * answering", "0010_files.sql has not been applied", "clamd at 10.0.0.4:3310"
 * — each is a sentence written for an operator and a gift to anybody else. So
 * anonymous callers get the verdict and nothing else: three words, no check
 * names, no versions, no configuration, no error text.
 *
 * An administrator gets the whole report. They can already read every record in
 * every market; the state of the queue is not what is being protected from
 * them.
 *
 * `degraded` deliberately answers **200**. A status page that pages someone at
 * 3am because sending is redirected to a test address has taught them to
 * ignore it, and an application that is serving requests is up. Only `failing`
 * — the database gone, the schema behind, sign-on refusing to boot — is a 503.
 */

export const dynamic = "force-dynamic";

function httpStatusFor(status: HealthStatus): number {
  return status === "failing" ? 503 : 200;
}

export async function GET() {
  const report = await healthReport();

  // Logged whatever the caller is allowed to see, because the point of the
  // check is that somebody notices. A monitor polling this is also, for free,
  // a heartbeat in the log.
  if (report.status !== "ok") {
    logger.warn("health.not_ok", {
      status: report.status,
      failing: report.checks.filter((c) => c.status !== "ok").map((c) => c.name),
    });
  }

  // Resolving the actor is itself a database read on a code-mode deployment,
  // and this endpoint has to answer when the database is the thing that is
  // down. So a failure to work out who is calling means "not an administrator"
  // rather than an error.
  let isAdmin = false;
  try {
    isAdmin = (await getActor())?.membership.role === "admin";
  } catch {
    isAdmin = false;
  }

  // The id is on the response header for every caller. Repeating it in the
  // body is for the administrator reading this in a browser, who would
  // otherwise have to open devtools to quote it.
  const body = isAdmin ? { ...report, requestId: await requestId() } : { status: report.status };

  return NextResponse.json(body, {
    status: httpStatusFor(report.status),
    headers: {
      // Never cached, by anything. A cached health check is a health check
      // that reports the state of some earlier minute.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
