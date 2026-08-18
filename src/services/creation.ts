/**
 * Creating applications and postings.
 *
 * The write path for *new* records, as `transitions.ts` is for existing ones.
 * Kept out of that module because the checks are different in kind: a
 * transition asks whether an actor may move something they can already see,
 * and a creation asks whether they may bring something into existence at all.
 *
 * Both go through a Store transaction so the record and its audit entry commit
 * together, and neither trusts the caller for anything the server can derive.
 */

import type {
  ActorContext,
  Application,
  MentorshipOffer,
  MentorshipOfferStatus,
  Posting,
  PostingStatus,
} from "@/domain/types";
import { scoreMatch } from "@/domain/matching";
import { canApply, canTransact, transactBlockReason } from "@/domain/lifecycle";
import { repositories } from "@/data/backend";
import { store } from "@/data/backend";
import type { NotificationIntent, Store } from "@/data/store";

export type CreateResult<T> =
  | { ok: true; created: T }
  | { ok: false; error: string; code: "forbidden" | "not_found" | "duplicate" };

export interface CreationDeps {
  store: Store;
  now: () => Date;
  /** Injected so tests are not at the mercy of a counter shared across runs. */
  id: (prefix: string) => string;
}

let sequence = 0;
const defaultDeps: CreationDeps = {
  store,
  now: () => new Date(),
  id: (prefix) => `${prefix}-${Date.now().toString(36)}${(++sequence).toString(36)}`,
};

/**
 * A student applies to a posting.
 *
 * The match score is computed here rather than accepted from the request. It
 * is shown to employers and sorts their queue, so a caller who could set their
 * own score could put themselves at the top of every list.
 */
export async function submitApplication(
  actor: ActorContext,
  postingId: string,
  deps: CreationDeps = defaultDeps,
): Promise<CreateResult<Application>> {
  if (actor.membership.role !== "student") {
    return { ok: false, error: "Only students can apply.", code: "forbidden" };
  }

  const posting = await repositories.postings.find(actor, postingId);
  if (!posting) {
    return { ok: false, error: "That opportunity is no longer listed.", code: "not_found" };
  }
  if (posting.status !== "published") {
    return {
      ok: false,
      error: "That opportunity is not open for applications.",
      code: "forbidden",
    };
  }

  const student = await repositories.students.forUser(actor, actor.user.id);
  if (!student) {
    return { ok: false, error: "No student record for this account.", code: "not_found" };
  }

  // The college portal has always said students cannot apply until verified.
  // Nothing enforced it — verification was a status the college could not
  // change and no code read. An unverified student in an employer's candidate
  // list defeats the only reason the list is trustworthy: that a college
  // stood behind the enrolment.
  if (!canApply(student)) {
    return {
      ok: false,
      error:
        "Your college has not verified your enrollment yet. Applications open once they do.",
      code: "forbidden",
    };
  }

  // Likewise for the employer's side of the transaction. A business still in
  // vetting could take applications, take a student onto their site, and
  // approve hours a board would reimburse.
  const employer = await repositories.organizations.find(actor, posting.businessId);
  if (employer && !canTransact(employer)) {
    return {
      ok: false,
      error: "That employer is not currently able to take applications.",
      code: "forbidden",
    };
  }

  // One application per student per posting. Applying twice is a mistake, not
  // a second candidacy, and it would double-count in every funnel.
  const existing = (await repositories.applications.list(actor)).find(
    (a) => a.postingId === postingId && a.studentId === student.id,
  );
  if (existing) {
    return {
      ok: false,
      error: "You have already applied to this opportunity.",
      code: "duplicate",
    };
  }

  const college = await repositories.organizations.find(actor, student.collegeId);
  const at = deps.now().toISOString();

  const application: Application = {
    id: deps.id("app"),
    marketId: posting.marketId,
    postingId: posting.id,
    studentId: student.id,
    track: posting.track,
    status: "submitted",
    furthestStatus: "submitted",
    submittedOn: at,
    statusSince: at,
    matchScore: scoreMatch(student, posting, college?.county ?? posting.county),
    version: 1,
  };

  await deps.store.transaction((uow) => {
    uow.createApplication(application);
    uow.appendAuditEvent({
      marketId: application.marketId,
      at,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "application",
      entityId: application.id,
      from: null,
      to: "submitted",
      viaOverride: false,
    });
    uow.enqueueNotification({
      marketId: application.marketId,
      recipientUserId: `contact:${posting.businessId}`,
      recipientOrganizationId: posting.businessId,
      kind: "application.submitted",
      payload: {
        studentName: student.name,
        postingTitle: posting.title,
        score: application.matchScore.score,
      },
    });
  });

  return { ok: true, created: application };
}

