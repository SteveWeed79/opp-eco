/**
 * The shared body of the introduction actions.
 *
 * Not a Server Action itself, for the reason `transition.ts` is not: each
 * portal exports its own `"use server"` wrapper with its role **hardcoded**.
 * A single action taking a role from the request would let anyone introduce a
 * student to an adult by posting a different string, and Server Actions accept
 * direct POSTs.
 *
 * Who may introduce is `INTRODUCERS` in the domain — the college and an
 * administrator. The service checks it again regardless of which wrapper
 * called, because a wrapper is a convenience and the domain is the rule.
 */

import { revalidatePath } from "next/cache";
import type {
  ActorRole,
  MentorshipOffer,
  MentorshipPairing,
  Student,
} from "@/domain/types";
import type { NotificationIntent } from "@/data/store";
import { mentorshipFormatLabel } from "@/domain/mentorship";
import { actorForPortal } from "@/auth/session";
import { repositories } from "@/data/backend";
import { attemptWrite, type ActionResult } from "@/app/_actions/transition";
import { introduceStudentToMentor } from "@/services/creation";
import { recordMentorshipOutcome } from "@/services/lifecycle";
import { introduceInput, introductionOutcomeInput, validate } from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { drainPending } from "@/services/outbox";
import { PORTAL_PATH } from "@/routes";

/**
 * An introduction changes what four surfaces show: the college's list loses a
 * place, the employer gains a name, the student gains a mentor, and the admin
 * console counts it.
 */
const AFFECTED = [
  PORTAL_PATH.college,
  PORTAL_PATH.business,
  PORTAL_PATH.student,
  PORTAL_PATH.admin,
];

export async function makeIntroduction(
  role: ActorRole,
  offerId: unknown,
  studentId: unknown,
): Promise<ActionResult> {
  const input = validate(introduceInput, { offerId, studentId });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal(role);

  const limit = checkRateLimit(callerKey("introduce", actor.user.id), LIMITS.mutation);
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", { action: "introduce", userId: actor.user.id });
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  // Read for the wording only. The service re-reads both through the actor and
  // decides on its own copies — this is the difference between rendering a name
  // and trusting one. A student who cannot be read here is refused there.
  const student = await repositories.students.find(actor, input.data.studentId);
  const offerForMessage = await repositories.mentorshipOffers.find(
    actor,
    input.data.offerId,
  );
  const employer = offerForMessage
    ? await repositories.organizations.find(actor, offerForMessage.businessId)
    : null;
  const college = actor.membership.organizationId
    ? await repositories.organizations.find(actor, actor.membership.organizationId)
    : null;

  const result = await attemptWrite(() =>
    introduceStudentToMentor(
      actor,
      input.data.offerId,
      input.data.studentId,
      (pairing, offer) =>
        student
          ? notificationsFor(pairing, offer, student, {
              employerName: employer?.name,
              collegeName: college?.name,
            })
          : [],
    ),
  );

  if (!result.ok) {
    logger.warn("introduction.refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  logger.info("mentorship.introduced", {
    pairingId: result.created.id,
    offerId: result.created.offerId,
  });

  await drainPending();
  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}

/**
 * Both sides are told, in one transaction with the record.
 *
 * The employer is addressed as an organization rather than a user: most of
 * them have no account here, which is the whole reason a notification carries
 * `recipientOrganizationId`.
 */
function notificationsFor(
  pairing: MentorshipPairing,
  offer: MentorshipOffer,
  student: Student,
  names: { employerName?: string; collegeName?: string },
): NotificationIntent[] {
  const formatLabel = mentorshipFormatLabel(offer.format);
  return [
    {
      marketId: pairing.marketId,
      recipientUserId: `contact:${offer.businessId}`,
      recipientOrganizationId: offer.businessId,
      kind: "mentorship.introduced.employer",
      payload: {
        // Neither the student's name nor their programme. A mentorship
        // introduction is the message most likely to be forwarded — it is a
        // warm handover — and it is addressed to an organization contact who
        // may have no account here at all.
        mentorName: offer.mentorName,
        formatLabel,
        collegeName: names.collegeName ?? "The college",
      },
    },
    {
      // The student is told who to contact and what to ask for. An
      // introduction nobody tells the student about is a row in a table.
      marketId: pairing.marketId,
      recipientUserId: student.userId,
      kind: "mentorship.introduced.student",
      payload: {
        mentorName: offer.mentorName,
        mentorRole: offer.mentorRole,
        businessName: names.employerName ?? "the employer",
        formatLabel,
      },
    },
  ];
}

export async function closeIntroduction(
  role: ActorRole,
  pairingId: unknown,
  to: unknown,
  note: unknown,
): Promise<ActionResult> {
  const input = validate(introductionOutcomeInput, { id: pairingId, to, note });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal(role);

  const limit = checkRateLimit(
    callerKey("introduction.close", actor.user.id),
    LIMITS.mutation,
  );
  if (!limit.ok) {
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const result = await attemptWrite(() =>
    recordMentorshipOutcome(actor, input.data.id, input.data.to, input.data.note),
  );

  if (!result.ok) {
    logger.warn("introduction.close_refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  logger.info("mentorship.closed", { pairingId: input.data.id, to: input.data.to });

  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}
