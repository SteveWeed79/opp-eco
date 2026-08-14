/**
 * Hours: who logs them, who validates them, and what they are worth.
 *
 * The lifecycle used to dead-end here. `placement_active → placement_completed`
 * has always guarded on `hoursApproved > 0`, but nothing in the product could
 * produce that number — it existed only in the seed. A placement could start
 * and never finish.
 *
 * Hours are the one record every party needs and none of them owns alone:
 *
 * - the **student** logs the week, because they did the work;
 * - the **employer** approves it, because they are the only party who knows
 *   whether the student was there — this is the validation step, and it is
 *   the reason hours are not simply self-reported;
 * - the **college** reads it to award credit, which is an academic judgement
 *   about work done, not about money;
 * - the **board** reads it to reimburse, which is a financial judgement about
 *   money, not about work.
 *
 * Those last two want different things from the same rows, which is why the
 * repository shows them different things.
 */

import type { Application, TimeEntry, TimeEntryStatus } from "./types";

/**
 * What a placement's hours add up to.
 *
 * `logged` is everything submitted that has not been rejected — the student's
 * claim. `approved` is what the supervisor has actually signed off. They are
 * different numbers and conflating them is how a platform tells a board that
 * money is owed on hours nobody verified.
 */
export interface TimesheetTotals {
  logged: number;
  approved: number;
  /** Submitted and still sitting with the employer. */
  awaitingReview: number;
  rejected: number;
  /** Weeks with hours still awaiting review. Drives the "cannot complete" guard. */
  unreviewedWeeks: number;
}

export function timesheetTotals(entries: TimeEntry[]): TimesheetTotals {
  const sum = (status: TimeEntryStatus) =>
    entries
      .filter((entry) => entry.status === status)
      .reduce((total, entry) => total + entry.hours, 0);

  const awaitingReview = sum("submitted");
  const approved = sum("approved");

  return {
    // A rejected week is not a claim any more, so it does not count as logged.
    // Leaving it in would let a student inflate their apparent contribution by
    // submitting weeks that were sent back.
    logged: approved + awaitingReview,
    approved,
    awaitingReview,
    rejected: sum("rejected"),
    unreviewedWeeks: entries.filter((entry) => entry.status === "submitted").length,
  };
}

/**
 * What the board actually owes on a placement, and what it does not.
 *
 * The board authorizes an hour cap and a rate up front, against a finite
 * annual allocation. Approved hours can exceed that cap — a supervisor
 * approving a genuine week does not know or care what the board committed
 * three months ago, and telling them to refuse real work because a budget line
 * ran out would be both wrong and unenforceable.
 *
 * So the overage is **surfaced, not prevented**. Someone bears that cost, and
 * it is the employer. A platform that silently reimbursed past the cap would
 * overspend the allocation; one that silently dropped the hours would hide a
 * bill the employer is about to receive. Naming it is the only honest option.
 */
export interface Reimbursement {
  /** Hours the board committed to, up front. Zero for an unsubsidized placement. */
  authorizedHours: number;
  ratePerHour: number;
  approvedHours: number;
  /** Approved hours within the cap — what the board will actually pay for. */
  reimbursableHours: number;
  /** Approved hours beyond the cap. The employer carries these. */
  unreimbursedHours: number;
  amount: number;
  /** True once approved hours have passed the authorization. */
  overCap: boolean;
  /** Fraction of the cap consumed, for a progress read. Capped at 1. */
  capUsed: number;
}

export function reimbursementFor(
  application: Application,
  approvedHours: number,
): Reimbursement {
  const authorizedHours = application.fundingAuthorizedHours ?? 0;
  const ratePerHour = application.fundingAuthorizedRate ?? 0;

  const reimbursableHours = Math.min(approvedHours, authorizedHours);
  const unreimbursedHours = Math.max(0, approvedHours - authorizedHours);

  return {
    authorizedHours,
    ratePerHour,
    approvedHours,
    reimbursableHours,
    unreimbursedHours,
    amount: reimbursableHours * ratePerHour,
    overCap: unreimbursedHours > 0,
    capUsed: authorizedHours > 0 ? Math.min(1, approvedHours / authorizedHours) : 0,
  };
}

/**
 * The Monday of the week containing `date`, as an ISO date.
 *
 * Weeks are keyed by their Monday so that "the week of the 3rd" is one value
 * whichever day within it a student happens to submit from. Computed in UTC
 * deliberately: a student logging on Sunday evening in Kansas is on Monday in
 * UTC, and a week that shifts with the submitter's clock is a week that can be
 * claimed twice.
 */
export function weekStartingFor(date: Date): string {
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // getUTCDay: 0 is Sunday, so Sunday belongs to the week that began six days
  // earlier rather than starting a new one.
  const offset = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - offset);
  return utc.toISOString().slice(0, 10);
}

/** Weeks a student has already claimed on a placement, for duplicate rejection. */
export function claimedWeeks(entries: TimeEntry[]): Set<string> {
  return new Set(
    entries
      // A rejected week is free to be corrected and resubmitted — that is what
      // rejection is for. Only live claims block.
      .filter((entry) => entry.status !== "rejected")
      .map((entry) => entry.weekStarting),
  );
}

/**
 * How far back a student may still log.
 *
 * Not a policy invented here — a bound on the picker. A placement that has run
 * eight months would otherwise offer thirty-odd weeks in a dropdown, and a
 * student scrolling for the right one picks the wrong one.
 */
export const OPEN_WEEK_WINDOW = 8;

/**
 * Weeks this placement still has room to claim, newest first.
 *
 * Bounded at both ends: never before the placement started, never after the
 * week in progress, and never a week already claimed. Offering only the weeks
 * that can succeed means the common mistakes are unreachable rather than
 * rejected after the fact.
 */
export function openWeeksFor(
  placementStart: Date,
  now: Date,
  entries: TimeEntry[],
): string[] {
  const claimed = claimedWeeks(entries);
  const earliest = weekStartingFor(placementStart);
  const weeks: string[] = [];

  for (let back = 0; back < OPEN_WEEK_WINDOW; back++) {
    const week = weekStartingFor(new Date(now.getTime() - back * 7 * 86_400_000));
    if (week < earliest) break;
    if (!claimed.has(week)) weeks.push(week);
  }

  return weeks;
}

/**
 * The most hours a single week may claim.
 *
 * Not a policy judgement about overtime — a ceiling that stops a typo. An
 * intern logging 400 hours in a week is a fat-fingered 40, and catching it at
 * submission is cheaper than catching it in a reimbursement claim.
 */
export const MAX_HOURS_PER_WEEK = 60;

/** Sort newest first, which is the order every surface displays them in. */
export function byWeekDescending(a: TimeEntry, b: TimeEntry): number {
  return b.weekStarting.localeCompare(a.weekStarting);
}
