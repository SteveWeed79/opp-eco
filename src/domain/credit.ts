/**
 * Credit accumulation.
 *
 * A standard internship clears the hours threshold on its own. Micro-
 * internships run 5–40 hours against a threshold of roughly 45 hours per
 * credit, so a single one generally cannot earn credit — students bank several
 * until the total clears. That is why a credit award references a *set* of
 * applications rather than one.
 */

import type { Application, CreditAward, Posting } from "./types";
import { postingTotalHours } from "./types";

/** Carnegie-style default: one credit is about 45 hours of student work. */
export const DEFAULT_HOURS_PER_CREDIT = 45;

export interface CreditProgress {
  /** Approved work hours banked but not yet converted into a credit award. */
  bankedHours: number;
  hoursPerCredit: number;
  /** Whole credits the banked hours currently support. */
  creditsAvailable: number;
  hoursToNextCredit: number;
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
 * How close a student is to earning credit from completed work not yet
 * converted into an award.
 */
export function creditProgress(
  completed: { application: Application; posting: Posting }[],
  hoursPerCredit: number = DEFAULT_HOURS_PER_CREDIT,
): CreditProgress {
  const contributing = completed.filter(
    ({ application }) => !application.creditAwardId,
  );

  const bankedHours = contributing.reduce(
    (sum, { application, posting }) => sum + workHoursFor(application, posting),
    0,
  );

  const creditsAvailable = Math.floor(bankedHours / hoursPerCredit);
  const remainder = bankedHours % hoursPerCredit;

  return {
    bankedHours,
    hoursPerCredit,
    creditsAvailable,
    hoursToNextCredit: creditsAvailable > 0 && remainder === 0 ? 0 : hoursPerCredit - remainder,
    contributingApplicationIds: contributing.map(({ application }) => application.id),
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
  return Math.floor(postingTotalHours(posting) / hoursPerCredit);
}

/** Build a pending award from banked work once the threshold is cleared. */
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

  return {
    id: params.id,
    marketId: params.marketId,
    studentId: params.studentId,
    collegeId: params.collegeId,
    applicationIds: progress.contributingApplicationIds,
    creditHours: progress.creditsAvailable,
    totalWorkHours: progress.bankedHours,
    status: "pending",
    courseMapping: params.courseMapping,
    grantedOn: null,
  };
}
