"use server";

import { revalidatePath } from "next/cache";
import { runTransition, type ActionResult } from "@/app/_actions/transition";
import { actorForPortal } from "@/auth/session";
import { repositories } from "@/data/memory";
import { executeTransition } from "@/services/transitions";
import { bookInterviewInput, validate } from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";

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

  const slot = repositories.interviewSlots
    .list(actor)
    .find((s) => s.id === input.data.slotId);

  if (!slot) {
    return { ok: false, error: "That interview slot is no longer listed." };
  }
  if (slot.bookedByStudentId) {
    return { ok: false, error: "Someone booked that slot first. Pick another." };
  }

  const application = repositories.applications.find(actor, input.data.applicationId);
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
    notifications: (moved) => {
      const student = repositories.students.find(actor, moved.studentId);
      const posting = repositories.postings.find(actor, moved.postingId);
      const board = repositories.organizations.find(actor, slot.boardId);
      return [
        {
          // The board that owns the slot, not a hardcoded officer. Booking a
          // Flint Hills slot used to email the Southeast Kansas contact.
          recipientUserId: `contact:${slot.boardId}`,
          recipientOrganizationId: board?.id ?? slot.boardId,
          kind: "interview.booked.board",
          payload: {
            studentName: student?.name,
            postingTitle: posting?.title,
            startsAt: slot.startsAt,
          },
        },
        {
          // Likewise the employer that owns the posting. This was pinned to
          // Apex Robotics' contact, so booking an interview for a Frontier
          // Health placement told Apex about it.
          recipientUserId: `contact:${posting?.businessId ?? "unknown"}`,
          recipientOrganizationId: posting?.businessId,
          kind: "interview.booked.employer",
          payload: { postingTitle: posting?.title, startsAt: slot.startsAt },
        },
      ];
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
