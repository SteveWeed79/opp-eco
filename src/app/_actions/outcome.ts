/**
 * The shared body of the follow-up action.
 *
 * Not a Server Action itself, for the reason `transition.ts` and
 * `mentorship.ts` are not: each portal exports its own `"use server"` wrapper
 * with its role **hardcoded**. A single action taking a role from the request
 * would let anyone file an employment claim as a college's finding, and Server
 * Actions accept direct POSTs.
 *
 * Who may record is `OUTCOME_RECORDERS` in the domain — the college and an
 * administrator. The service checks it again regardless of which wrapper
 * called, because a wrapper is a convenience and the domain is the rule.
 */

import { revalidatePath } from "next/cache";
import type { ActorRole } from "@/domain/types";
import { actorForPortal } from "@/auth/session";
import { attemptWrite, type ActionResult } from "@/app/_actions/transition";
import { recordOutcome } from "@/services/creation";
import { recordOutcomeInput, validate } from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { PORTAL_PATH } from "@/routes";

/**
 * Two surfaces change: the college's follow-up queue loses a row, and the
 * administrator's measure gains one.
 *
 * Deliberately **no notification.** Every other write here tells somebody
 * because somebody is waiting on it; a follow-up is a record of something that
 * already happened, and emailing a learner to say their college has written
 * down where they work would be a message nobody asked for about a record they
 * did not choose to have made.
 */
const AFFECTED = [PORTAL_PATH.college, PORTAL_PATH.admin];

const blank = (value: unknown) =>
  value === "" || value === null || value === undefined ? undefined : value;

export async function recordFollowUp(
  role: ActorRole,
  studentId: unknown,
  applicationId: unknown,
  kind: unknown,
  observedOn: unknown,
  detail: unknown,
  employedByHost?: unknown,
  employmentCounty?: unknown,
  employmentState?: unknown,
): Promise<ActionResult> {
  const input = validate(recordOutcomeInput, {
    studentId,
    // A form posts "" for an unselected placement, and the schema takes a
    // string or null. Normalising here keeps the "no placement" case one value
    // rather than three that mean the same thing.
    applicationId: applicationId === "" || applicationId === undefined ? null : applicationId,
    kind,
    observedOn,
    detail: blank(detail),
    // A form posts "" for a county nobody filled in, which is the ordinary case
    // for a follow-up that established somebody is working and not where.
    employedByHost: employedByHost === undefined ? undefined : Boolean(employedByHost),
    employmentCounty: blank(employmentCounty),
    employmentState: blank(employmentState),
  });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal(role);

  const limit = checkRateLimit(callerKey("outcome", actor.user.id), LIMITS.mutation);
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", { action: "outcome", userId: actor.user.id });
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const result = await attemptWrite(() => recordOutcome(actor, input.data));

  if (!result.ok) {
    logger.warn("outcome.refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  logger.info("outcome.recorded", {
    outcomeId: result.created.id,
    kind: result.created.kind,
  });

  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}
