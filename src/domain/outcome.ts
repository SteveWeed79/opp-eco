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

import type {
  ActorRole,
  Application,
  ApplicationStatus,
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
 * quarter look good.
 */
export const OUTCOME_KINDS: {
  value: OutcomeKind;
  label: string;
  meta: string;
  description: string;
}[] = [
  {
    value: "employed_by_host",
    label: "Hired by the host employer",
    meta: "Counts as regional employment",
    description:
      "The employer who supervised the placement took them on. The strongest result this programme can produce, and the one an employer is asked to confirm.",
  },
  {
    value: "employed_in_region",
    label: "Employed in the region",
    meta: "Counts as regional employment",
    description:
      "Working for a different employer inside the market's counties. A different employer is not a worse result — the point is that the talent stayed.",
  },
  {
    value: "employed_elsewhere",
    label: "Employed outside the region",
    meta: "Employment, but not retention",
    description:
      "Working, and gone. Recorded plainly rather than folded into a general employment figure: a programme that reliably produces graduates who leave is a pipeline out of the county, and the board funding it should be able to see that.",
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

/**
 * The two values that mean "the talent stayed", which is the venture's own
 * measure and the one number a funder asks for at the end of year three.
 *
 * `employed_by_host` is regional by construction: the host is an employer in
 * this market, so a hire by them is a hire in the region. Stating it here
 * rather than at each call site is what stops one report counting it and
 * another not.
 */
export function isRegionalEmployment(kind: OutcomeKind): boolean {
  return kind === "employed_by_host" || kind === "employed_in_region";
}

/** Employment anywhere — regional or not. Separate, because both get reported. */
export function isEmployment(kind: OutcomeKind): boolean {
  return isRegionalEmployment(kind) || kind === "employed_elsewhere";
}

// ---------------------------------------------------------------------------
// Who may record one
// ---------------------------------------------------------------------------

/**
 * The college and the administrator, and for now nobody else.
 *
 * The college because follow-up is local-operator work and it already holds the
 * relationship that makes the call get answered; the administrator for the
 * reason they can do anything else here, which is that a market whose college
 * has not acted is what an operator exists to unstick.
 *
 * Two parties are **deliberately absent and are the open question** (Q23): the
 * learner, whose self-report is the most common source in real workforce
 * reporting, and the employer, who is the only party that actually knows it
 * hired someone. Both are better evidence than a college's second-hand note for
 * the outcomes they can speak to, and both want a surface and a rule about what
 * each may claim — an employer can attest `employed_by_host` and cannot possibly
 * know about `employed_elsewhere`. Adding them is a scoping decision rather than
 * a wiring job, so the narrow answer ships first.
 *
 * The board is absent for the reason it sees no introductions: it reimburses
 * placements. Where a learner works afterwards is the programme's measure, not
 * a condition of a claim it already paid.
 */
export const OUTCOME_RECORDERS: ActorRole[] = ["college", "admin"];

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
const NO_LONGER_RUNNING: ApplicationStatus[] = [
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
  const since = new Date(application.statusSince).getTime();
  return Math.max(0, Math.floor((now.getTime() - since) / 86_400_000));
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
 * Recording a *second* observation about the same experience later is supported
 * and expected. It is simply not something a work queue can prompt, since no
 * date makes the next follow-up due rather than merely possible.
 */
export function awaitsFollowUp(
  application: Application,
  outcomes: Outcome[],
): boolean {
  if (!hasExited(application)) return false;
  return !outcomes.some((o) => o.applicationId === application.id);
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
export function summarizeOutcomes(
  outcomes: Outcome[],
  unmeasured: number,
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

  const employed = current.filter((o) => isEmployment(o.kind)).length;
  const regional = current.filter((o) => isRegionalEmployment(o.kind)).length;

  return {
    measured: current.length,
    unmeasured,
    byKind,
    employed,
    regional,
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
