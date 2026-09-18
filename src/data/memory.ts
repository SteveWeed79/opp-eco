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
  ConsentRecord,
  Deliverable,
  Escalation,
  FundingCommitment,
  MentorshipOffer,
  HostOffer,
  MentorshipPairing,
  Organization,
  Outcome,
  Posting,
  Student,
  TimeEntry,
} from "@/domain/types";
import {
  disclosureFor,
  redactHostOffer,
  redactOutcome,
  redactStudent,
  redactTimeEntry,
} from "@/domain/disclosure";
import { isOfferedToStudents } from "@/domain/mentorship";
import { byWeekAscending, byWeekDescending } from "@/domain/timesheet";
import { byObservedDescending } from "@/domain/outcome";
import { byOfferOrder } from "@/domain/offer";
import { byEffectiveDescending } from "@/domain/region";
import { byCommitmentOrder, byFundOrder } from "@/domain/funding";
import { byConsentOrder, disclosureBlockReason } from "@/domain/consent";
import { byEscalationOrder, isLive } from "@/domain/escalation";
import { awaitsEmployer, byDeliverableOrder } from "@/domain/deliverable";
import { viewsDemoData } from "@/domain/identity";
import { inScope, ownedByActor, type Repositories } from "./repositories";
import { administratorUserIds } from "./session";
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

/**
 * Consents the actor has standing to read.
 *
 * A learner sees their own — a record asserting that they agreed to something
 * is the one they are most entitled to check. The institution that recorded it
 * sees it because it is the one that will have to produce the form. An employer
 * sees none: it is the beneficiary of the disclosure rather than a party to the
 * agreement, and what consent buys it is a wider view of the learner, not sight
 * of the paperwork.
 */
/**
 * Escalations this actor may read: their own, or every one in the market if
 * they are the administrator.
 *
 * **Not the parties the problem is about**, which is the whole design and not a
 * narrowing bolted on afterwards — see `EscalationRepository`. An employer
 * asking for its own placement's escalations gets an empty list, and that is
 * the correct answer rather than a missing case.
 *
 * Matched clause for clause by `escalationScope` on the SQL side.
 */
/**
 * Hand-ins this actor may read. Matched clause for clause by `deliverableScope`.
 *
 * The board sees none: micro-internships carry no public money, so there is no
 * workflow reason for it to read a learner's work.
 */
function visibleDeliverables(actor: ActorContext): Deliverable[] {
  const { role, organizationId } = actor.membership;
  if (role === "board") return [];

  const rows = inScope(actor, seed.deliverables);
  if (role === "student") {
    const self = seed.students.find((s) => s.userId === actor.user.id);
    return self ? rows.filter((d) => d.studentId === self.id) : [];
  }
  if (role === "business") {
    const owned = postingIdsOwnedBy(organizationId);
    const mine = new Set(
      seed.applications.filter((a) => owned.has(a.postingId)).map((a) => a.id),
    );
    return rows.filter((d) => mine.has(d.applicationId));
  }
  return rows;
}

function visibleEscalations(actor: ActorContext): Escalation[] {
  const rows = inScope(actor, seed.escalations);
  if (actor.membership.role === "admin") return rows;
  return rows.filter((e) => e.raisedByUserId === actor.user.id);
}

function visibleConsents(actor: ActorContext): ConsentRecord[] {
  const { role, organizationId } = actor.membership;
  if (role === "business") return [];

  const rows = inScope(actor, seed.consents);
  if (role === "student") {
    const self = seed.students.find((s) => s.userId === actor.user.id);
    return self ? rows.filter((c) => c.studentId === self.id) : [];
  }
  if (role === "college") {
    return rows.filter((c) => c.sourceOrgId === organizationId);
  }
  return rows;
}

/**
 * Draws against a fund, narrowed by whose money and whose learner it is.
 *
 * An employer sees the commitments against placements it hosts, because it is
 * the party being reimbursed and a payment it cannot see is one it cannot
 * reconcile. A student sees their own — a grant covering their tuition is a
 * fact about their own finances before it is a line in a board's report.
 * Everyone else sees the market's.
 *
 * The funds themselves are deliberately NOT narrowed like this: everyone in a
 * market reads every source. A student deciding whether they can afford the
 * credit and an employer deciding whether hosting is viable are asking the same
 * question, and a funding model visible only to its sponsor would reproduce the
 * gap this venture exists to close.
 */
