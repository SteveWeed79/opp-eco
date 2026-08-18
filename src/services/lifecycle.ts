/**
 * The write path for every machine other than the application's.
 *
 * `transitions.ts` does this for applications and is much larger, because an
 * application carries a notification policy, a furthest-status watermark, and
 * optimistic concurrency across five portals. These are simpler in the same
 * shape: load the record, ask the machine, save, audit, tell whoever was
 * waiting.
 *
 * One module rather than four, because the differences between them are two
 * lines each — which repository to read and which `UnitOfWork` method to call —
 * and four files would mean four places to fix the next time the audit shape
 * changes.
 */

import type {
  ActorContext,
  MentorshipOffer,
  MentorshipOfferStatus,
  Organization,
  OrganizationStatus,
  Posting,
  PostingStatus,
  Student,
  StudentStatus,
} from "@/domain/types";
import {
  organizationMachine,
  postingMachine,
  studentMachine,
} from "@/domain/lifecycle";
import { mentorshipMachine } from "@/domain/mentorship";
import { isTerminal } from "@/domain/workflow";
import { repositories } from "@/data/memory";
import { memoryStore } from "@/data/memory-store";
import type { NotificationIntent, Store, UnitOfWork } from "@/data/store";

export type LifecycleResult<T> =
  | { ok: true; value: T; viaOverride: boolean }
  | { ok: false; error: string; code: "forbidden" | "not_found" };

export interface LifecycleDeps {
  store: Store;
  now: () => Date;
}

const defaultDeps: LifecycleDeps = {
  store: memoryStore,
  now: () => new Date(),
};

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

/**
 * Move a student's enrolment standing — the college's verification decision.
 *
 * `verifiedOn` is stamped here rather than accepted from the caller, and
 * cleared when a student leaves the verified state. A stale verification date
 * on a rejected record is the kind of thing an auditor finds.
 */
export async function transitionStudent(
  actor: ActorContext,
  studentId: string,
  to: StudentStatus,
  reason?: string,
  deps: LifecycleDeps = defaultDeps,
): Promise<LifecycleResult<Student>> {
  const student = await repositories.students.find(actor, studentId);
  if (!student) {
    return { ok: false, error: "Student not found.", code: "not_found" };
  }

  const verdict = studentMachine.attempt(actor, { student }, to, reason);
  if (!verdict.ok) {
    return { ok: false, error: verdict.error ?? "Refused", code: "forbidden" };
  }

  const at = deps.now().toISOString();
  const updated: Student = {
    ...student,
    status: to,
    verifiedOn: to === "verified" ? at : null,
  };

  await deps.store.transaction((uow) => {
    uow.saveStudent(updated);
    audit(uow, actor, {
      marketId: student.marketId,
      at,
      entityType: "student",
      entityId: student.id,
      from: student.status,
      to,
      reason,
      viaOverride: Boolean(verdict.viaOverride),
    });

    // Only the outcomes a student is waiting on. "Under review" is the
    // college's bookkeeping and a message about it is noise.
    if (to === "verified" || to === "verification_rejected") {
      uow.enqueueNotification({
        marketId: student.marketId,
        recipientUserId: student.userId,
        kind: to === "verified" ? "student.verified" : "student.rejected",
        payload: {
          collegeName: organizationName(actor, student.collegeId),
          reason: reason ?? "",
        },
      });
    }
  });

  return { ok: true, value: updated, viaOverride: Boolean(verdict.viaOverride) };
}

// ---------------------------------------------------------------------------
// Postings
// ---------------------------------------------------------------------------

/**
 * Move a posting through review and publication.
 *
 * The open-application count is read here rather than trusted from the caller:
 * the close guard depends on it, and a page that renders a button with a stale
 * count must not be able to talk the service into a close that strands people.
 */
export async function transitionPosting(
  actor: ActorContext,
  postingId: string,
  to: PostingStatus,
  reason?: string,
  deps: LifecycleDeps = defaultDeps,
): Promise<LifecycleResult<Posting>> {
  const posting = await repositories.postings.find(actor, postingId);
  if (!posting) {
    return { ok: false, error: "Posting not found.", code: "not_found" };
  }

  const verdict = postingMachine.attempt(
    actor,
    {
      posting,
      openApplications: await openApplicationsFor(actor, posting.id),
    },
    to,
    reason,
  );
  if (!verdict.ok) {
    return { ok: false, error: verdict.error ?? "Refused", code: "forbidden" };
  }

  const at = deps.now().toISOString();
  const updated: Posting = { ...posting, status: to };

  await deps.store.transaction((uow) => {
    uow.savePosting(updated);
    audit(uow, actor, {
      marketId: posting.marketId,
      at,
      entityType: "posting",
      entityId: posting.id,
      from: posting.status,
      to,
      reason,
      viaOverride: Boolean(verdict.viaOverride),
    });

    for (const intent of postingNotifications(posting, to, reason)) {
      uow.enqueueNotification(intent);
    }
  });

  return { ok: true, value: updated, viaOverride: Boolean(verdict.viaOverride) };
}

/**
 * Messages a publication decision causes.
 *
 * The employer is the audience for all of them — they wrote the posting and
 * they are the one who has to act on a change request. Students are not told
 * that a posting was published: a broadcast to everyone in the market on every
 * publication is how a product teaches people to filter its mail.
 */
