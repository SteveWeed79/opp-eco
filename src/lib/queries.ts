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
import { repositories } from "@/data/memory";
import { DEMO_NOW } from "@/data/seed";
import { creditProgress, DEFAULT_HOURS_PER_CREDIT } from "@/domain/credit";

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
