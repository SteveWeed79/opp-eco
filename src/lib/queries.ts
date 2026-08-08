/**
 * Derived views over the repositories.
 *
 * Portals stay thin: they render what these return rather than each computing
 * their own version of "what's stuck", which is how five surfaces end up with
 * five different answers.
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
import { repositories } from "@/data/memory";
import { contextFor } from "@/data/session";
import { DEMO_NOW } from "@/data/seed";
import { creditProgress, DEFAULT_HOURS_PER_CREDIT } from "@/domain/credit";

const admin = contextFor("admin");

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
export function stalledApplications(thresholdDays = 5): StalledItem[] {
  const applications = repositories.applications.list(admin);
  const items: StalledItem[] = [];

  for (const application of applications) {
    if (isTerminal(application.status)) continue;
    if (!WAITING_STATUSES.includes(application.status)) continue;

    const days = daysInStatus(application, DEMO_NOW);
    if (days < thresholdDays) continue;

    const posting = repositories.postings.find(admin, application.postingId);
    const student = repositories.students.find(admin, application.studentId);
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

export function marketHealth(market: Market): MarketHealth {
  const applications = repositories.applications
    .list(admin)
    .filter((a) => a.marketId === market.id);

  const committed = applications
    .filter((a) => !isTerminal(a.status))
    .reduce((sum, a) => sum + fundingCommitment(a), 0);

  const credits = repositories.creditAwards
    .list(admin)
    .filter((c) => c.marketId === market.id && c.status === "granted");

  return {
    market,
    activeStudents: repositories.students
      .list(admin)
      .filter((s) => s.marketId === market.id && s.status === "verified").length,
    activeBusinesses: repositories.organizations
      .list(admin, { kind: "business" })
      .filter((o) => o.marketId === market.id && o.status === "active").length,
    openPostings: repositories.postings
      .list(admin)
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

export function allMarketHealth(): MarketHealth[] {
  return repositories.markets.list(admin).map(marketHealth);
}

/** Average days spent in the pause, across applications that got through it. */
export function averagePauseDays(): number {
  const applications = repositories.applications.list(admin);
  const throughPause = applications.filter((a) =>
    ["funding_authorized", "unsubsidized", "placement_active", "placement_completed", "credit_pending", "credit_granted"].includes(
      a.status,
    ),
  );
  if (throughPause.length === 0) return 0;
  // Approximated from time between submission and current status for the demo.
  const total = throughPause.reduce((sum, a) => {
    const submitted = new Date(a.submittedOn).getTime();
    const since = new Date(a.statusSince).getTime();
    return sum + Math.max(0, (since - submitted) / 86_400_000);
  }, 0);
  return Math.round(total / throughPause.length);
}

export interface FunnelStage {
  label: string;
  count: number;
}

/** Conversion through each stage, with the pause called out explicitly. */
export function funnel(): FunnelStage[] {
  const applications = repositories.applications.list(admin);
  const reached = (statuses: Application["status"][]) =>
    applications.filter((a) => statuses.includes(a.status)).length;

  const downstreamOfPause: Application["status"][] = [
    "funding_authorized",
    "unsubsidized",
    "placement_active",
    "placement_completed",
    "credit_pending",
    "credit_granted",
  ];
  const inOrPastPause: Application["status"][] = [
    ...PAUSE_STATUSES,
    ...downstreamOfPause,
  ];

  return [
    { label: "Applied", count: applications.length },
    {
      label: "Shortlisted",
      count: reached([
        "shortlisted",
        ...inOrPastPause,
      ]),
    },
    { label: "Mutual interest", count: reached(inOrPastPause) },
    { label: "Through the pause", count: reached(downstreamOfPause) },
    {
      label: "Placed",
      count: reached([
        "placement_active",
        "placement_completed",
        "credit_pending",
        "credit_granted",
      ]),
    },
    { label: "Credit granted", count: reached(["credit_granted"]) },
  ];
}

/** Banked micro-internship hours not yet converted into a credit award. */
export function studentCreditProgress(studentId: string, hoursPerCredit = DEFAULT_HOURS_PER_CREDIT) {
  const applications = repositories.applications
    .forStudent(admin, studentId)
    .filter((a) =>
      ["placement_completed", "credit_pending", "credit_granted"].includes(a.status),
    );

  const completed = applications
    .map((application) => {
      const posting = repositories.postings.find(admin, application.postingId);
      return posting ? { application, posting } : null;
    })
    .filter((x): x is { application: Application; posting: Posting } => x !== null);

  return creditProgress(completed, hoursPerCredit);
}

export function subsidyDeployed(): number {
  return repositories.applications
    .list(admin)
    .filter((a) => !isTerminal(a.status))
    .reduce((sum, a) => sum + fundingCommitment(a), 0);
}