function visibleCommitments(actor: ActorContext): FundingCommitment[] {
  const rows = inScope(actor, seed.fundingCommitments);
  const { role, organizationId } = actor.membership;

  if (role === "business") {
    const own = postingIdsOwnedBy(organizationId);
    const hosted = new Set(
      seed.applications.filter((a) => own.has(a.postingId)).map((a) => a.id),
    );
    return rows.filter((c) => c.applicationId && hosted.has(c.applicationId));
  }
  if (role === "student") {
    const self = seed.students.find((s) => s.userId === actor.user.id);
    return self ? rows.filter((c) => c.studentId === self.id) : [];
  }
  return rows;
}

/**
 * Every follow-up observation the actor may see, already reduced to what their
 * role needs.
 *
 * Three narrowings. The employer sees **none**: no surface it has reads one, and
 * where a different employer's intern ended up is not its business. A student
 * sees their own, because a record held about someone they cannot see is the
 * kind of thing a privacy regime asks about. The board sees its market's with
 * the free text stripped — its obligation is a count of who was employed and
 * who stayed, not the sentence naming a learner's new employer.
 */
function visibleOutcomes(actor: ActorContext): Outcome[] {
  const { role } = actor.membership;
  if (role === "business") return [];

  const rows = inScope(actor, seed.outcomes);
  if (role === "student") {
    const self = seed.students.find((s) => s.userId === actor.user.id);
    return self ? rows.filter((o) => o.studentId === self.id) : [];
  }
  if (role === "board") return rows.map(redactOutcome);
  return rows;
}

/**
 * Every host answer the actor may see, already reduced to what their role needs.
 *
 * The mirror image of `visibleOutcomes` in the one place that matters: here the
 * **employer sees its own**, because it is the author. `businessId` is carried
 * on the row precisely so this narrowing needs no join through postings — the
 * same reason `MentorshipPairing` denormalises it.
 *
 * The learner and the board see the answer with the note stripped. Neither is
 * being kept from what happened; both are kept from the employer's candid
 * sentence about why it did not keep a named person.
 */
