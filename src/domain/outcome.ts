/**
 * Outcomes — what happened after the experience ended.
 *
 * Every other machine in this product measures whether a placement *worked*:
 * the hours were approved, the credit was granted, the board's money bought
 * what it was committed to. None of them measures whether the venture worked.
 * The claim this platform makes to a funder is narrower and harder — that a
 * learner who takes part is more likely to end up working in their own region —
 * and until this file existed there was nowhere to put the answer.
 *
 * It is deliberately not a state machine. An outcome has no status, no version
 * and no transitions, because it is an **observation** rather than a record
 * that moves: employment measured three months after a placement and again a
 * year later are two facts, not an edit of the first. That is also why nothing
 * here supersedes anything — the follow-up history is the evidence, and a model
 * that overwrote it would answer "where are they now" while destroying "what
 * did this programme change".
 *
 * The one thing it shares with the rest of the domain is that absence is never
 * inferred. A learner nobody followed up with has no row, and no query here
 * counts a missing row as a result of any kind.
 */

import { windowDueNow, windowStatuses, type WindowStatus } from "./window";
import type {
  ActorRole,
  Application,
  ApplicationStatus,
  Market,
  Outcome,
  OutcomeKind,
} from "./types";

// ---------------------------------------------------------------------------
// What can be recorded
// ---------------------------------------------------------------------------

/**
 * The six answers, ordered best-outcome-first, which is the order the venture
 * argues about them in and the order a follow-up form should offer them.
 *
 * `meta` is the reporting line — what this value means when it reaches a board
 * or a funder — because the whole hazard of an outcome taxonomy is a well-meant
 * officer filing "she got a job in Joplin" under the value that makes the
 * quarter look good. That hazard is now largely designed out: the officer names
 * the county and the platform decides what it counts as.
 */
export const OUTCOME_KINDS: {
  value: OutcomeKind;
  label: string;
  meta: string;
  description: string;
}[] = [
  {
    value: "employed",
    label: "Employed",
    meta: "Where they went decides whether it counts as retention",
    description:
      "Working. Whether that counts as the talent staying is derived from the county recorded against it, not chosen here — which is what stops one college counting a job in Joplin as regional and another not.",
  },
  {
    value: "continued_education",
    label: "Continued in education",
    meta: "A positive outcome, not employment",
    description:
      "Transferred, enrolled in a further programme, or still studying. Not a failure to find work, and not counted as employment either.",
  },
  {
    value: "entered_training",
    label: "Entered training or an apprenticeship",
    meta: "A positive outcome, not employment",
    description:
      "A registered apprenticeship, a certification programme, or workforce training. The phase-3 path the vision names, recordable before it is buildable.",
  },
  {
    value: "still_seeking",
    label: "Still looking",
    meta: "A recorded result, not a blank",
    description:
      "They were asked and have not landed anywhere yet. Deliberately a value rather than an empty queue slot — a learner nobody followed up with is a different fact, and it has no row at all.",
  },
];

const KIND_LABELS = new Map(OUTCOME_KINDS.map((k) => [k.value, k.label]));

export function outcomeKindLabel(kind: OutcomeKind): string {
  return KIND_LABELS.get(kind) ?? kind;
}

/** Employment anywhere — regional or not. Separate, because both get reported. */
export function isEmployment(kind: OutcomeKind): boolean {
  return kind === "employed";
}

/**
 * Whether a captured place is inside a market's region.
 *
 * Both parts compared, and the state is the load-bearing one: Kansas and
 * Missouri each have a Jackson County, and Pittsburg is twenty miles from
 * Joplin across the line. A county-name match alone would score a job in
 * Missouri as staying.
 */
export function placeInRegion(
  county: string,
  state: string,
  market: Pick<Market, "counties" | "state">,
): boolean {
  if (state.trim().toUpperCase() !== market.state.trim().toUpperCase()) return false;
  const named = county.trim().toLowerCase();
  return market.counties.some((c) => c.trim().toLowerCase() === named);
}

