"use server";

import { revalidatePath } from "next/cache";
import { contextFor } from "@/data/session";
import { repositories } from "@/data/memory";
import { executeTransition } from "@/services/transitions";
import { bookInterviewInput, validate } from "@/services/validation";

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

  const actor = contextFor("student");

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
      return [
        {
          recipientUserId: "u-marcia",
          kind: "interview.booked.board",
          payload: {
            studentName: student?.name,
            postingTitle: posting?.title,
            startsAt: slot.startsAt,
          },
        },
        {
          recipientUserId: "u-dana",
          kind: "interview.booked.employer",
          payload: { postingTitle: posting?.title, startsAt: slot.startsAt },
        },
      ];
    },
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/student");
  revalidatePath("/board");
  revalidatePath("/admin");
  return { ok: true };
}
