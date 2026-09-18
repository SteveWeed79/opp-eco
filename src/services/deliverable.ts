/**
 * Handing in the work, and the employer's answer to it.
 *
 * The write side of `domain/deliverable.ts`, and the two paths the micro track
 * has always been missing. `Application.deliverableSubmitted` has guarded the
 * employer's *Accept deliverable* transition since the first migration and was
 * written only by the seed, so the gate existed and nothing could open it.
 *
 * Three operations, and the asymmetry between them is the design:
 *
 *  - **Submitting is not a status change.** The application stays
 *    `placement_active`. Work being handed in and a placement being finished
 *    are different facts, and the existing transition already draws that line —
 *    so this sets the flag the guard reads and leaves the machine alone.
 *  - **Accepting is.** It goes through `executeTransition` rather than around
 *    it, because accepting *is* completing the placement on this track. The
 *    transition already exists, is labelled "Accept deliverable", and carries
 *    its own audit entry and notifications; this adds the patch and the record
 *    and inherits the rest.
 *  - **A revision is a round, not a rejection.** It puts `deliverableSubmitted`
 *    back to false — which takes the employer's own Accept button away again —
 *    and leaves the placement running.
 *
 * The flags on the application and the row here are written in the same
 * transaction, always. They are two views of one fact and a deployment where
 * they disagree is one where the micro track behaves differently on the two
 * backends for no visible reason.
 */

import type { ActorContext, Application, Deliverable } from "@/domain/types";
import { respondBlockReason, submitBlockReason } from "@/domain/deliverable";
import { repositories, store } from "@/data/backend";
import type { Store, UnitOfWork } from "@/data/store";
import { executeTransition } from "./transitions";

export type DeliverableResult =
  | { ok: true; updated: Deliverable }
  | { ok: false; error: string; code: "forbidden" | "not_found" | "conflict" };

export interface DeliverableDeps {
  store: Store;
  now: () => Date;
  id: (prefix: string) => string;
}

let sequence = 0;
const defaultDeps: DeliverableDeps = {
  store,
  now: () => new Date(),
  id: (prefix) => `${prefix}-${Date.now().toString(36)}${(++sequence).toString(36)}`,
};

export interface SubmitDeliverableInput {
  applicationId: string;
  summary: string;
  /** The stored file's key, when they attached one. */
  fileKey?: string | null;
}

/**
 * The learner hands in their work, or hands it in again.
 *
 * Only on the micro track and only on their own placement — both checked here
 * rather than assumed, because the control that calls this renders on a page
 * the learner controls the shape of.
 *
 * A resubmission is the same row at a higher round, which is what makes "the
 * third version" a number rather than a join.
 */