/**
 * Did the talent stay — the venture's own measure, and the one number a funder
 * asks for at the end of year three.
 *
 * **Derived, never stored.** The recorder names a county; this decides what it
 * counts as, against boundaries the market declares. That is the difference
 * between a figure two colleges compute the same way and one they do not.
 *
 * Three answers rather than two, and the third is the honest one:
 *
 *  - `true` / `false` where a place was captured, or where a pre-county row
 *    carried an explicit judgement that is still worth honouring
 *  - **`null` where nobody knows** — an employment outcome with no place on it.
 *    Not folded into `false`, because "we did not capture where they went" and
 *    "they left" are different facts and a rate that confuses them understates
 *    retention by exactly the size of the gap in the follow-up process
 *
 * A hire by the host employer is regional by construction — the host is an
 * employer in this market — so it needs no county to be answered.
 */
export function inRegion(
  outcome: Outcome,
  market: Pick<Market, "counties" | "state">,
): boolean | null {
  if (!isEmployment(outcome.kind)) return null;
  if (outcome.employedByHost) return true;
  if (outcome.employmentCounty && outcome.employmentState) {
    return placeInRegion(outcome.employmentCounty, outcome.employmentState, market);
  }
  return outcome.assertedInRegion;
}

// ---------------------------------------------------------------------------
// Who may record one
// ---------------------------------------------------------------------------

/**
 * The college, the administrator, and the learner about themselves.
 *
 * The college because follow-up is local-operator work and it already holds the
 * relationship that makes the call get answered; the administrator for the
 * reason they can do anything else here, which is that a market whose college
 * has not acted is what an operator exists to unstick.
 *
 * **The learner is here now**, and the bound on them is the whole of why it is
 * safe: a learner may record about their own record and no other, which
 * `recordOutcome` enforces and `studentScope` makes unreachable anyway. This is
 * their own disclosure about their own life — the same seam the consent model
 * already draws between what a student enters and what an institution verifies
 * — and self-report is the commonest source in real workforce reporting for the
 * plain reason that a college phoning fourteen people who have left town is the
 * bottleneck.
 *
 * What that buys comes with a bias that runs one way: people who landed a good
 * job answer, and people who did not go quiet. `source` keeps a self-report
 * distinguishable from a college's verified note, `unmeasured` keeps the size
 * of the silence visible, and the administrator's chase queue is what turns
 * silence into a phone call rather than a gap in a chart.
 *
 * The **employer is deliberately still absent from this list**, and that is not
 * an omission. It answers the one question it can speak to through `HostOffer`,
 * which records what it decided about its own headcount; an accepted offer
 * writes the outcome from there. What an employer cannot do is file an outcome
 * directly, because everything else an outcome can say — continued education,
 * still looking, a job somewhere else — is hearsay from where it sits.
 *
 * The board is absent for the reason it sees no introductions: it reimburses
 * placements. Where a learner works afterwards is the programme's measure, not
 * a condition of a claim it already paid.
 */
export const OUTCOME_RECORDERS: ActorRole[] = ["college", "admin", "student"];

export function canRecordOutcome(role: ActorRole): boolean {
  return OUTCOME_RECORDERS.includes(role);
}

/**
 * Roles that can read a follow-up observation at all.
 *
 * The mirror of the repository's scoping rule, stated in the domain because
 * anything *derived* from outcomes has to know the difference between "no
 * outcome exists" and "you are not allowed to see one". They are the same empty
 * array, and they must not produce the same answer.
 *
 * The bug this exists to prevent is concrete. An employer may read the
 * applications against its own postings and may read no outcomes, so a
 * follow-up queue built by subtracting one list from the other would show every
 * placement it hosted as unmeasured — work already done, presented as
 * outstanding, with no way for the employer to discover otherwise. The board is
 * the case that shows this is not simply "who owns the data": it reads every
 * outcome in its market, redacted, so its counts must match the college's
 * exactly.
 */
export const OUTCOME_READERS: ActorRole[] = ["admin", "college", "board", "student"];

export function canReadOutcomes(role: ActorRole): boolean {
  return OUTCOME_READERS.includes(role);
}

// ---------------------------------------------------------------------------
// When a follow-up is due
// ---------------------------------------------------------------------------

/**
 * Statuses that mean the learner actually started the work.
 *
 * An application that was rejected at submission has no outcome to measure —
 * nothing happened to follow up on — and putting it in the queue would bury the
 * placements that did happen under everything that never did.
 */
const REACHED_PLACEMENT: ApplicationStatus[] = [
  "placement_active",
  "placement_completed",
  "terminated_early",
  "credit_pending",
  "credit_granted",
  "credit_denied",
];

