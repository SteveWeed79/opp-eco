"use server";

import { revalidatePath } from "next/cache";
import { actorForPortal } from "@/auth/session";
import { repositories } from "@/data/memory";
import { mentorshipFormatLabel } from "@/domain/mentorship";
import { offerMentorship } from "@/services/creation";
import { mentorshipOfferInput, validate } from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { drainPending } from "@/services/outbox";
import type { ActionResult } from "@/app/_actions/transition";

/**
 * An employer offers to mentor students.
 *
 * Same shape as `submitPosting`, and the same division of trust: the employer
 * supplies what they are willing to do, and the server supplies everything
 * that decides whose offer it is. `businessId` and `marketId` come from the
 * membership, never the request.
 *
 * It goes live immediately rather than into a review queue — see
 * `offerMentorship` for why the college has nothing to review here — so the
 * only gate is vetting, which the service checks.
 */
export async function submitMentorshipOffer(fields: unknown): Promise<ActionResult> {
  const input = validate(mentorshipOfferInput, fields);
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal("business");

  const limit = checkRateLimit(
    callerKey("offerMentorship", actor.user.id),
    LIMITS.mutation,
  );
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", {
      action: "offerMentorship",
      userId: actor.user.id,
    });
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  // The college makes the introductions, so it is the one party that has to
  // hear about this. Resolved before the write so the message can be enqueued
  // inside the same transaction — an offer sitting in a list nobody was told
  // about is the queue-nobody-watches failure this platform is built around.
  const college = repositories.organizations
    .list(actor, { kind: "college" })
    .find((o) => o.marketId === actor.membership.marketId);
  const business = repositories.organizations.find(
    actor,
    actor.membership.organizationId ?? "",
  );

  const result = await offerMentorship(actor, input.data, (offer) =>
    college
      ? [
          {
            marketId: offer.marketId,
            recipientUserId: `contact:${college.id}`,
            recipientOrganizationId: college.id,
            kind: "mentorship.offered",
            payload: {
              businessName: business?.name ?? "An employer",
              mentorName: offer.mentorName,
              mentorRole: offer.mentorRole,
              formatLabel: mentorshipFormatLabel(offer.format),
              capacity: offer.capacity,
            },
          },
        ]
      : [],
  );

  if (!result.ok) {
    logger.warn("mentorship.refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  logger.info("mentorship.offered", { offerId: result.created.id });

  await drainPending();
  revalidatePath("/business");
  revalidatePath("/student");
  return { ok: true };
}
