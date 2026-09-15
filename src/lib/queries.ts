/**
 * Derived views over the repositories.
 *
 * Portals stay thin: they render what these return rather than each computing
 * their own version of "what's stuck", which is how five surfaces end up with
 * five different answers.
 *
 * Every function takes the calling actor and reads through the repositories
 * with it. An earlier version held a module-level admin context, which meant
 * any portal calling in here quietly acquired cross-market reach and bypassed
 * the isolation the repository layer exists to enforce.
 */

import type {
  Application,
  Market,
  Outcome,
  Posting,
  Student,
} from "@/domain/types";
import {
  PAUSE_STATUSES,
  WAITING_STATUSES,
  daysInStatus,
  isTerminal,
} from "@/domain/workflow";
import type { ActorContext } from "@/domain/types";
import { repositories } from "@/data/backend";
import { DEMO_NOW } from "@/data/seed";
import { creditProgress, DEFAULT_HOURS_PER_CREDIT } from "@/domain/credit";
import {
  balancesFor,
  wageSubsidySource,
  type FundingBalance,
} from "@/domain/funding";
import {
  awaitsFollowUp,
  canReadOutcomes,
  daysSinceExit,
  hasExited,
  summarizeOutcomes,
  type OutcomeSummary,
} from "@/domain/outcome";

export interface StalledItem {
  application: Application;
  posting: Posting;
  student: Student;
  days: number;
  /** Who the application is currently waiting on. */
  blockedOn: string;
  inPause: boolean;
}

const BLOCKED_ON: Record<string, string> = {
  submitted: "Business",
  under_review: "Business",
  shortlisted: "Student",
  mutual_interest: "Student — has not booked a board interview",
  interview_scheduled: "Workforce board",
  interview_completed: "Workforce board — no determination recorded",
  cleared: "Workforce board — no funding decision",
  credit_pending: "College",
};

/**
 * Exception-first: what is stuck and who is sitting on it. Sorted by dwell
 * time, with the pause weighted heaviest because that is where placements die.
 */
export async function stalledApplications(
  actor: ActorContext,
  thresholdDays = 5,
): Promise<StalledItem[]> {
  const applications = await repositories.applications.list(actor);

  // Filter before reading anything else, so the per-application lookups below
  // run only for rows that will actually be returned.
  const candidates = applications.filter(
    (application) =>
      !isTerminal(application.status) &&
      WAITING_STATUSES.includes(application.status) &&
      daysInStatus(application, DEMO_NOW) >= thresholdDays,
  );

  // Resolved together rather than in sequence. Against the in-memory store the
  // difference is nothing; against Postgres this is the loop that would
  // otherwise issue two round trips per stalled application, one after another.
  const resolved = await Promise.all(
    candidates.map(async (application) => {
      const [posting, student] = await Promise.all([
        await repositories.postings.find(actor, application.postingId),
        await repositories.students.find(actor, application.studentId),
      ]);
      if (!posting || !student) return null;
      return {
        application,
        posting,
        student,
        days: daysInStatus(application, DEMO_NOW),
        blockedOn: BLOCKED_ON[application.status] ?? "—",
        inPause: PAUSE_STATUSES.includes(application.status),
      };
    }),
  );

  const items = resolved.filter((item): item is StalledItem => item !== null);

  return items.sort((a, b) => {
    if (a.inPause !== b.inPause) return a.inPause ? -1 : 1;
    return b.days - a.days;
  });
}

export interface MarketHealth {
  market: Market;
  activeStudents: number;
  activeBusinesses: number;
  openPostings: number;
  liveApplications: number;
  inPause: number;
  committed: number;
  /** The wage fund's allocation. Zero where a market has no fund yet. */
  allocated: number;
  /** What that fund pays per hour. Zero where there is no fund. */
  ratePerHour: number;
  remaining: number;
  /** More committed than the fund now holds. Reachable, and named rather than hidden. */
  overcommitted: boolean;
  placements: number;
  creditHoursGranted: number;
}

