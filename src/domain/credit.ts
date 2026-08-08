/**
 * Credit accumulation.
 *
 * The two tracks earn credit differently, and conflating them produces
 * nonsense — a 240-hour standard internship is worth the 3 credits its posting
 * declared, not 240/45 = 5.
 *
 *   Standard: awards the posting's declared credit hours, capped by the hours
 *             actually worked so an internship cut short earns proportionally.
 *   Micro:    5-40 hours against a ~45 hour threshold, so a single one
 *             generally cannot earn credit. Hours bank across several projects
 *             until the total clears.
 *
 * That is why a credit award references a *set* of applications.
 */

import type { Application, CreditAward, Posting } from "./types";
import { postingTotalHours } from "./types";

/** Carnegie-style default: one credit is about 45 hours of student work. */
export const DEFAULT_HOURS_PER_CREDIT = 45;

export interface CompletedWork {
  application: Application;
  posting: Posting;
}

export interface CreditProgress {
  /** Credits from standard placements, each awarded against its own posting. */
  standardCredits: number;
  standardApplicationIds: string[];

  /** Micro-internship hours banked but not yet converted into a credit. */
  bankedHours: number;
  hoursPerCredit: number;
  microCredits: number;
  hoursToNextCredit: number;
  microApplicationIds: string[];

  /** Total credits claimable right now. */
  creditsAvailable: number;
  contributingApplicationIds: string[];
}

/** Hours an application actually contributed, across either track. */
export function workHoursFor(
  application: Application,
  posting: Posting,
): number {
  if (application.track === "standard") return application.hoursApproved ?? 0;
  // Micro-internships are fixed-fee with no timesheet; the posting's estimate
  // is the agreed scope and stands in for logged hours.
  return application.deliverableAccepted ? postingTotalHours(posting) : 0;
}

/**
 * Credits a completed standard placement earns: what the posting declared,
 * capped by what the hours worked actually support.
 */
export function standardCreditsEarned(
  application: Application,
  posting: Posting,
  hoursPerCredit: number = DEFAULT_HOURS_PER_CREDIT,
): number {
  const declared = posting.creditHours ?? 0;
  const supported = Math.floor((application.hoursApproved ?? 0) / hoursPerCredit);
  return Math.min(declared, supported);
}

/**
 * How close a student is to earning credit from completed work not yet
 * converted into an award.
 */
export function creditProgress(
  completed: CompletedWork[],
  hoursPerCredit: number = DEFAULT_HOURS_PER_CREDIT,
): CreditProgress {
  const unclaimed = completed.filter(({ application }) => !application.creditAwardId);

  const standard = unclaimed.filter(({ application }) => application.track === "standard");
  const micro = unclaimed.filter(({ application }) => application.track === "micro");

  const standardCredits = standard.reduce(
    (sum, { application, posting }) =>
      sum + standardCreditsEarned(application, posting, hoursPerCredit),
    0,
  );

  const bankedHours = micro.reduce(
    (sum, { application, posting }) => sum + workHoursFor(application, posting),
    0,
  );

  const microCredits = Math.floor(bankedHours / hoursPerCredit);
  const remainder = bankedHours % hoursPerCredit;

  return {
    standardCredits,
    standardApplicationIds: standard.map(({ application }) => application.id),

    bankedHours,
    hoursPerCredit,
    microCredits,
    hoursToNextCredit: hoursPerCredit - remainder,
    microApplicationIds: micro.map(({ application }) => application.id),

    creditsAvailable: standardCredits + microCredits,
    contributingApplicationIds: unclaimed.map(({ application }) => application.id),
  };
}

/**
 * Whether a posting can be advertised as credit-bearing on its own. A micro-
 * internship below the college's threshold cannot, and saying so at posting
 * time is the difference between setting expectations and disappointing a
 * student after the work is done.
 */
export function isSelfSufficientForCredit(
  posting: Posting,
  hoursPerCredit: number = DEFAULT_HOURS_PER_CREDIT,
): boolean {
  return postingTotalHours(posting) >= hoursPerCredit;
}

export function creditsFor(
  posting: Posting,
  hoursPerCredit: number = DEFAULT_HOURS_PER_CREDIT,
): number {
  if (posting.track === "standard") {
    return Math.min(
      posting.creditHours ?? 0,
      Math.floor(postingTotalHours(posting) / hoursPerCredit),
    );
  }
  return Math.floor(postingTotalHours(posting) / hoursPerCredit);
}

/** Build a pending award from completed work once there is credit to award. */
export function buildCreditAward(params: {
  id: string;
  marketId: string;
  studentId: string;
  collegeId: string;
  courseMapping: string;
  progress: CreditProgress;
}): CreditAward | null {
  const { progress } = params;
  if (progress.creditsAvailable < 1) return null;

  // Only the work that actually contributed credit is consumed by the award —
  // micro hours below the threshold stay banked for next time.
  const applicationIds =
    progress.microCredits > 0
      ? progress.contributingApplicationIds
      : progress.standardApplicationIds;

  return {
    id: params.id,
    marketId: params.marketId,
    studentId: params.studentId,
    collegeId: params.collegeId,
    applicationIds,
    creditHours: progress.creditsAvailable,
    totalWorkHours: progress.bankedHours,
    status: "pending",
    courseMapping: params.courseMapping,
    grantedOn: null,
  };
}