/**
 * An employer creates a posting.
 *
 * It starts at `pending_review`, never `published`. The college is the local
 * operator and reviews postings before students see them — an employer who
 * could publish directly would bypass the review that makes a posting
 * credit-bearing.
 *
 * `businessId` and `marketId` come from the actor's own membership rather than
 * the request, so an employer cannot post on a competitor's behalf or into
 * another market.
 */
export async function createPosting(
  actor: ActorContext,
  fields: Omit<Posting, "id" | "marketId" | "businessId" | "status" | "createdOn">,
  /**
   * Messages this creation causes, enqueued in the same transaction — the
   * caller cannot know the posting's id until it exists, so it receives one.
   */
  notifications?: (posting: Posting) => NotificationIntent[],
  deps: CreationDeps = defaultDeps,
): Promise<CreateResult<Posting>> {
  if (actor.membership.role !== "business") {
    return { ok: false, error: "Only employers can post.", code: "forbidden" };
  }
  const { organizationId, marketId } = actor.membership;
  if (!organizationId || !marketId) {
    return { ok: false, error: "This account has no organization.", code: "forbidden" };
  }

  // "Nothing transacts until an organization is approved" was written on the
  // admin console and enforced nowhere. Posting is the first thing an
  // unvetted employer would do.
  const employer = await repositories.organizations.find(actor, organizationId);
  if (!employer) {
    return { ok: false, error: "This account has no organization.", code: "forbidden" };
  }
  const blocked = transactBlockReason(employer);
  if (blocked) {
    return { ok: false, error: blocked, code: "forbidden" };
  }

  const at = deps.now().toISOString();
  const status: PostingStatus = "pending_review";

  const posting: Posting = {
    ...fields,
    id: deps.id("post"),
    marketId,
    businessId: organizationId,
    status,
    createdOn: at,
  };

  await deps.store.transaction((uow) => {
    uow.createPosting(posting);
    uow.appendAuditEvent({
      marketId,
      at,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "posting",
      entityId: posting.id,
      from: null,
      to: status,
      viaOverride: false,
    });
    for (const intent of notifications?.(posting) ?? []) {
      uow.enqueueNotification(intent);
    }
  });

  return { ok: true, created: posting };
}

/**
 * An employer offers to mentor students.
 *
 * It starts `open`, which is the one place this deliberately differs from
 * `createPosting`. A posting waits at `pending_review` because the college is
 * underwriting an academic claim; a mentorship carries no credit, no wage and
 * no public money, so there is nothing for a review to decide and a queue in
 * front of it would only stall the one offer an employer makes on impulse.
 *
 * Vetting still applies, and applies harder if anything. Mentorship puts an
 * adult in front of a student with no supervisor, no timesheet, and no board
 * interview in between — the checks that surround a placement are exactly the
 * ones absent here, which leaves "is this employer who they say they are" doing
 * all the work.
 */
export async function offerMentorship(
  actor: ActorContext,
  fields: Omit<
    MentorshipOffer,
    "id" | "marketId" | "businessId" | "status" | "createdOn"
  >,
  /** Enqueued in the same transaction; the caller cannot know the id yet. */
  notifications?: (offer: MentorshipOffer) => NotificationIntent[],
  deps: CreationDeps = defaultDeps,
): Promise<CreateResult<MentorshipOffer>> {
  if (actor.membership.role !== "business") {
    return { ok: false, error: "Only employers can offer mentorship.", code: "forbidden" };
  }
  const { organizationId, marketId } = actor.membership;
  if (!organizationId || !marketId) {
    return { ok: false, error: "This account has no organization.", code: "forbidden" };
  }

  const employer = await repositories.organizations.find(actor, organizationId);
  if (!employer) {
    return { ok: false, error: "This account has no organization.", code: "forbidden" };
  }
  const blocked = transactBlockReason(employer);
  if (blocked) {
    return { ok: false, error: blocked, code: "forbidden" };
  }

  const at = deps.now().toISOString();
  const status: MentorshipOfferStatus = "open";

  const offer: MentorshipOffer = {
    ...fields,
    id: deps.id("men"),
    marketId,
    businessId: organizationId,
    status,
    createdOn: at,
  };

  await deps.store.transaction((uow) => {
    uow.createMentorshipOffer(offer);
    uow.appendAuditEvent({
      marketId,
      at,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "mentorship_offer",
      entityId: offer.id,
      from: null,
      to: status,
      viaOverride: false,
    });
    for (const intent of notifications?.(offer) ?? []) {
      uow.enqueueNotification(intent);
    }
  });

  return { ok: true, created: offer };
}