export async function marketHealth(
  actor: ActorContext,
  market: Market,
): Promise<MarketHealth> {
  const [allApplications, allCredits, students, businesses, published, funding] =
    await Promise.all([
      await repositories.applications.list(actor),
      await repositories.creditAwards.list(actor),
      await repositories.students.list(actor),
      await repositories.organizations.list(actor, { kind: "business" }),
      await repositories.postings.published(actor),
      marketFunding(actor, market.id),
    ]);

  const applications = allApplications.filter((a) => a.marketId === market.id);

  // From the ledger, not from the applications. They used to be the same sum
  // and are no longer: a placement that ran and finished has *spent* its
  // commitment rather than freed it, which the old "is the application
  // terminal" test counted as released.
  const committed = funding.wage ? funding.wage.committed : 0;

  const credits = allCredits.filter(
    (c) => c.marketId === market.id && c.status === "granted",
  );

  return {
    market,
    activeStudents: students.filter(
      (s) => s.marketId === market.id && s.status === "verified",
    ).length,
    activeBusinesses: businesses.filter(
      (o) => o.marketId === market.id && o.status === "active",
    ).length,
    openPostings: published.filter(
      (p) => p.marketId === market.id && p.status === "published",
    ).length,
    liveApplications: applications.filter((a) => !isTerminal(a.status)).length,
    inPause: applications.filter((a) => PAUSE_STATUSES.includes(a.status)).length,
    committed,
    allocated: funding.wage ? funding.wage.source.allocated : 0,
    ratePerHour: funding.wage?.source.ratePerHour ?? 0,
    remaining: funding.wage ? funding.wage.remaining : 0,
    overcommitted: funding.wage ? funding.wage.overcommitted : false,
    placements: applications.filter((a) =>
      [
        "placement_active",
        "placement_completed",
        "credit_pending",
        "credit_granted",
      ].includes(a.status),
    ).length,
    creditHoursGranted: credits.reduce((sum, c) => sum + c.creditHours, 0),
  };
}

export async function allMarketHealth(
  actor: ActorContext,
): Promise<MarketHealth[]> {
  const markets = await repositories.markets.list(actor);
  return Promise.all(markets.map((m) => marketHealth(actor, m)));
}

export interface MarketFunding {
  /** Every fund in the market, in purpose order. */
  balances: FundingBalance[];
  /**
   * The wage-subsidy fund — what every budget figure in this product meant
   * before there was more than one kind of money.
   *
   * Null for a market with no fund yet, which is a stage rather than an error:
   * Beloit's board is still in conversation, so there is nobody to sponsor one.
   * Callers must handle it; the alternative is a division by zero on the day a
   * market is opened.
   */
  wage: FundingBalance | null;
  /** Across every fund, not only the board's. */
  totalAllocated: number;
  totalCommitted: number;
  totalRemaining: number;
}

/**
 * Every fund in a market and what is left in each.
 *
 * The single place a balance is computed. Nothing stores a total — a stored
 * total is a number that can disagree with the ledger, and a funder asking
 * where their money went is the worst possible audience for two answers.
 */
export async function marketFunding(
  actor: ActorContext,
  marketId: string,
): Promise<MarketFunding> {
  const [sources, commitments] = await Promise.all([
    repositories.fundingSources.forMarket(actor, marketId),
    repositories.fundingCommitments.list(actor),
  ]);

  const balances = balancesFor(sources, commitments);
  const wageSource = wageSubsidySource(sources);

  return {
    balances,
    wage: wageSource ? balances.find((b) => b.source.id === wageSource.id) ?? null : null,
    totalAllocated: balances.reduce((sum, b) => sum + b.source.allocated, 0),
    totalCommitted: balances.reduce((sum, b) => sum + b.committed, 0),
    totalRemaining: balances.reduce((sum, b) => sum + b.remaining, 0),
  };
}

/**
 * Uncommitted wage subsidy left in a market's program year.
 *
 * Kept as its own function with the same signature it always had, because the
 * state machine's funding guard takes this one number and should not have to
 * know that funding grew a model behind it. **Can be negative**, where an
 * allocation was cut below what was already committed — the guard refuses a new
 * commitment against a negative remainder on its own, which is the correct
 * behaviour and needed no change.
 */
export async function marketRemainingBudget(
  actor: ActorContext,
  market: Market,
): Promise<number> {
  return (await marketFunding(actor, market.id)).wage?.remaining ?? 0;
}

/**
 * Average days applications *currently* sitting in the pause have been there.
 *
 * Deliberately measures the live backlog rather than historical throughput —
 * the fixtures carry no per-transition history, and a number derived from
 * submission dates would look precise while meaning nothing.
 */
