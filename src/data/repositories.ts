/**
 * Repository contracts.
 *
 * Two implementations satisfy these: the in-memory one over the seeded
 * fixtures, and the SQL one in `postgres/`. `backend.ts` picks between them
 * from a single environment variable, and no screen can tell the difference —
 * which is the point, and what `postgres/integration.test.ts` asserts
 * accessor by accessor.
 *
 * Every read takes an ActorContext and is scoped by it. Market isolation is
 * enforced here rather than in each route, so a college in one market cannot
 * read another market's roster no matter what a page asks for.
 */

import { viewsDemoData } from "@/domain/identity";
import * as seed from "./seed";
import type {
  ActorContext,
  Application,
  ConsentRecord,
  AuditEvent,
  CreditAward,
  Escalation,
  FundingCommitment,
  FundingSource,
  InterviewSlot,
  Market,
  MentorshipOffer,
  MentorshipPairing,
  Organization,
  HostOffer,
  RegionDefinition,
  Outcome,
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

/**
 * Introductions, narrowed by who has a reason to read one.
 *
 * An employer sees the students introduced to them; a student sees their own
 * introductions. The college and the administrator see the market's, because
 * they are the parties who make them. **The board sees none** — it reimburses
 * placements, and a mentorship carries no wage, no credit and no public money,
 * so who was introduced to whom is not its business. That is a narrowing rather
 * than an oversight, and the same reasoning that hides work summaries from it
 * on a timesheet.
 */
export interface MentorshipPairingRepository {
  list(actor: ActorContext): Promise<MentorshipPairing[]>;
  find(actor: ActorContext, id: string): Promise<MentorshipPairing | null>;
  forOffer(actor: ActorContext, offerId: string): Promise<MentorshipPairing[]>;
  forStudent(actor: ActorContext, studentId: string): Promise<MentorshipPairing[]>;
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

/**
 * Follow-up observations, narrowed by who has a reason to read one.
 *
 * The college and the administrator see their market's, because they are the
 * parties who record them. A learner sees their own — a record held about
 * someone that they cannot see is the kind of thing a privacy regime asks
 * about, and there is no reason here to be one. **The board sees the market's
 * with the detail stripped**: its reporting obligation is a count of who was
 * employed and who stayed, and the sentence naming a learner's new employer is
 * not part of that count. See `redactOutcome`.
 *
 * **The employer sees none.** No surface it has reads one, and where a
 * different employer's intern ended up is not its business. That changes the
 * day an employer can record the hire it made, which is the open question the
 * domain names (Q23).
 */
/**
 * Funds and the draws against them.
 *
 * Read by everyone in the market, which is unusual here and deliberate. A
 * student deciding whether they can afford the credit, an employer deciding
 * whether hosting is viable, and a college advising both are all asking the
 * same question — is there money for this — and a funding model whose answer
 * is visible only to the sponsor would reproduce the exact gap this venture
 * exists to close.
 *
 * What is narrowed is *spending*, not reading: `canSpendFrom` decides that, and
 * the write paths check it again.
 */
export interface FundingSourceRepository {
  list(actor: ActorContext): Promise<FundingSource[]>;
  find(actor: ActorContext, id: string): Promise<FundingSource | null>;
  forMarket(actor: ActorContext, marketId: string): Promise<FundingSource[]>;
}

/**
 * Commitments, narrowed by whose money and whose learner it is.
 *
 * An employer sees the draws against placements it hosts — it is the party
 * being reimbursed, so a commitment it cannot see is a payment it cannot
 * reconcile. A student sees their own, because a grant covering their tuition
 * is a fact about their own finances. Everyone else sees the market's.
 */
export interface FundingCommitmentRepository {
  list(actor: ActorContext): Promise<FundingCommitment[]>;
  find(actor: ActorContext, id: string): Promise<FundingCommitment | null>;
  forSource(actor: ActorContext, sourceId: string): Promise<FundingCommitment[]>;
  forApplication(actor: ActorContext, applicationId: string): Promise<FundingCommitment[]>;
  forStudent(actor: ActorContext, studentId: string): Promise<FundingCommitment[]>;
}

/**
 * Consents, narrowed to the parties with standing.
 *
 * A learner sees their own, which is not a courtesy: a record asserting that
 * someone agreed to something is the record they are most entitled to check.
 * The institution that recorded it sees it because it is the one that will have
 * to produce the form. **An employer sees none** — it is the beneficiary of the
 * disclosure, not a party to the agreement, and what it gets from consent is a
 * wider view of the learner rather than sight of the paperwork.
 */
export interface ConsentRepository {
  list(actor: ActorContext): Promise<ConsentRecord[]>;
  find(actor: ActorContext, id: string): Promise<ConsentRecord | null>;
  forStudent(actor: ActorContext, studentId: string): Promise<ConsentRecord[]>;
}

export interface OutcomeRepository {
  list(actor: ActorContext): Promise<Outcome[]>;
  forStudent(actor: ActorContext, studentId: string): Promise<Outcome[]>;
  forApplication(actor: ActorContext, applicationId: string): Promise<Outcome[]>;
}

/**
 * Escalations, read by the person who raised one and by the administrator.
 *
 * **Nobody else, including the parties the problem is about.** That refusal is
 * the feature rather than a restriction on it: a learner who knows their
 * supervisor will read it does not report an absent supervisor, and a channel
 * carrying only what is safe to say in front of the other party is a comment
 * box. Both layers implement it — `visibleEscalations` and `escalationScope` —
 * and the parity suite checks they agree, including that an employer reading
 * its own placement's escalations gets an empty list rather than an error.
 *
 * `live` is the administrator's queue and the reason the partial index exists.
 */
export interface EscalationRepository {
  list(actor: ActorContext): Promise<Escalation[]>;
  find(actor: ActorContext, id: string): Promise<Escalation | null>;
  forApplication(actor: ActorContext, applicationId: string): Promise<Escalation[]>;
  /** Still open or being looked at, worst kind first, oldest first within a kind. */
  live(actor: ActorContext): Promise<Escalation[]>;
}

/**
 * What each host said at the end of a placement.
 *
 * Narrowed differently from outcomes, because the parties differ. **The
 * employer reads its own** — it is the author, and a statement it cannot read
 * back is one it cannot correct. The college and the administrator read their
 * market's, because they work the queue of placements nobody has answered for.
 *
 * The learner reads their own with the note stripped, and the board its
 * market's on the same terms. Neither is being kept from the answer: a learner
 * knows whether they were offered a job, and a board's interest is the count.
 * What both are kept from is the employer's candid sentence about why it did
 * not keep a named person. See `redactHostOffer`.
 */
export interface HostOfferRepository {
  list(actor: ActorContext): Promise<HostOffer[]>;
  forApplication(actor: ActorContext, applicationId: string): Promise<HostOffer | null>;
  forStudent(actor: ActorContext, studentId: string): Promise<HostOffer[]>;
}

/**
 * The boundaries a market's figures are measured against, and when each began.
 *
 * Read by **everyone**, unscoped beyond the market rule, which is unusual here
 * and deliberate. A region definition names no person and holds no figure — it
 * is a list of counties and a date, closer to a postcode table than to a
 * record. A learner asked where they work, an employer deciding whether hosting
 * counts locally, and a board reading a retention rate are all entitled to know
 * what "in region" means, and a definition somebody cannot see is a figure they
 * cannot check.
 */
export interface RegionDefinitionRepository {
  list(actor: ActorContext): Promise<RegionDefinition[]>;
  forMarket(actor: ActorContext, marketId: string): Promise<RegionDefinition[]>;
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
  mentorshipPairings: MentorshipPairingRepository;
  applications: ApplicationRepository;
  interviewSlots: InterviewSlotRepository;
  timeEntries: TimeEntryRepository;
  creditAwards: CreditAwardRepository;
  fundingSources: FundingSourceRepository;
  fundingCommitments: FundingCommitmentRepository;
  consents: ConsentRepository;
  outcomes: OutcomeRepository;
  escalations: EscalationRepository;
  hostOffers: HostOfferRepository;
  regionDefinitions: RegionDefinitionRepository;
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
/**
 * Which markets the fixtures flag as the demonstration.
 *
 * The in-memory layer *is* the fixtures, so this is derived from them rather
 * than asserted — a fifth market added unflagged would be treated as real
 * here, which is the same answer Postgres gives for an unflagged row. The two
 * layers must agree, and `integration.test.ts` fails if they stop.
 */
const DEMO_MARKET_IDS = new Set(
  seed.markets.filter((m) => m.isDemoData).map((m) => m.id),
);

/** Whether a market belongs to the world this actor asked for. */
function marketMatchesWorld(actor: ActorContext, marketId: string): boolean {
  return DEMO_MARKET_IDS.has(marketId) === viewsDemoData(actor);
}

export function visibleMarketIds(
  actor: ActorContext,
  allMarketIds: string[],
): string[] {
  if (actor.membership.role === "admin") {
    if (actor.systemWide) return allMarketIds;
    return allMarketIds.filter((id) => marketMatchesWorld(actor, id));
  }
  return actor.membership.marketId ? [actor.membership.marketId] : [];
}

export function inScope<T extends { marketId: string }>(
  actor: ActorContext,
  rows: T[],
): T[] {
  // Cross-market, but not across both worlds — the mirror of `marketScope`'s
  // admin branch, and the reason that one stopped being `TRUE`.
  if (actor.membership.role === "admin") {
    if (actor.systemWide) return rows;
    return rows.filter((r) => marketMatchesWorld(actor, r.marketId));
  }
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