export async function submitDeliverable(
  actor: ActorContext,
  input: SubmitDeliverableInput,
  deps: DeliverableDeps = defaultDeps,
): Promise<DeliverableResult> {
  if (actor.membership.role !== "student") {
    return { ok: false, error: "Only the learner hands in their own work.", code: "forbidden" };
  }

  const application = await repositories.applications.find(actor, input.applicationId);
  if (!application) {
    return { ok: false, error: "That placement was not found.", code: "not_found" };
  }
  if (application.track !== "micro") {
    // A standard placement is assessed on approved hours and a supervisor's
    // evaluation, neither of which this record is.
    return {
      ok: false,
      error: "Only micro-internships are handed in this way.",
      code: "forbidden",
    };
  }
  if (application.status !== "placement_active") {
    return {
      ok: false,
      error: "This placement is not running, so there is nothing to hand in against.",
      code: "conflict",
    };
  }

  const student = await repositories.students.forUser(actor, actor.user.id);
  if (!student || student.id !== application.studentId) {
    return { ok: false, error: "That is not your placement.", code: "forbidden" };
  }

  const existing = await repositories.deliverables.forApplication(actor, application.id);
  const refusal = submitBlockReason({ summary: input.summary, existing });
  if (refusal) return { ok: false, error: refusal, code: "conflict" };

  const at = deps.now().toISOString();
  const summary = input.summary.trim();
  const fileKey = input.fileKey ?? null;

  const deliverable: Deliverable = existing
    ? {
        ...existing,
        summary,
        fileKey,
        submittedOn: at,
        status: "submitted",
        // The employer's previous instruction is cleared along with their
        // answer: it belonged to the round that has just been superseded, and
        // leaving it would read as a response to work they have not seen.
        response: undefined,
        respondedOn: null,
        respondedByUserId: null,
        round: existing.round + 1,
      }
    : {
        id: deps.id("del"),
        marketId: application.marketId,
        applicationId: application.id,
        studentId: student.id,
        summary,
        fileKey,
        submittedOn: at,
        status: "submitted",
        respondedOn: null,
        respondedByUserId: null,
        round: 1,
        version: 1,
      };

  const application_ = { ...application, deliverableSubmitted: true };

  // Resolved before the transaction opens, and resolved at all because the
  // recipient conventions here are `contact:<organization id>` and a real user
  // id — not something a caller can compose from an application. Addressing a
  // message to an id that resolves to nothing is dropped into the outbox,
  // which is the place nobody checks.
  const posting = await repositories.postings.find(actor, application.postingId);

  await deps.store.transaction((uow) => {
    if (existing) uow.saveDeliverable(deliverable, existing.version);
    else uow.createDeliverable(deliverable);
    // The flag and the row together, always — see the note at the top.
    uow.saveApplication(application_, application.version);
    audit(uow, actor, deliverable, existing ? "resubmitted" : "submitted", null);
    if (posting) {
      uow.enqueueNotification({
        marketId: application.marketId,
        recipientUserId: `contact:${posting.businessId}`,
        recipientOrganizationId: posting.businessId,
        kind: "deliverable.submitted",
        payload: {
          postingTitle: posting.title,
          round: deliverable.round,
        },
      });
    }
  });

  return {
    ok: true,
    updated: { ...deliverable, version: (existing?.version ?? 0) + 1 },
  };
}

/**
 * The employer sends the work back with an instruction.
 *
 * Not a rejection and not an ending: the placement keeps running and the
 * learner can hand in again. Clearing `deliverableSubmitted` is what takes the
 * employer's own *Accept deliverable* button away until they have something new
 * to accept.
 */
export async function requestRevision(
  actor: ActorContext,
  deliverableId: string,
  response: string,
  deps: DeliverableDeps = defaultDeps,
): Promise<DeliverableResult> {
  const found = await load(actor, deliverableId);
  if (!found.ok) return found.error;
  const { deliverable, application } = found;

  if (!canRespond(actor, application)) {
    return {
      ok: false,
      error: "Only the employer hosting this placement can answer it.",
      code: "forbidden",
    };
  }

  const refusal = respondBlockReason(deliverable, "revision_requested", response);
  if (refusal) return { ok: false, error: refusal, code: "conflict" };

  // Same reasoning as the submit path: the learner's user id lives on their
  // student record and cannot be composed from an application.
  const student = await repositories.students.find(actor, deliverable.studentId);
  const posting = await repositories.postings.find(actor, application.postingId);

  const at = deps.now().toISOString();
  const updated: Deliverable = {
    ...deliverable,
    status: "revision_requested",
    response: response.trim(),
    respondedOn: at,
    respondedByUserId: actor.user.id,
  };

  await deps.store.transaction((uow) => {
    uow.saveDeliverable(updated, deliverable.version);
    uow.saveApplication(
      { ...application, deliverableSubmitted: false },
      application.version,
    );
    audit(uow, actor, updated, "revision_requested", updated.response ?? null);
    if (student) {
      uow.enqueueNotification({
        marketId: application.marketId,
        recipientUserId: student.userId,
        kind: "deliverable.revision_requested",
        payload: {
          postingTitle: posting?.title ?? "your project",
          round: updated.round,
        },
      });
    }
  });

  return { ok: true, updated: { ...updated, version: deliverable.version + 1 } };
}

