"use server";

import { revalidatePath } from "next/cache";
import { actorForPortal } from "@/auth/session";
import { repositories } from "@/data/backend";
import { isSelfSufficientForCredit } from "@/domain/credit";
import { createPosting } from "@/services/creation";
import { postingInput, validate } from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { drainPending } from "@/services/outbox";
import type { ActionResult } from "@/app/_actions/transition";

/**
 * Publish a new opportunity — or rather, submit one for review.
 *
 * The employer supplies the content; the server supplies everything that
 * decides who it belongs to. `businessId` and `marketId` come from the
 * membership, and the status is always `pending_review`, because the college
 * is the local operator and a posting students can see is one a college has
 * agreed carries credit.
 */
export async function submitPosting(fields: unknown): Promise<ActionResult> {
  // The two tracks are validated as a discriminated union rather than one
  // object with everything optional: a micro posting carrying `wagePerHour` is
  // not a slightly wrong standard posting, it is a misunderstanding of the
  // model, and it should fail here rather than half-render later.
  const input = validate(postingInput, fields);
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal("business");

  const limit = checkRateLimit(callerKey("postOpportunity", actor.user.id), LIMITS.mutation);
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", {
      action: "postOpportunity",
      userId: actor.user.id,
    });
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  // The college that reviews this market's postings. Resolved before the write
  // so the notification can be enqueued inside the same transaction — a
  // posting that exists with nobody told is the queue-nobody-watches failure
  // this platform is built around.
  const college = (
    await repositories.organizations.list(actor, { kind: "college" })
  ).find((o) => o.marketId === actor.membership.marketId);
  const business = await repositories.organizations.find(
    actor,
    actor.membership.organizationId ?? "",
  );

  const result = await createPosting(actor, input.data, (posting) =>
    college
      ? [
          {
            marketId: posting.marketId,
            recipientUserId: `contact:${college.id}`,
            recipientOrganizationId: college.id,
            kind: "posting.submitted",
            payload: {
              postingTitle: posting.title,
              businessName: business?.name ?? "An employer",
              selfSufficient: isSelfSufficientForCredit(
                posting,
                college.hoursPerCredit ?? 45,
              ),
            },
          },
        ]
      : [],
  );

  if (!result.ok) {
    logger.warn("posting.refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  logger.info("posting.created", { postingId: result.created.id });

  await drainPending();
  revalidatePath("/business");
  revalidatePath("/college");
  revalidatePath("/admin");
  return { ok: true };
}
