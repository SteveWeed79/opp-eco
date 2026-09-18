/**
 * The micro track's unit of work, and the assessment hiding inside it.
 *
 * The story has said since its first draft that on the micro track "the student
 * submits the deliverable, the business accepts or requests revision, and
 * acceptance *is* the evaluation". Two thirds of that were already in the
 * model: `Application.deliverableSubmitted` guards the employer's *Accept
 * deliverable* transition, and `deliverableAccepted` decides whether the
 * posting's hours count toward a credit. Both were written only by the seed, so
 * the micro track had a gate nobody could open and a credit rule nothing could
 * satisfy.
 *
 * What this adds is the two write paths and the one thing the booleans cannot
 * hold — **the employer's words**. Acceptance being the evaluation means the
 * note is an academic record the college reads when it awards credit, not a
 * courtesy message, and a revision ask is the only instruction a learner gets
 * about what to do differently.
 *
 * Three decisions worth stating:
 *
 *  - **A round, not a second record.** A resubmission increments `round` on the
 *    same deliverable. "The third version" is a thing a college would want to
 *    see, and a chain of separate rows makes it a join rather than a number.
 *  - **The file is optional and the summary is not.** A micro deliverable is a
 *    brief, a spreadsheet, a mockup — or a link to a repository. Requiring a
 *    file would push the commonest case out of the system; requiring nothing
 *    would let somebody submit an empty hand-in and start the employer's clock.
 *  - **Submitting is not a status change.** The application stays
 *    `placement_active` until the employer accepts, because the work being
 *    handed in and the placement being finished are different facts, and the
 *    existing transition already draws that line.
 */

import type { Deliverable, DeliverableStatus } from "./types";

/** The shortest hand-in description worth showing an employer. */
export const MIN_SUMMARY = 12;

/** The shortest response worth sending back. */
export const MIN_RESPONSE = 8;

export const DELIVERABLE_STATUSES: {
  value: DeliverableStatus;
  label: string;
  /** What the party looking at it should do next. */
  meta: string;
}[] = [
  { value: "submitted", label: "Submitted", meta: "Waiting on the employer" },
  {
    value: "revision_requested",
    label: "Revision requested",
    meta: "Back with the learner",
  },
  { value: "accepted", label: "Accepted", meta: "This is the evaluation" },
];

const LABELS = new Map(DELIVERABLE_STATUSES.map((s) => [s.value, s.label]));

export function deliverableStatusLabel(status: DeliverableStatus): string {
  return LABELS.get(status) ?? status;
}

/** Waiting on somebody. */
export function isOpen(deliverable: Deliverable): boolean {
  return deliverable.status !== "accepted";
}

/** Waiting on the **employer** specifically — the queue that matters. */
export function awaitsEmployer(deliverable: Deliverable): boolean {
  return deliverable.status === "submitted";
}

/**
 * Oldest first, then the id.
 *
 * The same choice `byEscalationOrder` makes and for the same reason: this is a
 * queue somebody works through, and the hand-in that has waited longest is the
 * one to look at. Everywhere else in this codebase the newest row wins.
 */
export function byDeliverableOrder(a: Deliverable, b: Deliverable): number {
  return a.submittedOn.localeCompare(b.submittedOn) || a.id.localeCompare(b.id);
}

/** How long the employer has been sitting on this, in whole days. */
export function daysWaiting(deliverable: Deliverable, now: Date): number {
  if (!awaitsEmployer(deliverable)) return 0;
  const elapsed = now.getTime() - new Date(deliverable.submittedOn).getTime();
  return Math.max(0, Math.floor(elapsed / 86_400_000));
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/** Why this hand-in cannot be submitted, or null. */
export function submitBlockReason(input: {
  summary: string;
  /** The deliverable already on this application, if there is one. */
  existing: Deliverable | null;
}): string | null {
  const summary = input.summary.trim();
  if (!summary) return "Say what you are handing in.";
  if (summary.length < MIN_SUMMARY) {
    return "Say a little more — this is what the employer sees first.";
  }
  if (input.existing?.status === "accepted") {
    return "This work has already been accepted.";
  }
  if (input.existing?.status === "submitted") {
    // Not a duplicate to be silently ignored: the learner is waiting on an
    // answer and needs to be told that, rather than piling up rounds nobody
    // asked for.
    return "Your last hand-in is still with the employer.";
  }
  return null;
}

/** Why the employer cannot answer this way, or null. */
export function respondBlockReason(
  deliverable: Deliverable,
  to: Exclude<DeliverableStatus, "submitted">,
  response: string,
): string | null {
  if (deliverable.status === "accepted") return "That has already been accepted.";
  if (deliverable.status === "revision_requested") {
    return "That is already back with the learner.";
  }
  const note = response.trim();
  if (to === "revision_requested") {
    if (!note) return "Say what needs changing.";
    if (note.length < MIN_RESPONSE) {
      // A learner who gets "no" and nothing else cannot act on it, and in a
      // rural market the follow-up question costs a week.
      return "Say a little more — this is the only instruction they get.";
    }
  }
  if (to === "accepted" && !note) {
    // Acceptance is the evaluation. An empty one is the whole academic record
    // of a credit-bearing placement, and the college reads it.
    return "Say something about the work — this is the evaluation the college reads.";
  }
  return null;
}
