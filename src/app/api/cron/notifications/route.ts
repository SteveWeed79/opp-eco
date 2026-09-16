import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { drainPending } from "@/services/outbox";
import { logger } from "@/services/logging";

/**
 * Drain the notification queue on a schedule.
 *
 * Every write path already drains after it commits, which covers the common
 * case and hides the interesting one. A message that failed transiently goes
 * back on the queue and then waits for **somebody else's** unrelated write to
 * push it out — on a quiet Tuesday evening in a rural market, that is not a
 * retry, it is an hour or a night. And a write path that forgets to call
 * `drainPending` leaves its message there indefinitely with nothing to notice.
 *
 * So the queue gets a clock of its own. Nothing here is new machinery: it calls
 * the same drain, which is already idempotent, already never throws, and
 * already records every outcome in the outbox.
 *
 * `vercel.json` carries a daily entry, and daily is the Hobby plan's ceiling
 * rather than a considered interval — a transient failure waiting up to
 * twenty-four hours for a sweep is a floor, not a schedule. Every write path
 * still drains as it commits, so this catches what nothing else swept. On Pro,
 * or on any scheduler that can send an authenticated GET, every five minutes is
 * the number to use:
 *
 *   { "crons": [{ "path": "/api/cron/notifications", "schedule": "*\/5 * * * *" }] }
 */

export const dynamic = "force-dynamic";

/**
 * Who may run it.
 *
 * A drain is not a read: it sends email, and an endpoint anyone can hit is an
 * endpoint anyone can use to empty a queue at a moment of their choosing. The
 * secret is compared in constant time — it is short, it is compared often, and
 * a byte-at-a-time comparison against a value an attacker can retry is exactly
 * the shape that leaks.
 *
 * Absent, the route refuses. Not "allows because unconfigured": a scheduler
 * nobody configured is a scheduler nobody is running, and failing open here
 * would mean the one deployment that forgot the secret is the one with an open
 * endpoint.
 */
function authorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; a generic
  // scheduler can send the same header.
  const presented = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (presented.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    // 404, not 401. A 401 confirms the endpoint exists and is worth coming
    // back to with a better guess.
    return new NextResponse("Not found", { status: 404 });
  }

  const result = await drainPending();

  // Logged whatever the result, because "the cron ran and there was nothing to
  // do" and "the cron has not run since Friday" must not look the same in a log.
  logger.info("cron.notifications", result);

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
