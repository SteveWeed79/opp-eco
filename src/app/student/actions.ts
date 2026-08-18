"use server";

import { revalidatePath } from "next/cache";
import { runTransition, type ActionResult } from "@/app/_actions/transition";
import { actorForPortal } from "@/auth/session";
import { repositories } from "@/data/memory";
import { executeTransition } from "@/services/transitions";
import {
  applyInput,
  bookInterviewInput,
  logHoursInput,
  validate,
} from "@/services/validation";
import { logHours } from "@/services/timesheet";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { submitApplication } from "@/services/creation";
import { drainPending } from "@/services/outbox";

/**
 * Book a workforce board interview.
 *
 * The mutation that closes the pause — the gap between mutual interest and a
 * funded start, where placements die. One click books the slot, moves the
 * application, writes the audit record, and notifies the board and the
 * employer, atomically.
 *
 * Authorization is re-checked inside, not assumed from the caller: Server
 * Actions accept direct POSTs, so a button being absent from the page proves
 * nothing about what someone can attempt.
 */
export async function bookInterviewSlot(
  applicationId: unknown,
  slotId: unknown,
): Promise<{ ok: boolean; error?: string }> {
  // Validate before anything else. The arguments arrive over the wire and are
  // typed `unknown` on purpose — a caller posting directly is not bound by the
  // signature the UI happens to use.
  const input = validate(bookInterviewInput, { applicationId, slotId });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal("student");

  // Bound how fast this can be called. Without it, an attacker learns which
  // application ids exist from which errors come back.
  const limit = checkRateLimit(
    callerKey("bookInterview", actor.user.id),
    LIMITS.mutation,
  );
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", {
      action: "bookInterview",
      userId: actor.user.id,
    });
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const slot = (await repositories.interviewSlots.list(actor)).find(
    (s) => s.id === input.data.slotId,
  );

  if (!slot) {
    return { ok: false, error: "That interview slot is no longer listed." };
  }
  if (slot.bookedByStudentId) {
    return { ok: false, error: "Someone booked that slot first. Pick another." };
  }

  const application = await repositories.applications.find(actor, input.data.applicationId);
  if (!application) {
    return { ok: false, error: "Application not found." };
  }

  const result = await executeTransition(actor, {
    applicationId: input.data.applicationId,
    to: "interview_scheduled",
    patch: { interviewSlotId: input.data.slotId },
    // Claiming the slot belongs to the same transaction as moving the
    // application. A booked slot with an unmoved application, or the reverse,
    // is a placement nobody is tracking.
    sideEffects: (uow, moved) => {
      uow.saveInterviewSlot(
        {
          ...slot,
          bookedByStudentId: moved.studentId,
          bookedAt: new Date().toISOString(),
          meetingUrl: `https://meet.example.org/${slot.boardId}-${moved.studentId}`,
        },
        slot.version,
      );
    },
    // Who hears about a booking is decided by the notification policy, not
    // here — the student, the board, and the employer all get a message keyed
    // to `interview_scheduled`. All this adds is the one fact the policy
    // cannot know: which slot was taken.
    payload: {
      startsAt: slot.startsAt,
      officerName: slot.officerName,
      durationMinutes: slot.durationMinutes,
    },
  });

  if (!result.ok) {
    logger.warn("transition.refused", {
      action: "bookInterview",
      applicationId: input.data.applicationId,
      code: result.code,
    });
    return { ok: false, error: result.error };
  }

  logger.info("interview.booked", {
    applicationId: input.data.applicationId,
    slotId: input.data.slotId,
  });

  revalidatePath("/student");
  revalidatePath("/board");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Everything else a student can do: confirm interest after being shortlisted,
 * withdraw, submit completed work for credit.
 *
 * `bookInterviewSlot` stays separate because it claims a slot in the same
 * transaction as the status change — the one transition here that writes to a
 * second entity.
 */
export async function studentTransition(
  applicationId: unknown,
  to: unknown,
  reason?: unknown,
): Promise<ActionResult> {
  return runTransition("student", { applicationId, to, reason });
}

/**
 * Log a week of hours against an active placement.
 *
 * Everything identifying is derived server-side: the student comes from the
 * session and the employer from the posting. The request carries only the
 * week, the hours, and what was worked on — the three things the caller is
 * actually the authority on.
 */
export async function logPlacementHours(
  applicationId: unknown,
  weekStarting: unknown,
  hours: unknown,
  summary: unknown,
): Promise<ActionResult> {
  const input = validate(logHoursInput, {
    applicationId,
    weekStarting,
    // The form sends a string; coercing here keeps the schema honest about
    // what it accepts rather than making it tolerate both.
    hours: typeof hours === "string" ? Number(hours) : hours,
    summary,
  });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal("student");

  const limit = checkRateLimit(callerKey("logHours", actor.user.id), LIMITS.mutation);
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", { action: "logHours", userId: actor.user.id });
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const result = await logHours(actor, input.data);
  if (!result.ok) {
    logger.warn("hours.refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  logger.info("hours.logged", {
    applicationId: input.data.applicationId,
    entryId: result.value.id,
  });

  await drainPending();
  revalidatePath("/student");
  revalidatePath("/business");
  return { ok: true };
}

/**
 * Apply to a posting.
 *
 * A creation rather than a transition, so it does not route through
 * `runTransition` — there is no existing application to move. The match score
 * is computed server-side; a caller who could send their own would sort
 * themselves to the top of every employer's queue.
 */
export async function applyToPosting(postingId: unknown): Promise<ActionResult> {
  const input = validate(applyInput, { postingId });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal("student");

  const limit = checkRateLimit(callerKey("apply", actor.user.id), LIMITS.mutation);
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", { action: "apply", userId: actor.user.id });
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const result = await submitApplication(actor, input.data.postingId);
  if (!result.ok) {
    logger.warn("application.refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  logger.info("application.submitted", { applicationId: result.created.id });

  await drainPending();
  revalidatePath("/student");
  revalidatePath("/business");
  revalidatePath("/admin");
  return { ok: true };
}
