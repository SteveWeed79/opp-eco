/**
 * Raising a problem, and what the administrator does with it.
 *
 * The write side of `domain/escalation.ts`. Four operations, and the shape of
 * them is the whole argument: **anybody may raise one, only the administrator
 * closes one, and the raiser may take their own back.** That is the story's
 * "any party raises a problem, it routes to Admin" turned into code, including
 * the part nobody writes down — that the person who reported it is not then
 * stuck with it.
 *
 * Every operation goes through the repositories first, so market scoping and
 * the application's own visibility rules decide what can be escalated at all.
 * A learner naming somebody else's application gets `not_found`, because that
 * is what the repository says, rather than a permission check this file would
 * have to remember to write.
 *
 * **Nothing here notifies anybody, and that is a gap rather than a decision.**
 * The platform has no concept of an administrator on duty: administrators are
 * the one cross-market role, `NotificationIntent` addresses a user or an
 * organization, and neither can express "whoever is operating this market
 * today". Hard-coding the seeded administrator's id would put a fixture inside
 * a service, which is exactly the class of bug the repository contract exists
 * to prevent. So delivery is the console queue — `escalations.live` — until
 * there is a real answer to who gets rung at two in the morning about a safety
 * report. That question wants the operator, not a guess from here.
 */

import type { ActorContext, Escalation, EscalationKind } from "@/domain/types";
import {
  canResolve,
  canWithdraw,
  raiseBlockReason,
  transitionBlockReason,
} from "@/domain/escalation";
import { repositories, store } from "@/data/backend";
import type { Store } from "@/data/store";

export type EscalationResult =
  | { ok: true; updated: Escalation }
  | { ok: false; error: string; code: "forbidden" | "not_found" | "conflict" };

export interface EscalationDeps {
  store: Store;
  now: () => Date;
  id: (prefix: string) => string;
}

let sequence = 0;
const defaultDeps: EscalationDeps = {
  store,
  now: () => new Date(),
  id: (prefix) => `${prefix}-${Date.now().toString(36)}${(++sequence).toString(36)}`,
};

export interface RaiseEscalationInput {
  applicationId: string;
  kind: EscalationKind;
  summary: string;
}

/**
 * Somebody says a placement has gone wrong.
 *
 * The role is taken from the actor rather than the input, because who was
 * speaking is part of what was said and a caller must not be able to file a
 * complaint in somebody else's voice. An administrator recording one phoned in
 * therefore appears as the administrator, which is the truth: they wrote it
 * down, and the log should not imply the learner typed it.
 *
 * Duplicates are allowed on purpose. Two people reporting the same thing from
 * opposite sides of a placement is corroboration, and a uniqueness rule here
 * would silently discard the second account — which, given the first may have
 * come from the party at fault, is the one that matters.
 */
export async function raiseEscalation(
  actor: ActorContext,
  input: RaiseEscalationInput,
  deps: EscalationDeps = defaultDeps,
): Promise<EscalationResult> {
  const application = await repositories.applications.find(actor, input.applicationId);
  if (!application) {
    // Not "you may not": the repository already refused to show it, and saying
    // which of the two it is tells a caller whether an id exists.
    return { ok: false, error: "That placement was not found.", code: "not_found" };
  }

  const refusal = raiseBlockReason({ summary: input.summary });
  if (refusal) return { ok: false, error: refusal, code: "forbidden" };

  const at = deps.now().toISOString();
  const escalation: Escalation = {
    id: deps.id("esc"),
    marketId: application.marketId,
    applicationId: application.id,
    raisedByUserId: actor.user.id,
    raisedByRole: actor.membership.role,
    kind: input.kind,
    summary: input.summary.trim(),
    raisedOn: at,
    status: "open",
    acknowledgedOn: null,
    acknowledgedByUserId: null,
    resolvedOn: null,
    version: 1,
  };

  await deps.store.transaction((uow) => {
    uow.createEscalation(escalation);
    uow.appendAuditEvent({
      marketId: escalation.marketId,
      at,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "escalation",
      entityId: escalation.id,
      from: null,
      // The kind, because "escalation raised" answers none of the questions
      // anybody asks of the log afterwards — and the audit log is read by
      // people who cannot read the escalation itself.
      to: `open · ${escalation.kind}`,
      // Deliberately **not** the summary. The audit log is the market's, and
      // this record is the raiser's and the administrator's; copying the text
      // into a wider-readable table would undo the visibility rule the whole
      // feature rests on.
      viaOverride: false,
    });
  });

  return { ok: true, updated: escalation };
}

/** The administrator picks one up, so the raiser can see somebody has it. */
export async function acknowledgeEscalation(
  actor: ActorContext,
  escalationId: string,
  deps: EscalationDeps = defaultDeps,
): Promise<EscalationResult> {
  return move(actor, escalationId, "acknowledged", null, deps);
}

/** The administrator closes one, saying what was done. */
export async function resolveEscalation(
  actor: ActorContext,
  escalationId: string,
  resolution: string,
  deps: EscalationDeps = defaultDeps,
): Promise<EscalationResult> {
  return move(actor, escalationId, "resolved", resolution, deps);
}

/**
 * The raiser takes it back.
 *
 * Its own status rather than a resolution, because "it sorted itself out" and
 * "the administrator dealt with it" are different events, and a programme asked
 * how many problems it resolved must not be able to count the first as the
 * second.
 */
export async function withdrawEscalation(
  actor: ActorContext,
  escalationId: string,
  deps: EscalationDeps = defaultDeps,
): Promise<EscalationResult> {
  return move(actor, escalationId, "withdrawn", null, deps);
}

/**
 * The one transition path, so the permission check cannot be forgotten on one
 * of four call sites.
 */
async function move(
  actor: ActorContext,
  escalationId: string,
  to: Escalation["status"],
  resolution: string | null,
  deps: EscalationDeps,
): Promise<EscalationResult> {
  const escalation = await repositories.escalations.find(actor, escalationId);
  if (!escalation) {
    return { ok: false, error: "That report was not found.", code: "not_found" };
  }

  const permitted =
    to === "withdrawn"
      ? canWithdraw(escalation, actor.user.id)
      : canResolve(actor.membership.role);
  if (!permitted) {
    return {
      ok: false,
      error:
        to === "withdrawn"
          ? "Only the person who raised this can withdraw it."
          : "Only an administrator can act on a report.",
      code: "forbidden",
    };
  }

  const refusal = transitionBlockReason(escalation, to, resolution);
  if (refusal) return { ok: false, error: refusal, code: "conflict" };

  const at = deps.now().toISOString();
  const updated: Escalation = {
    ...escalation,
    status: to,
    acknowledgedOn:
      to === "acknowledged" ? at : escalation.acknowledgedOn,
    acknowledgedByUserId:
      to === "acknowledged" ? actor.user.id : escalation.acknowledgedByUserId,
    resolution: to === "resolved" ? resolution!.trim() : escalation.resolution,
    resolvedOn: to === "resolved" || to === "withdrawn" ? at : escalation.resolvedOn,
  };

  await deps.store.transaction((uow) => {
    uow.saveEscalation(updated, escalation.version);
    uow.appendAuditEvent({
      marketId: escalation.marketId,
      at,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "escalation",
      entityId: escalation.id,
      from: escalation.status,
      to,
      // The resolution *is* carried here, unlike the summary on the way in.
      // What was done about a problem is the market's record; what somebody
      // reported is theirs.
      reason: to === "resolved" ? updated.resolution : undefined,
      viaOverride: false,
    });
  });

  return { ok: true, updated: { ...updated, version: escalation.version + 1 } };
}