/**
 * The employer takes the work, which completes the placement.
 *
 * Through `executeTransition` rather than around it: accepting *is* completing
 * on this track, the transition already exists with the guard this record
 * satisfies, and going around it would mean reimplementing the audit entry, the
 * notification policy and the funding settlement that hang off a status change.
 *
 * The note is required by `respondBlockReason`, because acceptance is the
 * evaluation and an empty one is the whole academic record of a credit-bearing
 * placement.
 */
export async function acceptDeliverable(
  actor: ActorContext,
  deliverableId: string,
  evaluation: string,
  deps: DeliverableDeps = defaultDeps,
): Promise<DeliverableResult> {
  const found = await load(actor, deliverableId);
  if (!found.ok) return found.error;
  const { deliverable, application } = found;

  if (!canRespond(actor, application)) {
    return {
      ok: false,
      error: "Only the employer hosting this placement can accept it.",
      code: "forbidden",
    };
  }

  const refusal = respondBlockReason(deliverable, "accepted", evaluation);
  if (refusal) return { ok: false, error: refusal, code: "conflict" };

  const at = deps.now().toISOString();
  const updated: Deliverable = {
    ...deliverable,
    status: "accepted",
    response: evaluation.trim(),
    respondedOn: at,
    respondedByUserId: actor.user.id,
  };

  const result = await executeTransition(actor, {
    applicationId: application.id,
    to: "placement_completed",
    // `deliverableAccepted` is what `workHoursFor` reads to decide the micro
    // posting's hours count toward a credit, so it lands with the status rather
    // than in a second write that could fail on its own.
    patch: { deliverableAccepted: true },
    sideEffects: (uow) => {
      uow.saveDeliverable(updated, deliverable.version);
      audit(uow, actor, updated, "accepted", updated.response ?? null);
    },
    payload: { round: updated.round },
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      code: result.code === "not_found" ? "not_found" : "conflict",
    };
  }
  return { ok: true, updated: { ...updated, version: deliverable.version + 1 } };
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

type Loaded =
  | { ok: true; deliverable: Deliverable; application: Application }
  | { ok: false; error: DeliverableResult & { ok: false } };

async function load(actor: ActorContext, deliverableId: string): Promise<Loaded> {
  const deliverable = await repositories.deliverables.find(actor, deliverableId);
  if (!deliverable) {
    return {
      ok: false,
      error: { ok: false, error: "That hand-in was not found.", code: "not_found" },
    };
  }
  const application = await repositories.applications.find(
    actor,
    deliverable.applicationId,
  );
  if (!application) {
    return {
      ok: false,
      error: { ok: false, error: "That placement was not found.", code: "not_found" },
    };
  }
  return { ok: true, deliverable, application };
}

/**
 * Whether this actor may answer.
 *
 * The employer hosting the placement, and nobody else — not the college, which
 * reads the acceptance when it awards credit but does not make it, and not an
 * administrator, because an operator deciding that a learner's work was good
 * enough is the one judgement here that is genuinely not theirs.
 */
function canRespond(actor: ActorContext, application: Application): boolean {
  return (
    actor.membership.role === "business" &&
    application.marketId === actor.membership.marketId
  );
}

function audit(
  uow: UnitOfWork,
  actor: ActorContext,
  deliverable: Deliverable,
  to: string,
  reason: string | null,
) {
  uow.appendAuditEvent({
    marketId: deliverable.marketId,
    at: deliverable.respondedOn ?? deliverable.submittedOn,
    actorUserId: actor.user.id,
    actorRole: actor.membership.role,
    entityType: "deliverable",
    entityId: deliverable.id,
    from: null,
    to: `${to} · round ${deliverable.round}`,
    // The employer's words go in, unlike an escalation's summary: this record
    // is readable by the learner, the employer, the college and the
    // administrator already, so the log is not wider than the thing it logs.
    reason: reason ?? undefined,
    viaOverride: false,
  });
}