export async function averagePauseDays(actor: ActorContext): Promise<number> {
  const inPause = (await repositories.applications.list(actor)).filter((a) =>
    PAUSE_STATUSES.includes(a.status),
  );
  if (inPause.length === 0) return 0;
  const total = inPause.reduce((sum, a) => sum + daysInStatus(a, DEMO_NOW), 0);
  return Math.round(total / inPause.length);
}

export interface FunnelStage {
  label: string;
  count: number;
}

/**
 * Conversion through each stage, with the pause called out explicitly.
 *
 * Counts by *furthest stage reached*, not current status. Enumerating live
 * statuses per stage meant an application dropped out of every stage the
 * instant it closed, so the funnel appeared to collapse as work finished.
 */
export async function funnel(actor: ActorContext): Promise<FunnelStage[]> {
  const applications = await repositories.applications.list(actor);

  const atLeast = (stage: FunnelRank) =>
    applications.filter((a) => furthestRank(a) >= stage).length;

  return [
    { label: "Applied", count: applications.length },
    { label: "Shortlisted", count: atLeast(FunnelRank.Shortlisted) },
    { label: "Mutual interest", count: atLeast(FunnelRank.MutualInterest) },
    { label: "Through the pause", count: atLeast(FunnelRank.ThroughPause) },
    { label: "Placed", count: atLeast(FunnelRank.Placed) },
    { label: "Credit granted", count: atLeast(FunnelRank.CreditGranted) },
  ];
}

enum FunnelRank {
  Applied = 0,
  Shortlisted = 1,
  MutualInterest = 2,
  ThroughPause = 3,
  Placed = 4,
  CreditGranted = 5,
}

/** How far along the funnel a given status implies the application got. */
const STATUS_RANK: Record<Application["status"], FunnelRank> = {
  submitted: FunnelRank.Applied,
  under_review: FunnelRank.Applied,
  rejected: FunnelRank.Applied,
  withdrawn: FunnelRank.Applied,
  shortlisted: FunnelRank.Shortlisted,
  mutual_interest: FunnelRank.MutualInterest,
  interview_scheduled: FunnelRank.MutualInterest,
  interview_completed: FunnelRank.MutualInterest,
  cleared: FunnelRank.MutualInterest,
  funding_authorized: FunnelRank.ThroughPause,
  unsubsidized: FunnelRank.ThroughPause,
  placement_active: FunnelRank.Placed,
  placement_completed: FunnelRank.Placed,
  terminated_early: FunnelRank.Placed,
  credit_pending: FunnelRank.Placed,
  credit_denied: FunnelRank.Placed,
  credit_granted: FunnelRank.CreditGranted,
  // `closed` says nothing about how far the application got, so it defers to
  // the recorded furthest status.
  closed: FunnelRank.Applied,
};

function furthestRank(application: Application): FunnelRank {
  const current = STATUS_RANK[application.status];
  const furthest = application.furthestStatus
    ? STATUS_RANK[application.furthestStatus]
    : FunnelRank.Applied;
  return Math.max(current, furthest);
}

/** Banked micro-internship hours not yet converted into a credit award. */
export async function studentCreditProgress(
  actor: ActorContext,
  studentId: string,
  hoursPerCredit = DEFAULT_HOURS_PER_CREDIT,
) {
  const applications = (
    await repositories.applications.forStudent(actor, studentId)
  ).filter((a) =>
    ["placement_completed", "credit_pending", "credit_granted"].includes(a.status),
  );

  const resolved = await Promise.all(
    applications.map(async (application) => {
      const posting = await repositories.postings.find(actor, application.postingId);
      return posting ? { application, posting } : null;
    }),
  );

  const completed = resolved.filter(
    (x): x is { application: Application; posting: Posting } => x !== null,
  );

  return creditProgress(completed, hoursPerCredit);
}

/**
 * Wage subsidy committed across every market the actor can see.
 *
 * Wage subsidy specifically, not all money: this is the administrator's
 * headline figure and it has always meant the board's commitment. Foundation
 * and institutional funds are reported beside it rather than folded into it,
 * because a total that mixes public and philanthropic dollars is the one number
 * neither funder would accept.
 */
export async function subsidyDeployed(actor: ActorContext): Promise<number> {
  const [sources, commitments] = await Promise.all([
    repositories.fundingSources.list(actor),
    repositories.fundingCommitments.list(actor),
  ]);
  const wageIds = new Set(
    sources.filter((s) => s.purpose === "wage_subsidy").map((s) => s.id),
  );
  return commitments
    .filter((c) => wageIds.has(c.fundingSourceId) && c.status !== "released")
    .reduce((sum, c) => sum + c.amount, 0);
}

