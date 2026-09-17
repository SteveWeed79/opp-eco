/**
 * What the host employer did at the end of a placement, and who may say so.
 *
 * The lifecycle already records that the work was done and the credit granted.
 * `Outcome` records where the learner went. This records the one fact neither
 * of them can hold, because only one party knows it: whether the employer who
 * supervised the placement offered to keep them.
 *
 * It is the cheapest high-value question in the product. The employer answers
 * about itself, in one click, on a screen it already visits — against a college
 * officer phoning fourteen people who have left town. And it is the *only*
 * source for the middle answer: a learner who turned down an offer knows it, an
 * employer knows it, and nobody else ever finds out.
 *
 * Three answers, and the middle one is why this exists rather than being a
 * boolean on `Outcome`. "We offered and they turned it down" and "we made no
 * offer" are opposite findings about a town — the first says the work is here
 * and something else won, the second says the work is not here. A programme
 * asking why rural graduates leave has to tell those apart.
 *
 * And a fourth state that is deliberately not an answer: **nobody has replied
 * yet**, which is the absence of a row. See `offerAwaitsAnswer`.
 */

import type { ActorRole, Application, HostOffer, HostOfferAnswer } from "./types";
import { hasExited } from "./outcome";

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/**
 * Ordered strongest first, like `OUTCOME_KINDS`, because the form is read top
 * to bottom by somebody who already knows the answer.
 *
 * The wording is deliberately the employer's rather than the platform's. An
 * employer answering "did the placement convert" is being asked to grade
 * itself; one answering "did you offer them a job" is being asked what
 * happened. The second gets answered.
 */
export const HOST_OFFER_ANSWERS: {
  value: HostOfferAnswer;
  label: string;
  meta: string;
  description: string;
}[] = [
  {
    value: "accepted",
    label: "We offered, and they took it",
    meta: "The strongest result this programme produces",
    description:
      "They work for you now. This is recorded as employment in this market without asking anybody for a county — you are an employer here, so where is already answered.",
  },
  {
    value: "declined",
    label: "We offered, and they turned it down",
    meta: "The work was here, and something else won",
    description:
      "Worth as much as a yes, and nobody else can tell us. An area losing people who had a local offer in hand has a different problem from one with no offers to make, and the two need different answers.",
  },
  {
    value: "none",
    label: "We made no offer",
    meta: "No headcount, wrong fit, wrong timing",
    description:
      "A normal outcome for an internship and not a failure. Recording it is what stops it being confused with the placements nobody got round to asking about.",
  },
];

const ANSWER_LABELS = new Map(HOST_OFFER_ANSWERS.map((a) => [a.value, a.label]));

export function hostOfferAnswerLabel(answer: HostOfferAnswer): string {
  return ANSWER_LABELS.get(answer) ?? answer;
}

/** Whether this answer means the host kept them, which is the figure that matters. */
export function isHire(answer: HostOfferAnswer): boolean {
  return answer === "accepted";
}

// ---------------------------------------------------------------------------
// Who may answer
// ---------------------------------------------------------------------------

/**
 * The employer, because it is the party the question is about — and the
 * administrator, because the whole point of the chase queue is that somebody
 * rings an employer who has not replied and writes down what they say.
 *
 * Not the college: it can tell you a learner is working somewhere, which is an
 * `Outcome`, but what an employer decided about its own headcount is not
 * something it observes. Not the learner either, for the narrower reason that
 * one party per question keeps the row unambiguous — a learner who did not get
 * an offer says so through their own outcome, where "still looking" means
 * exactly that.
 *
 * `source` records which of the two it was, so an answer given firsthand is
 * distinguishable from one an administrator transcribed. Both are the
 * employer's answer; only one of them is firsthand, and a report that cannot
 * see the difference cannot tell a working process from a chased one.
 */
export const HOST_OFFER_RECORDERS: ActorRole[] = ["business", "admin"];

export function canRecordHostOffer(role: ActorRole): boolean {
  return HOST_OFFER_RECORDERS.includes(role);
}

