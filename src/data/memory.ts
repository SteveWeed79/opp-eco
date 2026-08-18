/**
 * In-memory implementation of the repository contracts.
 *
 * The only implementation in this build. A Postgres version would implement
 * the same interfaces and nothing above this layer would change.
 */

import type {
  ActorContext,
  Application,
  MentorshipOffer,
  Organization,
  Posting,
  TimeEntry,
} from "@/domain/types";
import { disclosureFor, redactStudent, redactTimeEntry } from "@/domain/disclosure";
import { isOfferedToStudents } from "@/domain/mentorship";
import { byWeekDescending } from "@/domain/timesheet";
import { inScope, ownedByActor, type Repositories } from "./repositories";
import * as seed from "./seed";

/** Postings an organization owns, for narrowing application access. */
function postingIdsOwnedBy(organizationId: string | null): Set<string> {
  return new Set(
    seed.postings.filter((p) => p.businessId === organizationId).map((p) => p.id),
  );
}

/**
 * The single definition of which applications an actor may see, shared by
 * every accessor so none of them can drift wider than the others.
 */
function visibleApplications(actor: ActorContext): Application[] {
  const rows = inScope(actor, seed.applications);
  if (actor.membership.role !== "business") return rows;
  const own = postingIdsOwnedBy(actor.membership.organizationId);
  return rows.filter((a) => own.has(a.postingId));
}

/**
 * Every time entry the actor may see, already reduced to what their role needs.
 *
 * One definition shared by all four accessors, for the same reason
 * `visibleApplications` exists: applying the narrowing in `awaitingReview` but
 * not in `find` is how an employer reads a competitor's timesheet by guessing
 * an id.
 */
function visibleTimeEntries(actor: ActorContext): TimeEntry[] {
  const rows = inScope(actor, seed.timeEntries);
  const { role, organizationId } = actor.membership;

  if (role === "business") {
    return rows.filter((entry) => entry.businessId === organizationId);
  }

  if (role === "student") {
    // Scoped to the signed-in user's own student record rather than to the
    // market. A student has no business reading a classmate's weeks.
    const self = seed.students.find((s) => s.userId === actor.user.id);
    return self ? rows.filter((entry) => entry.studentId === self.id) : [];
  }

  if (role === "board") {
    // The board reimburses every placement in its market, so it sees every
    // row — but it is validating hours against a cap, not reading a diary.
    return rows.map(redactTimeEntry);
  }

  // College and admin. The college awards credit for the work described, so
  // the summary is exactly what it needs.
  return rows;
}

