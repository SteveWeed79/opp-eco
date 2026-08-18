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
  MentorshipOffer,
  Organization,
  Posting,
  Student,
  TimeEntry,
  User,
} from "@/domain/types";

export interface MarketRepository {
  list(actor: ActorContext): Promise<Market[]>;
  find(actor: ActorContext, id: string): Promise<Market | null>;
}

export interface OrganizationRepository {
  list(actor: ActorContext, filter?: { kind?: Organization["kind"] }): Promise<Organization[]>;
  find(actor: ActorContext, id: string): Promise<Organization | null>;
  pendingVetting(actor: ActorContext): Promise<Organization[]>;
}

export interface StudentRepository {
  list(actor: ActorContext): Promise<Student[]>;
  find(actor: ActorContext, id: string): Promise<Student | null>;
  pendingVerification(actor: ActorContext): Promise<Student[]>;
  /**
   * The student record behind a signed-in user, scoped like everything else.
   *
   * Actions that act *as* a student need this — "who am I" is a repository
   * question, not something a call site should answer by reaching into the
   * fixtures and filtering by `userId`.
   */
  forUser(actor: ActorContext, userId: string): Promise<Student | null>;
  /**
   * The student behind an application, redacted to what the actor's
   * relationship at this stage permits. Businesses must use this rather than
   * `find`, so withheld fields never reach the page at all.
   */
  forApplication(actor: ActorContext, application: Application): Promise<Student | null>;
}

export interface PostingRepository {
  list(actor: ActorContext, filter?: { status?: Posting["status"] }): Promise<Posting[]>;
  find(actor: ActorContext, id: string): Promise<Posting | null>;
  published(actor: ActorContext): Promise<Posting[]>;
  awaitingCollegeHelp(actor: ActorContext): Promise<Posting[]>;
}

/**
 * Mentorship offers, narrowed the same way postings are.
 *
 * `list` is an employer managing their own; `openInMarket` is the market's
 * mentor list, which every role may read — a college makes the introductions
 * and a student is the audience, so a list only its author can see would be an
 * offer made to nobody.
 */
export interface MentorshipOfferRepository {
  list(actor: ActorContext): Promise<MentorshipOffer[]>;
  find(actor: ActorContext, id: string): Promise<MentorshipOffer | null>;
  openInMarket(actor: ActorContext): Promise<MentorshipOffer[]>;
}

export interface ApplicationRepository {
  list(actor: ActorContext): Promise<Application[]>;
  find(actor: ActorContext, id: string): Promise<Application | null>;
  forStudent(actor: ActorContext, studentId: string): Promise<Application[]>;
  forPosting(actor: ActorContext, postingId: string): Promise<Application[]>;
}

export interface InterviewSlotRepository {
  list(actor: ActorContext): Promise<InterviewSlot[]>;
  open(actor: ActorContext): Promise<InterviewSlot[]>;
}

/**
 * Hours, scoped by relationship and reduced by purpose.
 *
 * Three narrowings, not one. Market isolation applies as everywhere else; a
 * student sees only their own weeks and an employer only the placements they
 * supervise; and the board — which sees every row in its market, because it
 * reimburses them — sees them **without the work summaries**, because
 * validating an hour cap does not require knowing what was built. See
 * `redactTimeEntry`.
 */
export interface TimeEntryRepository {
  find(actor: ActorContext, id: string): Promise<TimeEntry | null>;
  forApplication(actor: ActorContext, applicationId: string): Promise<TimeEntry[]>;
  forStudent(actor: ActorContext, studentId: string): Promise<TimeEntry[]>;
  /** The employer's queue: weeks submitted and not yet signed off. */
  awaitingReview(actor: ActorContext): Promise<TimeEntry[]>;
}

export interface CreditAwardRepository {
  list(actor: ActorContext): Promise<CreditAward[]>;
  forStudent(actor: ActorContext, studentId: string): Promise<CreditAward[]>;
}

export interface AuditEventRepository {
  list(actor: ActorContext, filter?: { entityId?: string }): Promise<AuditEvent[]>;
}

export interface UserRepository {
  find(id: string): Promise<User | null>;
}

export interface Repositories {
  markets: MarketRepository;
  organizations: OrganizationRepository;
  students: StudentRepository;
  postings: PostingRepository;
  mentorshipOffers: MentorshipOfferRepository;
  applications: ApplicationRepository;
  interviewSlots: InterviewSlotRepository;
  timeEntries: TimeEntryRepository;
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
