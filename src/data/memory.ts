/**
 * In-memory implementation of the repository contracts.
 *
 * The only implementation in this build. A Postgres version would implement
 * the same interfaces and nothing above this layer would change.
 */

import type { ActorContext, Application, Organization, Posting } from "@/domain/types";
import { disclosureFor, redactStudent } from "@/domain/disclosure";
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