export const repositories: Repositories = {
  markets: {
    list: (actor) => inScope(actor, seed.markets.map((m) => ({ ...m, marketId: m.id }))),
    find: (actor, id) => {
      const market = seed.markets.find((m) => m.id === id);
      if (!market) return null;
      if (actor.membership.role !== "admin" && actor.membership.marketId !== id) {
        return null;
      }
      return market;
    },
  },

  organizations: {
    list: (actor, filter) => {
      let rows = inScope(actor, seed.organizations);
      if (filter?.kind) rows = rows.filter((o) => o.kind === filter.kind);
      return rows;
    },
    find: (actor, id) => inScope(actor, seed.organizations).find((o) => o.id === id) ?? null,
    pendingVetting: (actor) =>
      inScope(actor, seed.organizations).filter((o) =>
        ["applied", "under_review", "info_requested"].includes(o.status),
      ),
  },

  students: {
    list: (actor) => inScope(actor, seed.students),
    find: (actor, id) => inScope(actor, seed.students).find((s) => s.id === id) ?? null,
    pendingVerification: (actor) =>
      inScope(actor, seed.students).filter(
        (s) => s.status === "pending_verification" || s.status === "profile_complete",
      ),
    forUser: (actor, userId) =>
      inScope(actor, seed.students).find((s) => s.userId === userId) ?? null,
    forApplication: (actor, application) => {
      const student =
        inScope(actor, seed.students).find((s) => s.id === application.studentId) ?? null;
      if (!student) return null;
      // Only a business is held at arm's length. The college owns the student
      // relationship and the board needs identity to determine eligibility.
      if (actor.membership.role !== "business") return student;
      return redactStudent(student, disclosureFor(application));
    },
  },

  postings: {
    list: (actor, filter) => {
      let rows = ownedByActor<Posting>(actor, seed.postings, (p) => p.businessId);
      if (filter?.status) rows = rows.filter((p) => p.status === filter.status);
      return rows;
    },
    find: (actor, id) =>
      ownedByActor<Posting>(actor, seed.postings, (p) => p.businessId).find(
        (p) => p.id === id,
      ) ?? null,
    published: (actor) =>
      // Published postings are the market's shopfront — every role in the
      // market may browse them, including businesses looking at competitors'.
      inScope(actor, seed.postings).filter((p) => p.status === "published"),
    awaitingCollegeHelp: (actor) =>
      inScope(actor, seed.postings).filter(
        (p) => p.status === "help_requested" || p.status === "college_drafting",
      ),
  },

  mentorshipOffers: {
    list: (actor) =>
      ownedByActor<MentorshipOffer>(actor, seed.mentorshipOffers, (o) => o.businessId),
    find: (actor, id) =>
      ownedByActor<MentorshipOffer>(
        actor,
        seed.mentorshipOffers,
        (o) => o.businessId,
      ).find((o) => o.id === id) ?? null,
    openInMarket: (actor) =>
      // Like `postings.published`, this is the market's shopfront rather than
      // an employer's own records, so it is scoped by market and not by owner.
      // A paused or withdrawn offer is absent here by definition: an employer
      // who paused and still appeared on the student's mentor list would be
      // fielding introductions they said they could not take.
      inScope(actor, seed.mentorshipOffers).filter(isOfferedToStudents),
  },

  /**
   * Every accessor here narrows the same way. Applying ownership only in
   * `list` while `find`, `forStudent`, and `forPosting` stopped at market
   * scope meant a business could read a competitor's pipeline by passing an
   * id it did not own.
   */
  applications: {
    list: (actor) => visibleApplications(actor),
    find: (actor, id) => visibleApplications(actor).find((a) => a.id === id) ?? null,
    forStudent: (actor, studentId) =>
      visibleApplications(actor).filter((a) => a.studentId === studentId),
    forPosting: (actor, postingId) =>
      visibleApplications(actor).filter((a) => a.postingId === postingId),
  },

  interviewSlots: {
    list: (actor) => inScope(actor, seed.interviewSlotsAt()),
    open: (actor) =>
      inScope(actor, seed.interviewSlotsAt()).filter((s) => s.bookedByStudentId === null),
  },

  timeEntries: {
    find: (actor, id) => visibleTimeEntries(actor).find((e) => e.id === id) ?? null,
    forApplication: (actor, applicationId) =>
      visibleTimeEntries(actor)
        .filter((e) => e.applicationId === applicationId)
        .sort(byWeekDescending),
    forStudent: (actor, studentId) =>
      visibleTimeEntries(actor)
        .filter((e) => e.studentId === studentId)
        .sort(byWeekDescending),
    awaitingReview: (actor) =>
      visibleTimeEntries(actor)
        .filter((e) => e.status === "submitted")
        // Oldest first: this is a queue someone works through, and the week a
        // student has been waiting longest on is the one to clear.
        .sort((a, b) => a.weekStarting.localeCompare(b.weekStarting)),
  },

  creditAwards: {
    list: (actor) => inScope(actor, seed.creditAwards),
    forStudent: (actor, studentId) =>
      inScope(actor, seed.creditAwards).filter((c) => c.studentId === studentId),
  },

  auditEvents: {
    list: (actor, filter) => {
      let rows = inScope(actor, seed.auditEvents);
      if (filter?.entityId) rows = rows.filter((e) => e.entityId === filter.entityId);
      return rows.slice().sort((a, b) => b.at.localeCompare(a.at));
    },
  },

  users: {
    find: (id) => seed.users.find((u) => u.id === id) ?? null,
  },
};

// ---------------------------------------------------------------------------
// Convenience lookups used across portals
// ---------------------------------------------------------------------------

export function organizationName(id: string | null | undefined): string {
  if (!id) return "—";
  return seed.organizations.find((o) => o.id === id)?.name ?? "—";
}

export function organizationsOfKind(
  marketId: string,
  kind: Organization["kind"],
): Organization[] {
  return seed.organizations.filter((o) => o.marketId === marketId && o.kind === kind);
}

export function marketName(id: string): string {
  return seed.markets.find((m) => m.id === id)?.name ?? "—";
}
