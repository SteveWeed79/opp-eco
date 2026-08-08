/**
 * In-memory implementation of the repository contracts.
 *
 * The only implementation in this build. A Postgres version would implement
 * the same interfaces and nothing above this layer would change.
 */

import type { ActorContext, Organization, Posting } from "@/domain/types";
import { inScope, ownedByActor, type Repositories } from "./repositories";
import * as seed from "./seed";

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
  },

  postings: {
    list: (actor, filter) => {
      let rows = ownedByActor<Posting>(actor, seed.postings, (p) =>
        actor.membership.role === "business" ? p.businessId : actor.membership.organizationId,
      );
      if (filter?.status) rows = rows.filter((p) => p.status === filter.status);
      return rows;
    },
    find: (actor, id) => inScope(actor, seed.postings).find((p) => p.id === id) ?? null,
    published: (actor) =>
      inScope(actor, seed.postings).filter((p) => p.status === "published"),
    awaitingCollegeHelp: (actor) =>
      inScope(actor, seed.postings).filter(
        (p) => p.status === "help_requested" || p.status === "college_drafting",
      ),
  },

  applications: {
    list: (actor) => {
      const rows = inScope(actor, seed.applications);
      const { role, organizationId } = actor.membership;
      if (role === "business") {
        const own = new Set(
          seed.postings.filter((p) => p.businessId === organizationId).map((p) => p.id),
        );
        return rows.filter((a) => own.has(a.postingId));
      }
      return rows;
    },
    find: (actor, id) => inScope(actor, seed.applications).find((a) => a.id === id) ?? null,
    forStudent: (actor, studentId) =>
      inScope(actor, seed.applications).filter((a) => a.studentId === studentId),
    forPosting: (actor, postingId) =>
      inScope(actor, seed.applications).filter((a) => a.postingId === postingId),
  },

  interviewSlots: {
    list: (actor) => inScope(actor, seed.interviewSlots),
    open: (actor) =>
      inScope(actor, seed.interviewSlots).filter((s) => s.bookedByStudentId === null),
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
