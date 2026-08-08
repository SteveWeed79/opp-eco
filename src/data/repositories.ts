/**
 * Repository contracts.
 *
 * There is no database in this build — the only implementation is in-memory
 * over seeded fixtures. The interfaces exist so that swapping in Postgres
 * later is a new class behind the same contract, with no screen touched.
 *
 * Every read takes an ActorContext and is scoped by it. Market isolation is
 * enforced here rather than in each route, so a college in one market cannot
 * read another market's roster no matter what a page asks for.
 */

import type {
  ActorContext,
  Application,
  AuditEvent,
  CreditAward,
  InterviewSlot,
  Market,
  Organization,
  Posting,
  Student,
  User,
} from "@/domain/types";

export interface MarketRepository {
  list(actor: ActorContext): Market[];
  find(actor: ActorContext, id: string): Market | null;
}

export interface OrganizationRepository {
  list(actor: ActorContext, filter?: { kind?: Organization["kind"] }): Organization[];
  find(actor: ActorContext, id: string): Organization | null;
  pendingVetting(actor: ActorContext): Organization[];
}

export interface StudentRepository {
  list(actor: ActorContext): Student[];
  find(actor: ActorContext, id: string): Student | null;
  pendingVerification(actor: ActorContext): Student[];
  /**
   * The student behind an application, redacted to what the actor's
   * relationship at this stage permits. Businesses must use this rather than
   * `find`, so withheld fields never reach the page at all.
   */
  forApplication(actor: ActorContext, application: Application): Student | null;
}

export interface PostingRepository {
  list(actor: ActorContext, filter?: { status?: Posting["status"] }): Posting[];
  find(actor: ActorContext, id: string): Posting | null;
  published(actor: ActorContext): Posting[];
  awaitingCollegeHelp(actor: ActorContext): Posting[];
}

export interface ApplicationRepository {
  list(actor: ActorContext): Application[];
  find(actor: ActorContext, id: string): Application | null;
  forStudent(actor: ActorContext, studentId: string): Application[];
  forPosting(actor: ActorContext, postingId: string): Application[];
}

export interface InterviewSlotRepository {
  list(actor: ActorContext): InterviewSlot[];
  open(actor: ActorContext): InterviewSlot[];
}

export interface CreditAwardRepository {
  list(actor: ActorContext): CreditAward[];
  forStudent(actor: ActorContext, studentId: string): CreditAward[];
}

export interface AuditEventRepository {
  list(actor: ActorContext, filter?: { entityId?: string }): AuditEvent[];
}

export interface UserRepository {
  find(id: string): User | null;
}

export interface Repositories {
  markets: MarketRepository;
  organizations: OrganizationRepository;
  students: StudentRepository;
  postings: PostingRepository;
  applications: ApplicationRepository;
  interviewSlots: InterviewSlotRepository;
  creditAwards: CreditAwardRepository;
  auditEvents: AuditEventRepository;
  users: UserRepository;
}

// ---------------------------------------------------------------------------
// Scoping
// ---------------------------------------------------------------------------

/**
 * The single place market isolation is decided.
 *
 * Admin is the only cross-market role, which is deliberate and audited.
 * Everyone else sees exactly one market.
 */
export function visibleMarketIds(
  actor: ActorContext,
  allMarketIds: string[],
): string[] {
  if (actor.membership.role === "admin") return allMarketIds;
  return actor.membership.marketId ? [actor.membership.marketId] : [];
}

export function inScope<T extends { marketId: string }>(
  actor: ActorContext,
  rows: T[],
): T[] {
  if (actor.membership.role === "admin") return rows;
  return rows.filter((r) => r.marketId === actor.membership.marketId);
}

/**
 * Roles whose view is narrowed further, to records their own organization
 * owns. Colleges are deliberately absent: a college operates its market and
 * needs to see every posting in it to review and help draft them. Its
 * narrowing is by market, not by ownership.
 */
const OWNERSHIP_SCOPED_ROLES = new Set(["business"]);

/**
 * Business actors see only their own organization's records within their
 * market. Everyone else is scoped by market alone.
 *
 * `organizationIdOf` must return the *row's* owner. Returning the actor's own
 * organization makes the comparison a tautology that filters nothing, which is
 * exactly the bug this signature invites — so callers pass a row accessor.
 */
export function ownedByActor<T extends { marketId: string }>(
  actor: ActorContext,
  rows: T[],
  organizationIdOf: (row: T) => string | null,
): T[] {
  const scoped = inScope(actor, rows);
  const { role, organizationId } = actor.membership;
  if (!OWNERSHIP_SCOPED_ROLES.has(role)) return scoped;
  return scoped.filter((r) => organizationIdOf(r) === organizationId);
}