/**
 * Statuses that mean the work is over, however it ended.
 *
 * `terminated_early` belongs here and is not an exclusion: a learner whose
 * placement ended early is the one whose next step matters most, and a
 * follow-up process that quietly drops them reports only on its successes.
 */
export const NO_LONGER_RUNNING: ApplicationStatus[] = [
  "placement_completed",
  "terminated_early",
  "credit_pending",
  "credit_granted",
  "credit_denied",
  "closed",
];

/**
 * Whether the learner has finished this experience, so an outcome can be
 * recorded against it.
 *
 * Both halves are required. `furthestStatus` answers "did they ever start",
 * which `closed` erases on its own — the same reason the funnel counts by
 * furthest status — and the current status answers "have they finished".
 */
export function hasExited(application: Application): boolean {
  const furthest = application.furthestStatus ?? application.status;
  const started =
    REACHED_PLACEMENT.includes(furthest) ||
    REACHED_PLACEMENT.includes(application.status);
  return started && NO_LONGER_RUNNING.includes(application.status);
}

/**
 * Why an outcome cannot be recorded against this application, or null.
 *
 * Returns the sentence shown to the caller rather than a boolean, on the same
 * argument the override refusals make: a guard that declines without naming
 * itself asks someone to justify a decision the product would not describe.
 */
export function followUpBlockReason(application: Application): string | null {
  if (hasExited(application)) return null;
  const furthest = application.furthestStatus ?? application.status;
  if (!REACHED_PLACEMENT.includes(furthest) && !REACHED_PLACEMENT.includes(application.status)) {
    return "This application never reached a placement, so there is no experience to follow up on.";
  }
  return "This placement is still running. Record an outcome once it has finished.";
}

/**
 * Days since the experience ended, which is what the follow-up queue sorts by.
 *
 * `statusSince` stands in for the exit date. It is exact for a placement that
 * went straight to its terminal status and approximate for one that moved again
 * afterwards; a production build would read the audit log for the moment the
 * placement itself closed. Named here rather than inlined so there is one place
 * to make that exact.
 */
export function daysSinceExit(application: Application, now: Date): number {
  const since = new Date(exitDateOf(application)).getTime();
  return Math.max(0, Math.floor((now.getTime() - since) / 86_400_000));
}

/**
 * When the placement ended, for anything that measures from it.
 *
 * `exitedOn` when the row has one, and `statusSince` as the fallback for rows
 * written before the column existed and never migrated. The fallback is the old
 * approximation and is wrong by however long the application kept moving after
 * the work stopped — kept anyway, because a follow-up clock that returns
 * nothing for an un-backfilled row is worse than one that returns a date a
 * little late, and the backfill in migration 0016 makes it unreachable in
 * practice.
 */
export function exitDateOf(application: Application): string {
  return application.exitedOn ?? application.statusSince;
}

/**
 * Whether this application still needs a follow-up.
 *
 * Per **experience**, not per learner: a learner who finished two placements
 * gets asked about each, because the whole point of hanging the record off an
 * application is being able to say which experience produced which result. An
 * outcome recorded against one of them says nothing about the other.
 *
 * That is deliberately the opposite of how `summarizeOutcomes` counts, which is
 * once per learner — a queue that nags is better than a queue that forgets,
 * and a report that double-counts is just wrong.
 *
 * **No longer one-shot.** This used to be "has anything at all been recorded
 * against this placement", which cleared a learner from the queue forever the
 * first time anybody asked — and the comment here used to say a second
 * observation "is simply not something a work queue can prompt, since no date
 * makes the next follow-up due rather than merely possible".
 *
 * There is now a date. `window.ts` puts two of them on every placement, at the
 * 2nd and 4th calendar quarter after it ended, so a placement re-enters this
 * queue when its next window opens and leaves again when that window is
 * answered. A window that closed unanswered does **not** come back: nobody can
 * be phoned in February and asked where they were last August with any
 * confidence, and a queue offering impossible work teaches its operator to
 * ignore the queue. Those are reported as missed instead.
 */
export function awaitsFollowUp(
  application: Application,
  outcomes: Outcome[],
  now: Date,
): boolean {
  return followUpWindowDue(application, outcomes, now) !== null;
}

/** This placement's windows and where each stands, or none if it has not ended. */
export function followUpWindowsFor(
  application: Application,
  outcomes: Outcome[],
  now: Date,
): WindowStatus[] {
  if (!hasExited(application)) return [];
  return windowStatuses(
    exitDateOf(application),
    outcomes.filter((o) => o.applicationId === application.id),
    now,
  );
}

