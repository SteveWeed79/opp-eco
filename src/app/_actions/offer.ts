/**
 * The shared body of the host-answer action.
 *
 * Not a Server Action itself, for the reason `outcome.ts` is not: each portal
 * exports its own `"use server"` wrapper with its role **hardcoded**. Server
 * Actions accept direct POSTs, and a single action taking a role from the
 * request would let anybody file a hiring decision as an employer's firsthand
 * answer — which is the one thing this record has to be trusted about.
 *
 * Who may answer is `HOST_OFFER_RECORDERS` in the domain: the employer, and an
 * administrator writing down what an employer said on the phone. The service
 * checks it again regardless of which wrapper called.
 */

import { revalidatePath } from "next/cache";
import type { ActorRole } from "@/domain/types";
import { actorForPortal } from "@/auth/session";
import { attemptWrite, type ActionResult } from "@/app/_actions/transition";
import { recordHostOffer } from "@/services/creation";
import { recordHostOfferInput, validate } from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { PORTAL_PATH } from "@/routes";

/**
 * Three surfaces change: the employer's own list loses a row, the
 * administrator's chase queue loses one, and — when the answer is a hire — the
 * college's follow-up queue loses one too, because the outcome was written
 * alongside the answer.
 *
 * Deliberately **no notification**, for the reason the follow-up action gives:
 * this is a record of something that already happened. Emailing a learner to
 * say their host employer has written down that it made them no offer would be
 * a message nobody asked for about a record they did not choose to have made.
 */
const AFFECTED = [PORTAL_PATH.business, PORTAL_PATH.admin, PORTAL_PATH.college];

export async function answerHostOffer(
  role: ActorRole,
  applicationId: unknown,
  answer: unknown,
  note?: unknown,
): Promise<ActionResult> {
  const input = validate(recordHostOfferInput, {
    applicationId,
    answer,
    // A form posts "" for a note nobody filled in, which is the ordinary case:
    // the note is never required and most answers will not carry one.
    note: note === "" || note === null || note === undefined ? undefined : note,
  });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal(role);

  const limit = checkRateLimit(callerKey("hostOffer", actor.user.id), LIMITS.mutation);
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", { action: "hostOffer", userId: actor.user.id });
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const result = await attemptWrite(() => recordHostOffer(actor, input.data));

  if (!result.ok) {
    logger.warn("host_offer.refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  logger.info("host_offer.recorded", {
    offerId: result.created.id,
    answer: result.created.answer,
    source: result.created.source,
  });

  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}
