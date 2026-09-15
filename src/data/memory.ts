/**
 * In-memory implementation of the repository contracts.
 *
 * The default, and what runs with no configuration at all: the demo, the unit
 * suite, and the end-to-end suite. `postgres/repositories.ts` implements the
 * same contracts against SQL, and the two are asserted to return the same
 * records for every accessor and every role.
 */

import type {
  ActorContext,
  Application,
  MentorshipOffer,
  MentorshipPairing,
  Organization,
  Posting,
  Student,
  TimeEntry,
} from "@/domain/types";
import { disclosureFor, redactStudent, redactTimeEntry } from "@/domain/disclosure";
import { isOfferedToStudents } from "@/domain/mentorship";
import { byWeekAscending, byWeekDescending } from "@/domain/timesheet";
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
  const { role, organizationId } = actor.membership;

  if (role === "business") {
    const own = postingIdsOwnedBy(organizationId);
    return rows.filter((a) => own.has(a.postingId));
  }

  if (role === "student") {
    // Their own candidacies and nobody else's — the same narrowing
    // `visibleTimeEntries` applies, and the same one the SQL layer's
    // `applicationScope` has always applied. Market scope alone let a signed-in
    // student read every classmate's application, including the match score and
    // the funding decision on it, by listing or by guessing an id.
    const self = seed.students.find((s) => s.userId === actor.user.id);
    return self ? rows.filter((a) => a.studentId === self.id) : [];
  }

  return rows;
}

/**
 * Every student record the actor may see.
 *
 * Market scope for the college, the board and an employer; a student sees one
 * record, their own. Market scope alone let a signed-in student list every
 * classmate in the market — their skills, their eligibility determination, and
 * whether the college had verified them — which is the same narrowing the SQL
 * layer's `studentScope` has always applied.
 */
function visibleStudents(actor: ActorContext): Student[] {
  const rows = inScope(actor, seed.students);
  if (actor.membership.role !== "student") return rows;
  return rows.filter((s) => s.userId === actor.user.id);
}

/**
 * Every introduction the actor may see.
 *
 * One definition for all four accessors, as everywhere else. The board is
 * absent by design rather than by omission — see `MentorshipPairingRepository`.
 */
function visibleMentorshipPairings(actor: ActorContext): MentorshipPairing[] {
  const rows = inScope(actor, seed.mentorshipPairings);
  const { role, organizationId } = actor.membership;

  if (role === "business") {
    return rows.filter((p) => p.businessId === organizationId);
  }
  if (role === "student") {
    const self = seed.students.find((s) => s.userId === actor.user.id);
    return self ? rows.filter((p) => p.studentId === self.id) : [];
  }
  if (role === "board") return [];
  return rows;
}