/** The window to ask about now, or null when nothing is open and unanswered. */
export function followUpWindowDue(
  application: Application,
  outcomes: Outcome[],
  now: Date,
): WindowStatus | null {
  if (!hasExited(application)) return null;
  return windowDueNow(
    exitDateOf(application),
    outcomes.filter((o) => o.applicationId === application.id),
    now,
  );
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export interface OutcomeSummary {
  /** Learners with at least one outcome on record. */
  measured: number;
  /** Exited placements with nothing recorded against them. */
  unmeasured: number;
  byKind: { kind: OutcomeKind; label: string; count: number }[];
  employed: number;
  regional: number;
  /**
   * Employment outcomes carrying no place at all.
   *
   * Its own number because it is a process failure rather than a result: it
   * means somebody recorded a job and not where it was. Rolling it into
   * "not regional" would make an incomplete follow-up look like talent leaving.
   */
  placeUnknown: number;
  /**
   * Regional employment as a share of *measured* learners, or null when nothing
   * has been measured.
   *
   * Over measured rather than over everyone who exited, and null rather than
   * zero, because both alternatives report a follow-up nobody has done as a bad
   * result. An unworked queue is a process failure, not a programme failure, and
   * `unmeasured` is what says so.
   */
  regionalRate: number | null;
}

/**
 * Counts one observation per learner — the most recent — rather than one per
 * row.
 *
 * A learner followed up twice is one learner, and summing rows would let a
 * diligent officer inflate the denominator by doing their job. Most recent
 * rather than first because "where are they now" is the question being asked;
 * `observedOn` decides it, with `recordedOn` breaking ties, since two
 * observations of the same date differ only by which was entered later.
 */
/**
 * The region an outcome is measured against, looked up by market.
 *
 * A lookup rather than one market, because the administrator reads every market
 * at once and a learner who stayed in Ellis County stayed with respect to the
 * Hays market and nowhere else. Summarising a cross-market set against a single
 * region would score most of it as having left.
 *
 * Returning null for a market that cannot be resolved is deliberate: the
 * outcome then has no region to be judged against, which lands in
 * `placeUnknown` rather than silently counting as leaving.
 */
export type RegionLookup = (
  marketId: string,
) => Pick<Market, "counties" | "state"> | null;

export function summarizeOutcomes(
  outcomes: Outcome[],
  unmeasured: number,
  regionFor: RegionLookup,
): OutcomeSummary {
  const latest = new Map<string, Outcome>();
  for (const outcome of outcomes) {
    const held = latest.get(outcome.studentId);
    if (!held || compareObservations(outcome, held) > 0) {
      latest.set(outcome.studentId, outcome);
    }
  }

  const current = [...latest.values()];
  const byKind = OUTCOME_KINDS.map(({ value, label }) => ({
    kind: value,
    label,
    count: current.filter((o) => o.kind === value).length,
  }));

  const stayed = (o: Outcome): boolean | null => {
    const region = regionFor(o.marketId);
    return region ? inRegion(o, region) : null;
  };

  const employed = current.filter((o) => isEmployment(o.kind)).length;
  const regional = current.filter((o) => stayed(o) === true).length;
  // Employment whose place was never captured. Counted and reported rather
  // than silently scored as leaving, because the two are different facts and
  // folding them together understates retention by the size of the gap.
  const placeUnknown = current.filter(
    (o) => isEmployment(o.kind) && stayed(o) === null,
  ).length;

  return {
    measured: current.length,
    unmeasured,
    byKind,
    employed,
    regional,
    placeUnknown,
    regionalRate: current.length === 0 ? null : regional / current.length,
  };
}

function compareObservations(a: Outcome, b: Outcome): number {
  return a.observedOn.localeCompare(b.observedOn) || a.recordedOn.localeCompare(b.recordedOn);
}

/**
 * Most recently observed first, with the id as the final tie-break.
 *
 * Both data layers sort with this, and the id tie-break is why: two follow-ups
 * carrying the same pair of dates would otherwise come back in whatever order
 * the array or the database happened to hold them, and the parity test that
 * compares the two layers row by row would fail on a difference that means
 * nothing.
 */
export function byObservedDescending(a: Outcome, b: Outcome): number {
  return compareObservations(b, a) || a.id.localeCompare(b.id);
}
