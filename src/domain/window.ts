/**
 * When a follow-up is due, and when it stopped being possible.
 *
 * The lifecycle ends at credit granted. `Outcome` records where the learner
 * went afterwards. This decides *when* to ask — which until now was "whenever
 * somebody gets round to it", and a figure gathered whenever somebody gets
 * round to it cannot be compared to one gathered on a schedule.
 *
 * **Two windows per placement: the 2nd and the 4th calendar quarter after the
 * quarter the placement ended in.** That is the shape workforce reporting
 * already uses, so the resulting number lands beside figures a board
 * recognises instead of needing a translation nobody performs.
 *
 * Calendar quarters, not elapsed months, and the difference is the whole point.
 * A placement ending 20 February and one ending 28 March are both in Q1, so
 * both are measured in Q3 — while one ending 2 April is measured in Q4. Elapsed
 * time therefore varies from roughly three months to six, which looks arbitrary
 * to whoever works the queue and is exactly what makes two cohorts comparable:
 * they are measured against the same calendar, not against their own start
 * dates. The screens say "covers Jul–Sep" rather than making anybody do this
 * arithmetic.
 *
 * ## Why two
 *
 * The second quarter alone is a weak retention signal — somebody employed three
 * months after an internship may simply be finishing the summer. The fourth
 * alone misses the people who were reachable early and gone later, and misses
 * the movement between the two, which is itself a finding: regional at Q2 and
 * gone at Q4 is a different story about a town than never having stayed.
 *
 * ## Why a missed window stays missed
 *
 * A window that closed unanswered is not work; it is a hole. Nobody can be
 * phoned in March and asked where they were last August with any confidence,
 * and a queue that keeps offering impossible work teaches its operator to
 * ignore the queue. So `missed` is a reported state rather than a task, and it
 * is the honest cost of having decided the interval late.
 *
 * This module knows nothing about an `Application` on purpose. It is calendar
 * arithmetic over one date; `outcome.ts` knows what an exit *is* — which
 * statuses mean the work is over, and which field holds the date — and composes
 * the two. Reaching for that knowledge here made a cycle between the two
 * modules, which ESM tolerates and a reader should not have to.
 */

import type { Outcome } from "./types";

/**
 * Which quarters after exit are measured.
 *
 * The 2nd and the 4th, matching the two employment indicators workforce
 * reporting publishes. Adding a third later is a one-line change that works
 * only for placements exiting after it — every window that has already closed
 * stays closed, which is the argument for having picked both now.
 */
export const FOLLOW_UP_QUARTERS = [2, 4] as const;

export type FollowUpState = "waiting" | "due" | "answered" | "missed";

export interface FollowUpWindow {
  /** 2 or 4 — how many quarters after the exit quarter this one is. */
  quartersAfterExit: number;
  /** Inclusive, ISO. */
  opensOn: string;
  /** Exclusive, ISO — the instant the next quarter begins. */
  closesOn: string;
  /** "Jul–Sep 2026", for a screen that should never show arithmetic. */
  label: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The quarter a date falls in, as a count of quarters since year zero. */
function quarterIndex(iso: string): number {
  const at = new Date(iso);
  return at.getUTCFullYear() * 4 + Math.floor(at.getUTCMonth() / 3);
}

function quarterStart(index: number): Date {
  const year = Math.floor(index / 4);
  const quarter = index % 4;
  return new Date(Date.UTC(year, quarter * 3, 1));
}

function quarterLabel(index: number): string {
  const year = Math.floor(index / 4);
  const first = (index % 4) * 3;
  return `${MONTHS[first]}–${MONTHS[first + 2]} ${year}`;
}

/**
 * The windows a placement that ended on this date is measured in.
 *
 * The caller passes `exitDateOf(application)` — the day the work stopped, not
 * `statusSince`, which moves every time the application does. A clock running
 * from the latter would put a placement in the wrong quarter as soon as its
 * credit paperwork crossed a quarter boundary.
 */
export function followUpWindows(exitedOn: string): FollowUpWindow[] {
  const exitQuarter = quarterIndex(exitedOn);

  return FOLLOW_UP_QUARTERS.map((quartersAfterExit) => {
    const index = exitQuarter + quartersAfterExit;
    return {
      quartersAfterExit,
      opensOn: quarterStart(index).toISOString(),
      closesOn: quarterStart(index + 1).toISOString(),
      label: quarterLabel(index),
    };
  });
}

/**
 * The window an observation answers, or null if it answers none.
 *
 * By `observedOn` — when the thing was *true* — not by `recordedOn`, because a
 * follow-up written up a fortnight after the call still describes the day of
 * the call. That distinction is the reason the two fields are separate.
 *
 * An observation made before the first window opens answers nothing. It is not
 * discarded — it is a real record of where somebody was at the time, and it
 * still counts in the summary — but it cannot stand in for a measurement of a
 * quarter that had not happened yet.
 */
export function windowAnsweredBy(
  outcome: Outcome,
  windows: FollowUpWindow[],
): FollowUpWindow | null {
  return (
    windows.find(
      (w) => outcome.observedOn >= w.opensOn && outcome.observedOn < w.closesOn,
    ) ?? null
  );
}

export interface WindowStatus extends FollowUpWindow {
  state: FollowUpState;
}

/**
 * Where each of this placement's windows stands.
 *
 * `answered` beats everything: an observation inside the window settles it.
 * Otherwise the clock decides — not yet open is `waiting`, open is `due`, and
 * closed with nothing in it is `missed`.
 */
export function windowStatuses(
  exitedOn: string,
  /** Already narrowed to this placement by the caller. */
  outcomes: Outcome[],
  now: Date,
): WindowStatus[] {
  const at = now.toISOString();

  return followUpWindows(exitedOn).map((window) => {
    const answered = outcomes.some((o) => windowAnsweredBy(o, [window]) !== null);
    if (answered) return { ...window, state: "answered" as const };
    if (at < window.opensOn) return { ...window, state: "waiting" as const };
    if (at >= window.closesOn) return { ...window, state: "missed" as const };
    return { ...window, state: "due" as const };
  });
}

/** The window to ask about now, or null when nothing is open and unanswered. */
export function windowDueNow(
  exitedOn: string,
  outcomes: Outcome[],
  now: Date,
): WindowStatus | null {
  return windowStatuses(exitedOn, outcomes, now).find((w) => w.state === "due") ?? null;
}

/**
 * Windows that closed with nothing in them.
 *
 * Reported rather than queued. Every one of these is a measurement that cannot
 * be taken now — which is the running cost of having no clock, and the reason
 * it is worth showing rather than quietly dropping.
 */
export function missedWindows(
  exitedOn: string,
  outcomes: Outcome[],
  now: Date,
): WindowStatus[] {
  return windowStatuses(exitedOn, outcomes, now).filter((w) => w.state === "missed");
}
