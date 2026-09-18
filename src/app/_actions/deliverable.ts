/**
 * The shared body of the micro track's hand-in actions.
 *
 * Not Server Actions themselves, for the reason `outcome.ts` and
 * `escalation.ts` are not: each portal exports its own `"use server"` wrapper
 * with its role hardcoded, because Server Actions accept direct POSTs and a
 * single action taking a role from the request would let a caller accept their
 * own work.
 */

import { revalidatePath } from "next/cache";
import { actorForPortal } from "@/auth/session";
import { attemptWrite, type ActionResult } from "@/app/_actions/transition";
import {
  acceptDeliverable,
  requestRevision,
  submitDeliverable,
} from "@/services/deliverable";
import {
  answerDeliverableInput,
  submitDeliverableInput,
  validate,
} from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { PORTAL_PATH } from "@/routes";

/**
 * Three surfaces, and the college is the one worth naming.
 *
 * It never touches a deliverable and its page changes anyway: acceptance is
 * what makes a micro placement's hours count toward a credit, so the credit
 * queue gains a row the moment an employer takes the work.
 */
const AFFECTED = [PORTAL_PATH.student, PORTAL_PATH.business, PORTAL_PATH.college];

export async function handInWork(
  applicationId: unknown,
  summary: unknown,
): Promise<ActionResult> {
  const input = validate(submitDeliverableInput, { applicationId, summary });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal("student");
  const limit = checkRateLimit(callerKey("deliverable", actor.user.id), LIMITS.mutation);
  if (!limit.ok) {
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const result = await attemptWrite(() => submitDeliverable(actor, input.data));
  if (!result.ok) {
    logger.warn("deliverable.refused", { code: result.code });
    return { ok: false, error: result.error };
  }
  logger.info("deliverable.submitted", {
    deliverableId: result.updated.id,
    round: result.updated.round,
  });
  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}

export async function acceptWork(
  deliverableId: unknown,
  evaluation: unknown,
): Promise<ActionResult> {
  const input = validate(answerDeliverableInput, { deliverableId, response: evaluation });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal("business");
  const result = await attemptWrite(() =>
    acceptDeliverable(actor, input.data.deliverableId, input.data.response),
  );
  if (!result.ok) {
    logger.warn("deliverable.refused", { code: result.code });
    return { ok: false, error: result.error };
  }
  logger.info("deliverable.accepted", { deliverableId: input.data.deliverableId });
  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}

export async function askForChange(
  deliverableId: unknown,
  response: unknown,
): Promise<ActionResult> {
  const input = validate(answerDeliverableInput, { deliverableId, response });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal("business");
  const result = await attemptWrite(() =>
    requestRevision(actor, input.data.deliverableId, input.data.response),
  );
  if (!result.ok) {
    logger.warn("deliverable.refused", { code: result.code });
    return { ok: false, error: result.error };
  }
  logger.info("deliverable.revision_requested", {
    deliverableId: input.data.deliverableId,
  });
  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}
