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
  Posting,
  PostingStatus,
} from "@/domain/types";
import { scoreMatch } from "@/domain/matching";
import { repositories } from "@/data/memory";
import { memoryStore } from "@/data/memory-store";
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
  store: memoryStore,
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

  const posting = repositories.postings.find(actor, postingId);
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

  const student = repositories.students.forUser(actor, actor.user.id);
  if (!student) {
    return { ok: false, error: "No student record for this account.", code: "not_found" };
  }

  // One application per student per posting. Applying twice is a mistake, not
  // a second candidacy, and it would double-count in every funnel.
  const existing = repositories.applications
    .list(actor)
    .find((a) => a.postingId === postingId && a.studentId === student.id);
  if (existing) {
    return {
      ok: false,
      error: "You have already applied to this opportunity.",
      code: "duplicate",
    };
  }

  const college = repositories.organizations.find(actor, student.collegeId);
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