/**
 * There is no `HOST_OFFER_READERS` to match `OUTCOME_READERS`, and the absence
 * is the point rather than an omission.
 *
 * That list exists so a derived view can tell "no outcome exists" from "you may
 * not see one" — the employer reads no outcomes at all, so subtracting one list
 * from another would show it work already done as outstanding. Every role reads
 * host offers, narrowed to what concerns them, so the ambiguity never arises.
 * What differs is the *note*, stripped for the two roles with no business
 * reading an employer's candid sentence about a named person.
 */

// ---------------------------------------------------------------------------
// When one is owed
// ---------------------------------------------------------------------------

/**
 * The host's answer for this placement, or null if nobody has given one.
 *
 * One row per application by construction, and the repository enforces it: a
 * second answer would be an employer changing its mind, which is an edit rather
 * than a new observation. That is the opposite of `Outcome`, where a second row
 * is a second follow-up and both are kept — because "where are they now" has a
 * new answer every quarter and "did you offer them a job" does not.
 */
export function hostOfferFor(
  application: Application,
  offers: HostOffer[],
): HostOffer | null {
  return offers.find((o) => o.applicationId === application.id) ?? null;
}

/**
 * Whether this placement is still waiting on the employer.
 *
 * The same predicate as the follow-up queue — the placement ended, and nothing
 * has been recorded against it — applied to a different question. A placement
 * that ended early counts: "we made no offer, they left in week three" is a
 * real answer and the note is where the value is.
 *
 * **This is what stops silence being read as "no offer".** The absence of a row
 * is the absence of an answer, and it lands in the administrator's queue rather
 * than in the denominator of a conversion rate.
 */
export function offerAwaitsAnswer(
  application: Application,
  offers: HostOffer[],
): boolean {
  if (!hasExited(application)) return false;
  return hostOfferFor(application, offers) === null;
}

/** Why the question cannot be answered for this application yet, or null. */
export function offerBlockReason(application: Application): string | null {
  if (hasExited(application)) return null;
  return "This placement has not finished. The question is asked once it has.";
}

/**
 * Newest answer first, with the id breaking ties.
 *
 * The tiebreak is not decoration: two answers recorded in the same second
 * would otherwise come back in whatever order the store happened to yield, and
 * the parity suite compares the two backends element by element.
 */
export function byOfferOrder(a: HostOffer, b: HostOffer): number {
  return b.recordedOn.localeCompare(a.recordedOn) || a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------
// The count
// ---------------------------------------------------------------------------

export interface HostOfferSummary {
  /** Finished placements where the employer has said something. */
  answered: number;
  /**
   * Finished placements where nobody has. Reported beside the rate and never
   * inside it — an unworked queue is not an employer declining to hire.
   */
  unanswered: number;
  accepted: number;
  declined: number;
  none: number;
  /**
   * Offers accepted over placements *answered*, or null when nothing has been.
   *
   * Over answered rather than over finished, for the reason `regionalRate` is
   * over measured rather than over everyone who exited: dividing by the
   * placements nobody asked about would make an administrative backlog read as
   * employers who would not hire.
   */
  hireRate: number | null;
  /**
   * Offers made — accepted or not — over placements answered.
   *
   * The figure a town actually needs beside the hire rate. Two places with the
   * same hire rate and different offer rates have different problems, and only
   * one of them is about jobs.
   */
  offerRate: number | null;
}

export function summarizeHostOffers(
  applications: Application[],
  offers: HostOffer[],
): HostOfferSummary {
  const finished = applications.filter(hasExited);
  const answers = finished
    .map((a) => hostOfferFor(a, offers))
    .filter((o): o is HostOffer => o !== null);

  const count = (answer: HostOfferAnswer) =>
    answers.filter((o) => o.answer === answer).length;

  const accepted = count("accepted");
  const declined = count("declined");
  const answered = answers.length;

  return {
    answered,
    unanswered: finished.length - answered,
    accepted,
    declined,
    none: count("none"),
    hireRate: answered === 0 ? null : accepted / answered,
    offerRate: answered === 0 ? null : (accepted + declined) / answered,
  };
}
