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
} from "./types";
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
