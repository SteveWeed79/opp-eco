/**
 * Escalation — the channel that goes around the other party.
 *
 * The user story has said since the first draft that "an escalation path exists
 * on both tracks — any party raises a problem, it routes to Admin," and nothing
 * implemented it. What stood in for it was the administrator's *What's stuck*
 * queue, which is derived from how long an application has sat in one status.
 * That queue is real and worth keeping, and it can only ever see a placement
 * that has gone **quiet**. A placement going wrong loudly — an employer with no
 * work to hand a learner, a learner whose supervisor has not appeared, a wage
 * claim nobody is answering — moves through its statuses on time and looks
 * healthy from every screen the platform has.
 *
 * Three decisions, all of which could have gone the other way:
 *
 *  - **It is not a workflow status.** See `Escalation` in `types.ts`. A
 *    placement in trouble is usually still running.
 *  - **Only the raiser and the administrator may read one.** Also in `types.ts`,
 *    and it is the decision the feature lives or dies on. A learner who knows
 *    the employer will read it reports nothing.
 *  - **The administrator cannot raise one on somebody's behalf and have it look
 *    the same.** They can record one — a phone call is how most of these will
 *    actually arrive in a rural market — and `raisedByRole` says it was the
 *    administrator who wrote it down. The distinction survives into reporting.
 */

import type { ActorRole, Escalation, EscalationKind, EscalationStatus } from "./types";

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

export const ESCALATION_KINDS: {
  value: EscalationKind;
  label: string;
  /** What a person would actually be reporting. Shown under the label. */
  description: string;
}[] = [
  {
    value: "safety",
    label: "Safety, harassment or discrimination",
    description:
      "Anything where somebody is at risk. Goes to the top of the administrator's queue ahead of everything else, and is the one kind worth raising before you are sure.",
  },
  {
    value: "pay",
    label: "Pay or reimbursement",
    description:
      "Not being paid, paid at the wrong rate, or a reimbursement claim nobody is answering.",
  },
  {
    value: "hours",
    label: "Hours or scheduling",
    description:
      "Hours not being approved, shifts that clash with classes, or far more or fewer hours than the posting described.",
  },
  {
    value: "supervision",
    label: "Supervision or the work itself",
    description:
      "No supervisor present, no work to do, or work that has nothing to do with what was posted.",
  },
  {
    value: "academic",
    label: "Credit at risk",
    description:
      "Anything that threatens the academic side — coursework clashes, a placement that will not reach the hours a credit needs, an evaluation that is not coming.",
  },
  {
    value: "other",
    label: "Something else",
    description: "Anything that does not fit above. Say as much as you can in the description.",
  },
];

const KIND_LABELS = new Map(ESCALATION_KINDS.map((k) => [k.value, k.label]));

export function escalationKindLabel(kind: EscalationKind): string {
  return KIND_LABELS.get(kind) ?? kind;
}

/**
 * Sort weight, matching the Postgres enum's declaration order.
 *
 * The in-memory layer has no enum to sort by, so the order lives here once and
 * both layers read it. The parity suite compares these row for row.
 */
const KIND_ORDER = new Map(ESCALATION_KINDS.map((k, index) => [k.value, index]));

export const ESCALATION_STATUSES: { value: EscalationStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "acknowledged", label: "Being looked at" },
  { value: "resolved", label: "Resolved" },
  { value: "withdrawn", label: "Withdrawn" },
];

/** Still somebody's to deal with. */
export function isLive(escalation: Escalation): boolean {
  return escalation.status === "open" || escalation.status === "acknowledged";
}

/**
 * Worst kind first, then oldest first, then the id.
 *
 * Oldest first within a kind is the opposite of every other list in this
 * codebase, and deliberate: everywhere else the newest row is the interesting
 * one, and here the oldest unanswered problem is the one that has been waiting
 * longest for somebody to care about it.
 */
export function byEscalationOrder(a: Escalation, b: Escalation): number {
  const kind = (KIND_ORDER.get(a.kind) ?? 99) - (KIND_ORDER.get(b.kind) ?? 99);
  if (kind !== 0) return kind;
  return a.raisedOn.localeCompare(b.raisedOn) || a.id.localeCompare(b.id);
}

/** How long this has gone unanswered, in whole days. */
export function daysWaiting(escalation: Escalation, now: Date): number {
  const since = escalation.acknowledgedOn ?? escalation.raisedOn;
  const elapsed = now.getTime() - new Date(since).getTime();
  return Math.max(0, Math.floor(elapsed / 86_400_000));
}

// ---------------------------------------------------------------------------
// Who may do what
// ---------------------------------------------------------------------------

/**
 * **There is deliberately no `canRaise`.** Every role may raise one, which is
 * the story's "any party raises a problem" and the reason the channel is worth
 * having — a predicate here would be a function returning true, and the next
 * person to touch it would be tempted to give it an opinion. The check that
 * does exist is about the *placement* rather than the role: an actor naming an
 * application they cannot see is refused by `applications.find` before the
 * service forms a view.
 *
 * Only the administrator picks one up or closes it.
 *
 * The story routes escalations to Admin and this is that sentence in code. It
 * also follows from the visibility rule: nobody else can read one, so nobody
 * else could act on it.
 */
export function canResolve(role: ActorRole): boolean {
  return role === "admin";
}

/** The raiser withdraws their own, and only while it is still live. */
export function canWithdraw(escalation: Escalation, userId: string): boolean {
  return escalation.raisedByUserId === userId && isLive(escalation);
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/** The shortest description worth sending to somebody who has to act on it. */
export const MIN_SUMMARY = 12;

/** Why this problem cannot be raised as described, or null. */
export function raiseBlockReason(input: { summary: string }): string | null {
  const summary = input.summary.trim();
  if (!summary) return "Say what has gone wrong.";
  if (summary.length < MIN_SUMMARY) {
    // A administrator receiving "bad" can do nothing with it but ring back and
    // ask, which in a rural market is a week. The floor is low enough that
    // anybody with a real problem clears it without noticing.
    return "Say a little more — whoever picks this up has only what you write here.";
  }
  return null;
}

/** Why this escalation cannot move to that status, or null. */
export function transitionBlockReason(
  escalation: Escalation,
  to: EscalationStatus,
  resolution: string | null,
): string | null {
  if (escalation.status === to) return "It is already in that state.";
  if (!isLive(escalation)) return "That has already been closed.";
  if (to === "open") return "An escalation cannot be reopened; raise a new one.";
  if (to === "resolved" && !resolution?.trim()) {
    // The same rule mentorship closing follows: "resolved" with no account of
    // what was done is the platform's only record that anything happened, and
    // an empty one tells the next person nothing.
    return "Say what was done about it.";
  }
  return null;
}