function postingNotifications(
  posting: Posting,
  to: PostingStatus,
  reason?: string,
): NotificationIntent[] {
  const base = {
    marketId: posting.marketId,
    recipientUserId: `contact:${posting.businessId}`,
    recipientOrganizationId: posting.businessId,
  };

  switch (to) {
    case "published":
      return [
        { ...base, kind: "posting.published", payload: { postingTitle: posting.title } },
      ];
    case "changes_requested":
      return [
        {
          ...base,
          kind: "posting.changes_requested",
          payload: { postingTitle: posting.title, reason: reason ?? "" },
        },
      ];
    case "college_drafting":
      return [
        {
          ...base,
          kind: "posting.drafting",
          payload: { postingTitle: posting.title },
        },
      ];
    default:
      return [];
  }
}

/** Live applications against a posting — what the close guard reads. */
async function openApplicationsFor(
  actor: ActorContext,
  postingId: string,
): Promise<number> {
  return (await repositories.applications.forPosting(actor, postingId)).filter(
    (a) => !isTerminal(a.status),
  ).length;
}

// ---------------------------------------------------------------------------
// Mentorship offers
// ---------------------------------------------------------------------------

/**
 * Pause, reopen, or withdraw a standing offer of mentorship.
 *
 * The shortest of these, and silent: nobody is waiting on the answer. A
 * mentorship offer has no counterparty until an introduction is made, so
 * pausing one is an employer editing their own listing rather than a decision
 * somebody needs to hear about. The offer leaving the market's mentor list is
 * the entire effect.
 */
export async function transitionMentorshipOffer(
  actor: ActorContext,
  offerId: string,
  to: MentorshipOfferStatus,
  reason?: string,
  deps: LifecycleDeps = defaultDeps,
): Promise<LifecycleResult<MentorshipOffer>> {
  const offer = await repositories.mentorshipOffers.find(actor, offerId);
  if (!offer) {
    return { ok: false, error: "Mentorship offer not found.", code: "not_found" };
  }

  const verdict = mentorshipMachine.attempt(actor, { offer }, to, reason);
  if (!verdict.ok) {
    return { ok: false, error: verdict.error ?? "Refused", code: "forbidden" };
  }

  const at = deps.now().toISOString();
  const updated: MentorshipOffer = { ...offer, status: to };

  await deps.store.transaction((uow) => {
    uow.saveMentorshipOffer(updated);
    audit(uow, actor, {
      marketId: offer.marketId,
      at,
      entityType: "mentorship_offer",
      entityId: offer.id,
      from: offer.status,
      to,
      reason,
      viaOverride: Boolean(verdict.viaOverride),
    });
  });

  return { ok: true, value: updated, viaOverride: Boolean(verdict.viaOverride) };
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

/**
 * Move an organization through vetting.
 *
 * Administrator-only, and cross-market by nature — which is why this reads
 * through the actor like everything else rather than reaching into the
 * fixtures: an administrator's reach is legitimate, and it is still audited.
 */
export async function transitionOrganization(
  actor: ActorContext,
  organizationId: string,
  to: OrganizationStatus,
  reason?: string,
  deps: LifecycleDeps = defaultDeps,
): Promise<LifecycleResult<Organization>> {
  const organization = await repositories.organizations.find(actor, organizationId);
  if (!organization) {
    return { ok: false, error: "Organization not found.", code: "not_found" };
  }

  const verdict = organizationMachine.attempt(actor, { organization }, to, reason);
  if (!verdict.ok) {
    return { ok: false, error: verdict.error ?? "Refused", code: "forbidden" };
  }

  const at = deps.now().toISOString();
  const updated: Organization = { ...organization, status: to };

  await deps.store.transaction((uow) => {
    uow.saveOrganization(updated);
    audit(uow, actor, {
      marketId: organization.marketId,
      at,
      entityType: "organization",
      entityId: organization.id,
      from: organization.status,
      to,
      reason,
      viaOverride: Boolean(verdict.viaOverride),
    });

    const kind = ORGANIZATION_NOTICES[to];
    if (kind) {
      uow.enqueueNotification({
        marketId: organization.marketId,
        recipientUserId: `contact:${organization.id}`,
        recipientOrganizationId: organization.id,
        kind,
        payload: { organizationName: organization.name, reason: reason ?? "" },
      });
    }
  });

  return { ok: true, value: updated, viaOverride: Boolean(verdict.viaOverride) };
}

/**
 * Vetting outcomes an organization hears about.
 *
 * `under_review` is deliberately silent — it is the administrator opening the
 * file, not a decision. Suspension is not: an organization that discovers it
 * has been suspended by finding its buttons gone has been told badly.
 */
const ORGANIZATION_NOTICES: Partial<Record<OrganizationStatus, string>> = {
  info_requested: "organization.info_requested",
  approved: "organization.approved",
  rejected: "organization.rejected",
  suspended: "organization.suspended",
};

// ---------------------------------------------------------------------------

function audit(
  uow: UnitOfWork,
  actor: ActorContext,
  event: {
    marketId: string;
    at: string;
    entityType: "student" | "posting" | "organization" | "mentorship_offer";
    entityId: string;
    from: string;
    to: string;
    reason?: string;
    viaOverride: boolean;
  },
): void {
  uow.appendAuditEvent({
    marketId: event.marketId,
    at: event.at,
    actorUserId: actor.user.id,
    actorRole: actor.membership.role,
    entityType: event.entityType,
    entityId: event.entityId,
    from: event.from,
    to: event.to,
    reason: event.reason,
    viaOverride: event.viaOverride,
  });
}

async function organizationName(actor: ActorContext, id: string): Promise<string> {
  return (await repositories.organizations.find(actor, id))?.name ?? "your college";
}