function visibleHostOffers(actor: ActorContext): HostOffer[] {
  const rows = inScope(actor, seed.hostOffers);
  const { role, organizationId } = actor.membership;

  if (role === "business") return rows.filter((o) => o.businessId === organizationId);
  if (role === "student") {
    const self = seed.students.find((st) => st.userId === actor.user.id);
    return self ? rows.filter((o) => o.studentId === self.id).map(redactHostOffer) : [];
  }
  // The note reaches the administrator and its author, and nobody else — not
  // even the college, which works the same cases. Narrow by default because
  // widening later costs nothing and un-disclosing is impossible, and because
  // an employer writing candidly about why it did not keep somebody is doing it
  // on the understanding that it is not being circulated.
  if (role !== "admin") return rows.map(redactHostOffer);
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
        ? actor.systemWide
          ? seed.markets
          : // The market's own flag answers directly — the mirror of
          // `ownMarketScope`, which reads the column rather than a subquery
          // against the table it is already selecting from.
          seed.markets.filter((m) => m.isDemoData === viewsDemoData(actor))
        : seed.markets.filter((m) => m.id === actor.membership.marketId),
    find: async (actor, id) => {
      const market = seed.markets.find((m) => m.id === id);
      if (!market) return null;
      if (actor.membership.role === "admin") {
        if (actor.systemWide) return market;
        return market.isDemoData === viewsDemoData(actor) ? market : null;
      }
      if (actor.membership.marketId !== id) return null;
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

      // Two conditions, and both must hold. The placement has to have reached a
      // stage where the employer needs to reach the learner directly, **and**
      // the crediting institution must have education-record consent on file.
      // The stage rule alone let a college's FERPA-covered record widen to an
      // employer on the strength of a status change nobody consented to.
      const blocked = disclosureBlockReason(
        seed.consents,
        { studentId: student.id, sourceOrgId: student.collegeId },
        // Real time, not the demo's frozen anchor, because the SQL layer asks
        // `consents.expires_on > now()` and the two must reach the same answer.
        // They could differ: a consent expiring between process start and the
        // request read as valid here and expired there — with this layer the
        // permissive one, on whether an employer may have a learner's contact
        // details. Expiry is a cliff rather than a creeping figure, so the
        // demonstration's numbers do not move for using the real clock.
        new Date(),
      );
      const level = blocked ? "summary" : disclosureFor(application);
      return redactStudent(student, level);
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

  consents: {
    list: async (actor) => visibleConsents(actor).slice().sort(byConsentOrder),
    find: async (actor, id) => visibleConsents(actor).find((c) => c.id === id) ?? null,
    forStudent: async (actor, studentId) =>
      visibleConsents(actor)
        .filter((c) => c.studentId === studentId)
        .sort(byConsentOrder),
  },

  deliverables: {
    list: async (actor) => visibleDeliverables(actor).slice().sort(byDeliverableOrder),
    find: async (actor, id) => visibleDeliverables(actor).find((d) => d.id === id) ?? null,
    forApplication: async (actor, applicationId) =>
      visibleDeliverables(actor).find((d) => d.applicationId === applicationId) ?? null,
    awaitingResponse: async (actor) =>
      visibleDeliverables(actor).filter(awaitsEmployer).sort(byDeliverableOrder),
  },

  escalations: {
    list: async (actor) => visibleEscalations(actor).slice().sort(byEscalationOrder),
    find: async (actor, id) => visibleEscalations(actor).find((e) => e.id === id) ?? null,
    forApplication: async (actor, applicationId) =>
      visibleEscalations(actor)
        .filter((e) => e.applicationId === applicationId)
        .sort(byEscalationOrder),
    live: async (actor) => visibleEscalations(actor).filter(isLive).sort(byEscalationOrder),
  },

  fundingSources: {
    list: async (actor) => inScope(actor, seed.fundingSources).slice().sort(byFundOrder),
    find: async (actor, id) =>
      inScope(actor, seed.fundingSources).find((f) => f.id === id) ?? null,
    forMarket: async (actor, marketId) =>
      inScope(actor, seed.fundingSources)
        .filter((f) => f.marketId === marketId)
        .sort(byFundOrder),
  },

  fundingCommitments: {
    list: async (actor) => visibleCommitments(actor).slice().sort(byCommitmentOrder),
    find: async (actor, id) => visibleCommitments(actor).find((c) => c.id === id) ?? null,
    forSource: async (actor, sourceId) =>
      visibleCommitments(actor)
        .filter((c) => c.fundingSourceId === sourceId)
        .sort(byCommitmentOrder),
    forApplication: async (actor, applicationId) =>
      visibleCommitments(actor)
        .filter((c) => c.applicationId === applicationId)
        .sort(byCommitmentOrder),
    forStudent: async (actor, studentId) =>
      visibleCommitments(actor)
        .filter((c) => c.studentId === studentId)
        .sort(byCommitmentOrder),
  },

  outcomes: {
    list: async (actor) => visibleOutcomes(actor).slice().sort(byObservedDescending),
    forStudent: async (actor, studentId) =>
      visibleOutcomes(actor)
        .filter((o) => o.studentId === studentId)
        .sort(byObservedDescending),
    forApplication: async (actor, applicationId) =>
      visibleOutcomes(actor)
        .filter((o) => o.applicationId === applicationId)
        .sort(byObservedDescending),
  },

  hostOffers: {
    list: async (actor) => visibleHostOffers(actor).slice().sort(byOfferOrder),
    forApplication: async (actor, applicationId) =>
      visibleHostOffers(actor).find((o) => o.applicationId === applicationId) ?? null,
    forStudent: async (actor, studentId) =>
      visibleHostOffers(actor)
        .filter((o) => o.studentId === studentId)
        .sort(byOfferOrder),
  },

  regionDefinitions: {
    list: async (actor) =>
      inScope(actor, seed.regionDefinitions).slice().sort(byEffectiveDescending),
    forMarket: async (actor, marketId) =>
      inScope(actor, seed.regionDefinitions)
        .filter((d) => d.marketId === marketId)
        .sort(byEffectiveDescending),
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
    administrators: async () => {
      const ids = new Set(administratorUserIds());
      // Sorted by id to match the SQL layer, which the parity suite compares.
      return seed.users.filter((u) => ids.has(u.id)).sort((a, b) => a.id.localeCompare(b.id));
    },
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