/** Everything committed that is not the board's wage subsidy. */
export async function assistanceDeployed(actor: ActorContext): Promise<number> {
  const [sources, commitments] = await Promise.all([
    repositories.fundingSources.list(actor),
    repositories.fundingCommitments.list(actor),
  ]);
  const otherIds = new Set(
    sources.filter((s) => s.purpose !== "wage_subsidy").map((s) => s.id),
  );
  return commitments
    .filter((c) => otherIds.has(c.fundingSourceId) && c.status !== "released")
    .reduce((sum, c) => sum + c.amount, 0);
}

// ---------------------------------------------------------------------------
// Follow-up
// ---------------------------------------------------------------------------

export interface FollowUpItem {
  application: Application;
  student: Student;
  posting: Posting;
  /** How long the learner has been waiting to be asked. */
  days: number;
}

/**
 * Finished experiences nobody has followed up on, longest wait first.
 *
 * The college's queue, and the same exception-first shape as
 * `stalledApplications` — a list of every placement ever completed is a report,
 * and what an operator needs is the work still outstanding.
 *
 * Per experience rather than per learner: the whole reason the record hangs off
 * an application is being able to say which one produced which result, so a
 * learner who finished two placements is asked about each. `awaitsFollowUp`
 * holds that rule; this function only reads it.
 */
export async function followUpQueue(
  actor: ActorContext,
): Promise<FollowUpItem[]> {
  // Refused outright rather than answered from an empty list. An employer reads
  // the applications against its own postings and reads no outcomes at all, so
  // subtracting one from the other would report every placement it hosted as
  // never followed up — work already done, shown as outstanding.
  if (!canReadOutcomes(actor.membership.role)) return [];

  const [applications, outcomes] = await Promise.all([
    repositories.applications.list(actor),
    repositories.outcomes.list(actor),
  ]);

  const candidates = applications.filter((a) => awaitsFollowUp(a, outcomes));

  // Resolved together rather than one after another, for the reason
  // `stalledApplications` does it: against Postgres this loop would otherwise
  // be two sequential round trips per row.
  const resolved = await Promise.all(
    candidates.map(async (application) => {
      const [student, posting] = await Promise.all([
        repositories.students.find(actor, application.studentId),
        repositories.postings.find(actor, application.postingId),
      ]);
      if (!student || !posting) return null;
      return {
        application,
        student,
        posting,
        days: daysSinceExit(application, DEMO_NOW),
      };
    }),
  );

  return resolved
    .filter((item): item is FollowUpItem => item !== null)
    .sort((a, b) => b.days - a.days);
}

/**
 * What the follow-ups add up to, and how much of the queue is unworked.
 *
 * Both numbers, always. A regional employment rate on its own is a figure a
 * reader has no way to weigh — over two learners it means nothing, and over
 * forty it is the venture's central claim — so the count it was computed from
 * travels with it, and so does the count it was *not* computed from.
 */
export async function outcomeReport(
  actor: ActorContext,
): Promise<OutcomeSummary> {
  // Same refusal as the queue, and for the same reason: a zeroed report and a
  // report the caller may not have are different answers.
  if (!canReadOutcomes(actor.membership.role)) return summarizeOutcomes([], 0);

  const [applications, outcomes] = await Promise.all([
    repositories.applications.list(actor),
    repositories.outcomes.list(actor),
  ]);

  const unmeasured = applications.filter((a) => awaitsFollowUp(a, outcomes)).length;
  return summarizeOutcomes(outcomes, unmeasured);
}

/** Every finished experience, measured or not. The denominator behind the rate. */
export async function exitedPlacements(
  actor: ActorContext,
): Promise<Application[]> {
  return (await repositories.applications.list(actor)).filter(hasExited);
}

/**
 * A learner's own follow-up history, newest first.
 *
 * Plural because it is a history rather than a current value: the college that
 * recorded "still looking" in March and "working in Pittsburg" in May holds the
 * only evidence this platform will ever have that something changed in between.
 */
export async function studentOutcomes(
  actor: ActorContext,
  studentId: string,
): Promise<Outcome[]> {
  return repositories.outcomes.forStudent(actor, studentId);
}
