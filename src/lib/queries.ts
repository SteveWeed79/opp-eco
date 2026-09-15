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
  fundingCommitment,
  isTerminal,
} from "@/domain/workflow";
import type { ActorContext } from "@/domain/types";
import { repositories } from "@/data/backend";
import { DEMO_NOW } from "@/data/seed";
import { creditProgress, DEFAULT_HOURS_PER_CREDIT } from "@/domain/credit";
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
  remaining: number;
  placements: number;
  creditHoursGranted: number;
}

export async function marketHealth(
  actor: ActorContext,
  market: Market,
): Promise<MarketHealth> {
  const [allApplications, allCredits, students, businesses, published] =
    await Promise.all([
      await repositories.applications.list(actor),
      await repositories.creditAwards.list(actor),
      await repositories.students.list(actor),
      await repositories.organizations.list(actor, { kind: "business" }),
      await repositories.postings.published(actor),
    ]);

  const applications = allApplications.filter((a) => a.marketId === market.id);

  const committed = applications
    .filter((a) => !isTerminal(a.status))
    .reduce((sum, a) => sum + fundingCommitment(a), 0);

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
    remaining: market.subsidyBudget - committed,
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

/** Uncommitted allocation left in a market's program year. */
export async function marketRemainingBudget(
  actor: ActorContext,
  market: Market,
): Promise<number> {
  const committed = (await repositories.applications.list(actor))
    .filter((a) => a.marketId === market.id && !isTerminal(a.status))
    .reduce((sum, a) => sum + fundingCommitment(a), 0);
  return market.subsidyBudget - committed;
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

export async function subsidyDeployed(actor: ActorContext): Promise<number> {
  return (await repositories.applications.list(actor))
    .filter((a) => !isTerminal(a.status))
    .reduce((sum, a) => sum + fundingCommitment(a), 0);
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
