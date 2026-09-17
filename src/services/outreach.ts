/**
 * Working the chase queue: one nudge, one button, no prose.
 *
 * The administrator's console lists finished placements nobody has answered
 * for, split into the employer's half and the learner's half. This is what the
 * button on each row does — it sends the party a short standing message asking
 * the one question that row is waiting on.
 *
 * **There is deliberately no compose box.** A free-text field here would be the
 * only place in this product where a person's own prose leaves the building,
 * and the rule every template obeys — no message names the learner it is about
 * — cannot be enforced on a sentence somebody typed. `withoutParticipantPII`
 * strips payload *keys*; a name inside a string is not a key. A nudge that says
 * nothing needs no checking, and the conversation that follows happens in a
 * reply, between two people, outside a system that would otherwise have to
 * store it.
 *
 * **The employer's note is never quoted.** It is readable by its author and the
 * administrator and nobody else, and a product that mails it onward has undone
 * that with one button.
 *
 * Sending twice is allowed and not tracked. A second nudge three weeks later is
 * the normal way this works, and a "already asked" flag would turn an ordinary
 * follow-up into something the administrator has to route around.
 */

import type { ActorContext } from "@/domain/types";
import { hasExited } from "@/domain/outcome";
import { repositories, store } from "@/data/backend";
import type { Store } from "@/data/store";
import { logger } from "@/services/logging";

export type NudgeAudience = "employer" | "learner";

export interface NudgeInput {
  applicationId: string;
  audience: NudgeAudience;
}

export type NudgeResult =
  | { ok: true; sentTo: NudgeAudience }
  | { ok: false; error: string; code: "forbidden" | "not_found" };

export interface OutreachDeps {
  store: Store;
  now: () => Date;
}

const defaultDeps: OutreachDeps = { store, now: () => new Date() };

/**
 * Ask the employer what it did, or the learner where they went.
 *
 * The administrator alone. The college works its own follow-up queue from its
 * own portal and does not need a second route to the same people; the board has
 * no business chasing either party; and the employer being asked is the subject
 * of the question rather than a sender of it.
 */
export async function sendFollowUpNudge(
  actor: ActorContext,
  input: NudgeInput,
  deps: OutreachDeps = defaultDeps,
): Promise<NudgeResult> {
  if (actor.membership.role !== "admin") {
    return {
      ok: false,
      error: "Only an administrator can send a follow-up.",
      code: "forbidden",
    };
  }

  const application = await repositories.applications.find(actor, input.applicationId);
  if (!application) {
    return { ok: false, error: "Placement not found.", code: "not_found" };
  }
  if (!hasExited(application)) {
    // Nothing to follow up on yet, and a message asking how a live placement
    // ended is how an employer learns these are sent by a machine that is not
    // reading the record.
    return {
      ok: false,
      error: "That placement has not finished.",
      code: "forbidden",
    };
  }

  const posting = await repositories.postings.find(actor, application.postingId);
  if (!posting) {
    return { ok: false, error: "Placement not found.", code: "not_found" };
  }

  const student = await repositories.students.find(actor, application.studentId);
  if (!student) {
    return { ok: false, error: "Learner not found.", code: "not_found" };
  }

  /**
   * The payload carries a reference and a job title, and nothing else.
   *
   * `postingTitle` is the employer's own words about their own role — a
   * role-functional fact, the same category as a board officer's name on an
   * interview slot, which the data rules explicitly keep. What is absent is the
   * learner: the subject line reads `APP-21`, and the person receiving it
   * already knows which placement that is.
   */
  const payload = {
    applicationId: application.id,
    postingTitle: posting.title,
  };

  const intent =
    input.audience === "employer"
      ? {
          marketId: application.marketId,
          // The organization's contact, because most employers in a real market
          // are a name and an address long before anybody there has an account.
          recipientUserId: `contact:${posting.businessId}`,
          recipientOrganizationId: posting.businessId,
          kind: "followup.employer",
          payload,
        }
      : {
          marketId: application.marketId,
          recipientUserId: student.userId,
          kind: "followup.learner",
          payload,
        };

  await deps.store.transaction((uow) => {
    uow.enqueueNotification(intent);
    // Audited, and this is the one place in the product where the audit entry
    // is the *only* record that it happened. A nudge changes no state: nothing
    // about the placement is different afterwards, so without this there is no
    // way to answer "has anybody actually asked them?" — which is the question
    // the chase queue exists to make answerable.
    uow.appendAuditEvent({
      marketId: application.marketId,
      at: deps.now().toISOString(),
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "application",
      entityId: application.id,
      from: null,
      to: `nudged:${input.audience}`,
      viaOverride: false,
    });
  });

  logger.info("followup.nudged", {
    applicationId: application.id,
    audience: input.audience,
  });

  return { ok: true, sentTo: input.audience };
}
