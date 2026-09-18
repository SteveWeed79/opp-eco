"use server";

import { revalidatePath } from "next/cache";
import { attemptWrite, runTransition, type ActionResult } from "@/app/_actions/transition";
import { raiseProblem, withdrawProblem } from "@/app/_actions/escalation";
import { handInWork } from "@/app/_actions/deliverable";
import { actorForPortal } from "@/auth/session";
import { repositories } from "@/data/backend";
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
import { isDemonstrationVisitor } from "@/auth/visitor";
import { recordApplied } from "@/demo/overlay";
import { drainPending } from "@/services/outbox";
import { updateProfile } from "@/services/profile";
import { recordFollowUp } from "@/app/_actions/outcome";
import { PORTAL_PATH } from "@/routes";

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

  const result = await attemptWrite(() =>
    executeTransition(actor, {
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
    }),
  );

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

  const result = await attemptWrite(() => logHours(actor, input.data));
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

  // A visitor walking the demonstration cannot write, and should still be able
  // to press the button — an inert prototype is a screenshot. Their action is
  // recorded in their own cookie and the repositories render the consequence,
  // so nothing reaches the database and every other visitor still meets the
  // demonstration exactly as seeded. See `src/demo/overlay.ts`.
  if (await isDemonstrationVisitor()) {
    const posting = await repositories.postings.find(actor, input.data.postingId);
    if (!posting || posting.status !== "published") {
      return { ok: false, error: "That opportunity is no longer listed." };
    }
    await recordApplied(posting.id);
    revalidatePath("/demo/student");
    return { ok: true };
  }

  const result = await attemptWrite(() =>
    submitApplication(actor, input.data.postingId),
  );
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

/**
 * Edit your own profile.
 *
 * The role is hardcoded here as everywhere, and `updateProfile` checks it
 * again — a wrapper is a convenience, the service is the rule. What this adds
 * is the shape check: a Server Action is a URL and every value arriving here
 * came off the wire.
 */
export async function saveProfile(edit: unknown): Promise<ActionResult> {
  const actor = await actorForPortal("student");

  const limit = checkRateLimit(callerKey("saveProfile", actor.user.id), LIMITS.mutation);
  if (!limit.ok) {
    return {
      ok: false,
      error: `Too many changes at once. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  if (typeof edit !== "object" || edit === null) {
    return { ok: false, error: "That form did not arrive intact." };
  }

  const fields = edit as Record<string, unknown>;
  const strings = ["programOfStudy", "classStanding", "expectedGraduation"] as const;
  for (const key of strings) {
    if (typeof fields[key] !== "string") {
      return { ok: false, error: "That form did not arrive intact." };
    }
  }
  for (const key of ["skills", "interests"] as const) {
    if (
      !Array.isArray(fields[key]) ||
      (fields[key] as unknown[]).some((tag) => typeof tag !== "string")
    ) {
      return { ok: false, error: "That form did not arrive intact." };
    }
  }

  const result = await attemptWrite(() =>
    updateProfile(actor, {
      programOfStudy: fields.programOfStudy as string,
      classStanding: fields.classStanding as string,
      expectedGraduation: fields.expectedGraduation as string,
      skills: fields.skills as string[],
      interests: fields.interests as string[],
      availableHoursPerWeek: Number(fields.availableHoursPerWeek),
    }),
  );

  if (!result.ok) return { ok: false, error: result.error };
  // Every portal that matches on skills reads this record, so every portal's
  // view of it can go stale.
  for (const path of Object.values(PORTAL_PATH)) revalidatePath(path);
  return { ok: true };
}

/**
 * Say where you are now, after a placement that has finished.
 *
 * The role is hardcoded here as it is in every wrapper in this directory, and
 * the service refuses the learner for anybody's record but their own — twice
 * over, since `studentScope` makes another learner's record unresolvable in the
 * first place.
 *
 * `studentId` still crosses the wire rather than being derived from the
 * session, because the service takes it and checks it. A caller who sends
 * somebody else's gets a refusal that says so, which is the honest answer; a
 * silently substituted id would mean a learner could file a record and be shown
 * a success for something that never happened.
 */
export async function studentRecordOwnOutcome(
  studentId: unknown,
  applicationId: unknown,
  kind: unknown,
  observedOn: unknown,
  detail?: unknown,
  employedByHost?: unknown,
  employmentCounty?: unknown,
  employmentState?: unknown,
): Promise<ActionResult> {
  return recordFollowUp(
    "student",
    studentId,
    applicationId,
    kind,
    observedOn,
    detail,
    employedByHost,
    employmentCounty,
    employmentState,
  );
}

/**
 * Report a problem with a placement.
 *
 * The role is hardcoded here rather than taken from the request — see
 * `_actions/escalation.ts`. Everybody may raise one; whether this actor can
 * see the placement they named is the repository's answer, not this file's.
 */
export async function studentRaiseProblem(
  applicationId: unknown,
  kind: unknown,
  summary: unknown,
): Promise<ActionResult> {
  return raiseProblem("student", applicationId, kind, summary);
}

/** Take back a report they raised themselves. */
export async function studentWithdrawProblem(escalationId: unknown): Promise<ActionResult> {
  return withdrawProblem("student", escalationId);
}

/**
 * Hand in a micro-internship's work, or hand it in again.
 *
 * The role is pinned here rather than taken from the request — see
 * `_actions/deliverable.ts`. The service checks again that this learner owns
 * the placement and that it is a running micro one.
 */
export async function studentHandInWork(
  applicationId: unknown,
  summary: unknown,
): Promise<ActionResult> {
  return handInWork(applicationId, summary);
}
