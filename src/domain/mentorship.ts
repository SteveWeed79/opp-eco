/**
 * Mentorship — the relational experience, with none of the machinery.
 *
 * The other three tracks in this product all end in a transaction: a standard
 * internship is reimbursed, a micro project is invoiced, both are examined for
 * credit. Mentorship is the one an employer can say yes to on a Tuesday
 * afternoon, and it is deliberately modelled as the *absence* of everything
 * else — no wage, no hours, no board clearance, no credit.
 *
 * That is the whole design argument for a separate entity rather than a third
 * `Track`. A track is a shape of work an application flows through; every stage
 * of that flow — clearance, funding, timesheets, credit — is meaningless here,
 * and a mentorship pretending to be a posting would inherit all of it and have
 * to switch it off one guard at a time.
 *
 * It lives outside `lifecycle.ts` for the same reason: those three machines
 * gate the application machine, and this one gates nothing. Its whole
 * lifecycle is an employer saying whether they are currently able to take
 * anyone.
 */

import type {
  MentorshipFormat,
  MentorshipOffer,
  MentorshipOfferStatus,
  MentorshipPairing,
  MentorshipPairingStatus,
} from "./types";
import type { ActorRole } from "./types";
import { createMachine, type StateTransition } from "./machine";

// ---------------------------------------------------------------------------
// What "mentoring" means, concretely
// ---------------------------------------------------------------------------

/**
 * Four named formats rather than a free-text field.
 *
 * "We'd be happy to mentor students" is a sentiment; a college cannot make an
 * introduction out of it, and a student cannot tell whether it means a coffee
 * or a semester. Naming the formats also sets the size of the ask, which is
 * what actually decides whether a small employer says yes — an hour looking at
 * a portfolio is a different commitment from a standing monthly meeting, and
 * an employer who reads only the second one declines both.
 *
 * Ordered lightest first, so the cheapest commitment is the one a hesitant
 * employer sees at the top of the form.
 */
export const MENTORSHIP_FORMATS: {
  value: MentorshipFormat;
  label: string;
  /** The commitment, stated plainly enough to say yes or no to. */
  meta: string;
  description: string;
}[] = [
  {
    value: "portfolio_review",
    label: "Portfolio or résumé review",
    meta: "About an hour, once",
    description:
      "You look at a student's work or application materials and tell them what an employer in your industry actually sees. The smallest useful thing anyone here can offer.",
  },
  {
    value: "job_shadow",
    label: "Job shadow",
    meta: "Half a day on site",
    description:
      "A student spends part of a day watching how the work is really done. No task to complete and nothing to supervise.",
  },
  {
    value: "group_session",
    label: "Talk to a group",
    meta: "One session, several students",
    description:
      "A class visit, a panel, or a site tour arranged through the college. One commitment that reaches a whole cohort.",
  },
  {
    value: "one_to_one",
    label: "Ongoing one-to-one",
    meta: "Recurring, a term or more",
    description:
      "You meet a student regularly through a term. The largest commitment on this list and the one students ask for most.",
  },
];

const FORMAT_LABELS = new Map(MENTORSHIP_FORMATS.map((f) => [f.value, f.label]));

export function mentorshipFormatLabel(format: MentorshipFormat): string {
  return FORMAT_LABELS.get(format) ?? format;
}

/** Whether students in this market should be shown the offer. */
export function isOfferedToStudents(offer: MentorshipOffer): boolean {
  return offer.status === "open";
}

// ---------------------------------------------------------------------------
// The offer's lifecycle
// ---------------------------------------------------------------------------

/**
 * The employer owns this outright, which makes it the shortest machine here.
 *
 * There is no college review step, and that is a decision rather than an
 * omission. A posting is reviewed because review is what makes it
 * credit-bearing — the college is underwriting an academic claim. A mentorship
 * carries no credit, no wage, and no public money, so there is nothing for the
 * college to underwrite and a review queue in front of it would only slow down
 * the one offer an employer can make on impulse.
 *
 * What *does* gate it is organization vetting, checked where the offer is
 * created (`offerMentorship`). Mentorship puts an adult in front of a student
 * with no supervisor and no timesheet in between, so the "is this employer who
 * they say they are" check matters at least as much here as it does for a
 * placement.
 */
export interface MentorshipContext {
  offer: MentorshipOffer;
}

