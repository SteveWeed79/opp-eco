"use server";

import { revalidatePath } from "next/cache";
import { attemptWrite, runTransition, type ActionResult } from "@/app/_actions/transition";
import { closeIntroduction } from "@/app/_actions/mentorship";
import { answerHostOffer } from "@/app/_actions/offer";
import { raiseProblem, withdrawProblem } from "@/app/_actions/escalation";
import { acceptWork, askForChange } from "@/app/_actions/deliverable";
import { actorForPortal } from "@/auth/session";
import { reviewHours } from "@/services/timesheet";
import { reviewHoursInput, validate } from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { drainPending } from "@/services/outbox";

/**
 * Employer-side transitions.
 *
 * The role is fixed here rather than taken from the request. Everything else —
 * whether this employer owns the posting, whether the move is legal from the
 * current status — is decided by the state machine, not by which buttons the
 * page happened to render.
 */
export async function businessTransition(
  applicationId: unknown,
  to: unknown,
  reason?: unknown,
): Promise<ActionResult> {
  return runTransition("business", { applicationId, to, reason });
}

/**
 * Approve a week of a student's hours, or send it back.
 *
 * The supervisor's signature is what turns a claim into a record. It is the
 * only attestation in the system that the work actually happened, and the
 * workforce board reimburses public money against it — so it is a deliberate
 * act by the party that was there, not a side effect of the placement running.
 */
export async function reviewPlacementHours(
  entryId: unknown,
  decision: unknown,
  note?: unknown,
): Promise<ActionResult> {
  const input = validate(reviewHoursInput, { entryId, decision, note });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal("business");

  const limit = checkRateLimit(callerKey("reviewHours", actor.user.id), LIMITS.mutation);
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", { action: "reviewHours", userId: actor.user.id });
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const result = await attemptWrite(() => reviewHours(actor, input.data));
  if (!result.ok) {
    logger.warn("hours.review_refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  logger.info("hours.reviewed", {
    entryId: result.value.id,
    decision: input.data.decision,
  });

  await drainPending();
  revalidatePath("/business");
  revalidatePath("/student");
  revalidatePath("/board");
  return { ok: true };
}


/**
 * Say whether an introduction happened.
 *
 * The employer's own record and nobody else's: they are the only party who
 * knows whether the student turned up. Closing it gives the mentor's place
 * back, which is what keeps declared capacity honest over a year.
 */
export async function businessCloseIntroduction(
  pairingId: unknown,
  to: unknown,
  note: unknown,
): Promise<ActionResult> {
  return closeIntroduction("business", pairingId, to, note);
}

/**
 * Say what happened at the end of a placement.
 *
 * The role is hardcoded here, as everywhere in this file. The wrapper's whole
 * job is that a direct POST cannot claim to be somebody else — and it matters
 * more for this write than for most, because the value of the record is that
 * the employer said it.
 */
export async function answerPlacementOffer(
  applicationId: unknown,
  answer: unknown,
  note?: unknown,
): Promise<ActionResult> {
  return answerHostOffer("business", applicationId, answer, note);
}

/**
 * Report a problem with a placement.
 *
 * The role is hardcoded here rather than taken from the request — see
 * `_actions/escalation.ts`. Everybody may raise one; whether this actor can
 * see the placement they named is the repository's answer, not this file's.
 */
export async function businessRaiseProblem(
  applicationId: unknown,
  kind: unknown,
  summary: unknown,
): Promise<ActionResult> {
  return raiseProblem("business", applicationId, kind, summary);
}

/** Take back a report they raised themselves. */
export async function businessWithdrawProblem(escalationId: unknown): Promise<ActionResult> {
  return withdrawProblem("business", escalationId);
}

/**
 * Take the work, or ask for a change.
 *
 * Accepting completes the placement and writes the evaluation the college reads
 * when it awards credit, so both go through the service rather than through a
 * bare transition: the note is the point.
 */
export async function businessAcceptWork(
  deliverableId: unknown,
  evaluation: unknown,
): Promise<ActionResult> {
  return acceptWork(deliverableId, evaluation);
}

export async function businessAskForChange(
  deliverableId: unknown,
  response: unknown,
): Promise<ActionResult> {
  return askForChange(deliverableId, response);
}