/** Students waiting on the college before students who have not asked yet. */
function byVerificationQueue(a: Student, b: Student): number {
  const asked = (s: Student) => (s.status === "pending_verification" ? 0 : 1);
  return asked(a) - asked(b) || a.name.localeCompare(b.name);
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
    // Filtered by id rather than through `inScope`, which reads a `marketId`
    // a market does not have: decorating one on the way out put a field on
    // `list`'s markets that `find`'s markets did not carry, so the same record
    // had two shapes depending on which accessor answered.
    list: async (actor) =>
      actor.membership.role === "admin"
        ? seed.markets
        : seed.markets.filter((m) => m.id === actor.membership.marketId),
    find: async (actor, id) => {
      const market = seed.markets.find((m) => m.id === id);
      if (!market) return null;
      if (actor.membership.role !== "admin" && actor.membership.marketId !== id) {
        return null;
      }
      return market;
    },
  },

  organizations: {
    list: async (actor, filter) => {
      let rows = inScope(actor, seed.organizations);
      if (filter?.kind) rows = rows.filter((o) => o.kind === filter.kind);
      return rows;
    },
    find: async (actor, id) => inScope(actor, seed.organizations).find((o) => o.id === id) ?? null,
    pendingVetting: async (actor) =>
      inScope(actor, seed.organizations).filter((o) =>
        ["applied", "under_review", "info_requested"].includes(o.status),
      ),
  },

  students: {
    list: async (actor) => visibleStudents(actor),
    find: async (actor, id) => visibleStudents(actor).find((s) => s.id === id) ?? null,
    pendingVerification: async (actor) =>
      visibleStudents(actor)
        .filter(
          (s) => s.status === "pending_verification" || s.status === "profile_complete",
        )
        // Asked first, then by name. Ordering this explicitly rather than
        // leaving it to fixture order is what keeps the queue the same on both
        // data layers — and what stops a student who has not submitted from
        // heading a list whose first action is one the college cannot take.
        .sort(byVerificationQueue),
    forUser: async (actor, userId) =>
      visibleStudents(actor).find((s) => s.userId === userId) ?? null,
    forApplication: async (actor, application) => {
      const student =
        visibleStudents(actor).find((s) => s.id === application.studentId) ?? null;
      if (!student) return null;
      // Only a business is held at arm's length. The college owns the student
      // relationship and the board needs identity to determine eligibility.
      if (actor.membership.role !== "business") return student;
      return redactStudent(student, disclosureFor(application));
    },
  },

  postings: {
    list: async (actor, filter) => {
      let rows = ownedByActor<Posting>(actor, seed.postings, (p) => p.businessId);
      if (filter?.status) rows = rows.filter((p) => p.status === filter.status);
      return rows;
    },
    find: async (actor, id) =>
      ownedByActor<Posting>(actor, seed.postings, (p) => p.businessId).find(
        (p) => p.id === id,
      ) ?? null,
    published: async (actor) =>
      // Published postings are the market's shopfront — every role in the
      // market may browse them, including businesses looking at competitors'.
      inScope(actor, seed.postings).filter((p) => p.status === "published"),
    awaitingCollegeHelp: async (actor) =>
      inScope(actor, seed.postings).filter(
        (p) => p.status === "help_requested" || p.status === "college_drafting",
      ),
  },

  mentorshipOffers: {
    list: async (actor) =>
      ownedByActor<MentorshipOffer>(actor, seed.mentorshipOffers, (o) => o.businessId),
    find: async (actor, id) =>
      ownedByActor<MentorshipOffer>(
        actor,
        seed.mentorshipOffers,
        (o) => o.businessId,
      ).find((o) => o.id === id) ?? null,
    openInMarket: async (actor) =>
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
  mentorshipPairings: {
    list: async (actor) => visibleMentorshipPairings(actor),
    find: async (actor, id) =>
      visibleMentorshipPairings(actor).find((p) => p.id === id) ?? null,
    forOffer: async (actor, offerId) =>
      visibleMentorshipPairings(actor).filter((p) => p.offerId === offerId),
    forStudent: async (actor, studentId) =>
      visibleMentorshipPairings(actor).filter((p) => p.studentId === studentId),
  },

  applications: {
    list: async (actor) => visibleApplications(actor),
    find: async (actor, id) => visibleApplications(actor).find((a) => a.id === id) ?? null,
    forStudent: async (actor, studentId) =>
      visibleApplications(actor).filter((a) => a.studentId === studentId),
    forPosting: async (actor, postingId) =>
      visibleApplications(actor).filter((a) => a.postingId === postingId),
  },

  interviewSlots: {
    list: async (actor) => inScope(actor, seed.interviewSlotsAt()),
    open: async (actor) =>
      inScope(actor, seed.interviewSlotsAt()).filter((s) => s.bookedByStudentId === null),
  },

  timeEntries: {
    find: async (actor, id) => visibleTimeEntries(actor).find((e) => e.id === id) ?? null,
    forApplication: async (actor, applicationId) =>
      visibleTimeEntries(actor)
        .filter((e) => e.applicationId === applicationId)
        .sort(byWeekDescending),
    forStudent: async (actor, studentId) =>
      visibleTimeEntries(actor)
        .filter((e) => e.studentId === studentId)
        .sort(byWeekDescending),
    awaitingReview: async (actor) =>
      visibleTimeEntries(actor)
        .filter((e) => e.status === "submitted")
        // Oldest first: this is a queue someone works through, and the week a
        // student has been waiting longest on is the one to clear.
        .sort(byWeekAscending),
  },

  creditAwards: {
    list: async (actor) => inScope(actor, seed.creditAwards),
    forStudent: async (actor, studentId) =>
      inScope(actor, seed.creditAwards).filter((c) => c.studentId === studentId),
  },

  auditEvents: {
    list: async (actor, filter) => {
      let rows = inScope(actor, seed.auditEvents);
      if (filter?.entityId) rows = rows.filter((e) => e.entityId === filter.entityId);
      return rows.slice().sort((a, b) => b.at.localeCompare(a.at));
    },
  },

  users: {
    find: async (id) => seed.users.find((u) => u.id === id) ?? null,
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