export type MentorshipTransition = StateTransition<
  MentorshipOfferStatus,
  MentorshipContext
>;

export const MENTORSHIP_TRANSITIONS: MentorshipTransition[] = [
  {
    // The honest answer to "not this term". Without it the only way to stop
    // being listed is to withdraw, and an employer who withdraws to get
    // through a busy quarter rarely comes back.
    from: "open",
    to: "paused",
    roles: ["business"],
    label: "Pause",
  },
  {
    from: "paused",
    to: "open",
    roles: ["business"],
    label: "Reopen",
  },
  {
    from: "open",
    to: "withdrawn",
    roles: ["business"],
    label: "Withdraw",
  },
  {
    from: "paused",
    to: "withdrawn",
    roles: ["business"],
    label: "Withdraw",
  },
];

export const mentorshipMachine = createMachine<
  MentorshipOfferStatus,
  MentorshipContext,
  MentorshipTransition
>({
  subject: "mentorship offer",
  transitions: MENTORSHIP_TRANSITIONS,
  statusOf: (ctx) => ctx.offer.status,
  marketIdOf: (ctx) => ctx.offer.marketId,
  ownership: (actor, ctx) =>
    actor.membership.role === "business" &&
    actor.membership.organizationId !== ctx.offer.businessId
      ? "That mentorship offer belongs to another organization"
      : null,
});

// ---------------------------------------------------------------------------
// The introduction
// ---------------------------------------------------------------------------

/**
 * Who may introduce a student to a mentor, and why it is nobody else.
 *
 * The college, because it is the local operator and already vouches for the
 * student; the administrator, because a market whose college has not acted is
 * exactly the case an operator exists to unstick. Deliberately **not** the
 * student, and not the employer: mentorship is the one form here with no
 * supervisor, no timesheet and no board interview between an adult and a
 * student, so the first contact runs through the party that knows both.
 *
 * That is the answer to the open question this file used to defer (Q22), and
 * the reason the college's mentor list was a list rather than a queue.
 */
export const INTRODUCERS: ActorRole[] = ["college", "admin"];

/**
 * Places on an offer that are not currently spoken for.
 *
 * `capacity` is what the employer said they could take at once, and only a
 * live introduction spends one. A pairing that has run its course — met, or
 * declined — gives the place back, because the alternative is an employer
 * whose declared capacity silently drains to zero over a year of successful
 * mentorships.
 */
export function placesLeft(
  offer: MentorshipOffer,
  pairings: MentorshipPairing[],
): number {
  const live = pairings.filter(
    (p) => p.offerId === offer.id && p.status === "introduced",
  ).length;
  return Math.max(0, offer.capacity - live);
}

/** Whether this offer can take another student right now. */
export function canIntroduceTo(
  offer: MentorshipOffer,
  pairings: MentorshipPairing[],
): boolean {
  return isOfferedToStudents(offer) && placesLeft(offer, pairings) > 0;
}

export interface PairingContext {
  pairing: MentorshipPairing;
}

export type PairingTransition = StateTransition<
  MentorshipPairingStatus,
  PairingContext
>;

/**
 * Two ways out of an introduction, and no way back into one.
 *
 * The employer owns both, because they are the only party who knows whether
 * the student turned up — but the college and the administrator can record it
 * too, since an introduction the employer never closes would otherwise hold a
 * place open forever. A new introduction is a new pairing rather than a
 * reopened one: the same student can be introduced to the same mentor twice,
 * and flattening those into one record loses the first.
 */
export const PAIRING_TRANSITIONS: PairingTransition[] = [
  {
    from: "introduced",
    to: "met",
    roles: ["business", "college", "admin"],
    label: "It happened",
  },
  {
    from: "introduced",
    to: "declined",
    roles: ["business", "college", "admin"],
    label: "It did not happen",
  },
];

export const pairingMachine = createMachine<
  MentorshipPairingStatus,
  PairingContext,
  PairingTransition
>({
  subject: "mentorship introduction",
  transitions: PAIRING_TRANSITIONS,
  statusOf: (ctx) => ctx.pairing.status,
  marketIdOf: (ctx) => ctx.pairing.marketId,
  ownership: (actor, ctx) =>
    actor.membership.role === "business" &&
    actor.membership.organizationId !== ctx.pairing.businessId
      ? "That introduction was made to another organization"
      : null,
});
