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
export function stalledApplications(
  actor: ActorContext,
  thresholdDays = 5,
): StalledItem[] {
  const applications = repositories.applications.list(actor);
  const items: StalledItem[] = [];

  for (const application of applications) {
    if (isTerminal(application.status)) continue;
    if (!WAITING_STATUSES.includes(application.status)) continue;

    const days = daysInStatus(application, DEMO_NOW);
    if (days < thresholdDays) continue;

    const posting = repositories.postings.find(actor, application.postingId);
    const student = repositories.students.find(actor, application.studentId);
    if (!posting || !student) continue;

    items.push({
      application,
      posting,
      student,
      days,
      blockedOn: BLOCKED_ON[application.status] ?? "—",
      inPause: PAUSE_STATUSES.includes(application.status),
    });
  }

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

export function marketHealth(actor: ActorContext, market: Market): MarketHealth {
  const applications = repositories.applications
    .list(actor)
    .filter((a) => a.marketId === market.id);

  const committed = applications
    .filter((a) => !isTerminal(a.status))
    .reduce((sum, a) => sum + fundingCommitment(a), 0);

  const credits = repositories.creditAwards
    .list(actor)
    .filter((c) => c.marketId === market.id && c.status === "granted");

  return {
    market,
    activeStudents: repositories.students
      .list(actor)
      .filter((s) => s.marketId === market.id && s.status === "verified").length,
    activeBusinesses: repositories.organizations
      .list(actor, { kind: "business" })
      .filter((o) => o.marketId === market.id && o.status === "active").length,
    openPostings: repositories.postings
      .published(actor)
      .filter((p) => p.marketId === market.id && p.status === "published").length,
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

export function allMarketHealth(actor: ActorContext): MarketHealth[] {
  return repositories.markets.list(actor).map((m) => marketHealth(actor, m));
}

/** Uncommitted allocation left in a market's program year. */
export function marketRemainingBudget(actor: ActorContext, market: Market): number {
  const committed = repositories.applications
    .list(actor)
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
export function averagePauseDays(actor: ActorContext): number {
  const inPause = repositories.applications
    .list(actor)
    .filter((a) => PAUSE_STATUSES.includes(a.status));
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
export function funnel(actor: ActorContext): FunnelStage[] {
  const applications = repositories.applications.list(actor);

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
export function studentCreditProgress(
  actor: ActorContext,
  studentId: string,
  hoursPerCredit = DEFAULT_HOURS_PER_CREDIT,
) {
  const applications = repositories.applications
    .forStudent(actor, studentId)
    .filter((a) =>
      ["placement_completed", "credit_pending", "credit_granted"].includes(a.status),
    );

  const completed = applications
    .map((application) => {
      const posting = repositories.postings.find(actor, application.postingId);
      return posting ? { application, posting } : null;
    })
    .filter((x): x is { application: Application; posting: Posting } => x !== null);

  return creditProgress(completed, hoursPerCredit);
}

export function subsidyDeployed(actor: ActorContext): number {
  return repositories.applications
    .list(actor)
    .filter((a) => !isTerminal(a.status))
    .reduce((sum, a) => sum + fundingCommitment(a), 0);
}
