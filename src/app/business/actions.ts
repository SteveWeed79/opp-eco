"use server";

import { revalidatePath } from "next/cache";
import { runTransition, type ActionResult } from "@/app/_actions/transition";
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

  const result = await reviewHours(actor, input.data);
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
