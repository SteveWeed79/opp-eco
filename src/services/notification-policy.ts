/**
 * Who hears about what.
 *
 * One table, keyed by the status an application reaches, saying which parties
 * are told and what each is told. It is the notification counterpart of the
 * transition table: `workflow.ts` decides what may happen, this decides who
 * finds out, and neither is spread across call sites.
 *
 * Written this way because the alternative — each action hand-writing its own
 * recipients — is how a lifecycle ends up with messages for the interesting
 * steps and silence for the rest. Booking an interview notified two parties;
 * being declined notified nobody, and a student sat waiting on a decision that
 * had already been made.
 *
 * **The audience is the point.** A student needs to know what to do next; an
 * employer needs to know a candidate moved; a board needs to know work is
 * queued for it; the administrator needs to know when nothing is happening.
 * The same event says different things to each, so recipients carry their own
 * template rather than sharing one.
 */

import type {
  Application,
  ApplicationStatus,
  Market,
  Organization,
  Posting,
  Student,
} from "@/domain/types";
import type { NotificationIntent } from "@/data/store";

/** The parties an application can concern. */
export type Party = "student" | "employer" | "college" | "board" | "admin";

interface PolicyEntry {
  party: Party;
  kind: string;
  /**
   * Skip when this returns true. Used where a status means different things on
   * the two tracks — a micro placement has no board to tell.
   */
  unless?: (context: PolicyContext) => boolean;
}

export interface PolicyContext {
  application: Application;
  posting: Posting;
  student: Student;
  market: Market;
  /** The college that owns this student's credit, if resolvable. */
  college: Organization | null;
  /** The employer that owns the posting. */
  employer: Organization | null;
  /** The workforce board for this market. */
  board: Organization | null;
}

const isMicro = (c: PolicyContext) => c.application.track === "micro";

/**
 * The table.
 *
 * A status with no entry notifies nobody, which is a decision rather than an
 * omission: `under_review` is an employer's private bookkeeping, and telling a
 * student "someone opened your application" trains them to ignore mail from
 * this system.
 */
const POLICY: Partial<Record<ApplicationStatus, PolicyEntry[]>> = {
  submitted: [
    { party: "student", kind: "application.submitted.student" },
    { party: "employer", kind: "application.submitted" },
  ],

  shortlisted: [
    // The student now has to act, and this is the first point where silence
    // costs a placement.
    { party: "student", kind: "application.shortlisted.student" },
  ],

  mutual_interest: [
    // The pause. On the standard track this is where placements die, so the
    // student is told to book and the board is told to expect them.
    { party: "student", kind: "mutual_interest.student" },
    { party: "employer", kind: "mutual_interest.employer" },
    { party: "board", kind: "mutual_interest.board", unless: isMicro },
  ],

  interview_scheduled: [
    { party: "student", kind: "interview.booked.student" },
    { party: "board", kind: "interview.booked.board" },
    { party: "employer", kind: "interview.booked.employer" },
  ],

  cleared: [
    { party: "student", kind: "clearance.granted.student" },
    { party: "employer", kind: "clearance.granted.employer" },
  ],

  unsubsidized: [
    // A real outcome, not a failure: the placement can still happen, just
    // without the subsidy. Both sides need to know before anyone plans around
    // money that is not coming.
    { party: "student", kind: "clearance.declined.student" },
    { party: "employer", kind: "clearance.declined.employer" },
  ],

  funding_authorized: [
    { party: "employer", kind: "funding.authorized" },
    { party: "student", kind: "funding.authorized.student" },
  ],

  placement_active: [
    { party: "student", kind: "placement.started.student" },
    { party: "college", kind: "placement.started.college" },
  ],

  placement_completed: [
    { party: "student", kind: "placement.completed.student" },
    { party: "college", kind: "placement.completed.college" },
  ],

  credit_pending: [{ party: "college", kind: "credit.pending.college" }],

  credit_granted: [
    { party: "student", kind: "credit.granted" },
    { party: "employer", kind: "credit.granted.employer" },
  ],

  credit_denied: [{ party: "student", kind: "credit.denied.student" }],

  rejected: [{ party: "student", kind: "application.rejected.student" }],

  terminated_early: [
    { party: "student", kind: "placement.terminated.student" },
    { party: "college", kind: "placement.terminated.college" },
    // The board committed money against this placement and has to release it.
    { party: "board", kind: "placement.terminated.board", unless: isMicro },
  ],

  // `withdrawn` tells the employer their candidate is gone; the student did it
  // themselves and does not need telling.
  withdrawn: [{ party: "employer", kind: "application.withdrawn.employer" }],
};

/**
 * A recipient address for a party.
 *
 * Users win where they exist; organizations fall back to their published
 * contact, because an employer is reachable long before anyone there has an
 * account. Returning null drops the message loudly in the outbox rather than
 * guessing at a recipient.
 */
function addressee(
  party: Party,
  context: PolicyContext,
): { recipientUserId: string; recipientOrganizationId?: string } | null {
  switch (party) {
    case "student":
      return { recipientUserId: context.student.userId };
    case "employer":
      return context.employer
        ? {
            recipientUserId: `contact:${context.employer.id}`,
            recipientOrganizationId: context.employer.id,
          }
        : null;
    case "college":
      return context.college
        ? {
            recipientUserId: `contact:${context.college.id}`,
            recipientOrganizationId: context.college.id,
          }
        : null;
    case "board":
      return context.board
        ? {
            recipientUserId: `contact:${context.board.id}`,
            recipientOrganizationId: context.board.id,
          }
        : null;
    case "admin":
      return { recipientUserId: "u-admin" };
  }
}

/**
 * The messages a transition into `status` should produce.
 *
 * Every recipient gets the same payload; templates pick what they need from
 * it. Keeping one payload shape means adding a field to a message is a
 * template change rather than a policy change.
 */
export function notificationsFor(
  status: ApplicationStatus,
  context: PolicyContext,
): Omit<NotificationIntent, "marketId">[] {
  const entries = POLICY[status] ?? [];

  const payload = {
    studentName: context.student.name,
    postingTitle: context.posting.title,
    employerName: context.employer?.name ?? "the employer",
    collegeName: context.college?.name ?? "your college",
    boardName: context.board?.name ?? "the workforce board",
    track: context.application.track,
    applicationId: context.application.id,
    hours: context.application.fundingAuthorizedHours,
    rate: context.application.fundingAuthorizedRate,
    ratePerHour: context.market.subsidyRatePerHour,
    creditHours: context.posting.creditHours,
    deliverable: context.posting.deliverable,
  };

  const intents: Omit<NotificationIntent, "marketId">[] = [];
  for (const entry of entries) {
    if (entry.unless?.(context)) continue;
    const to = addressee(entry.party, context);
    if (!to) continue;
    intents.push({ ...to, kind: entry.kind, payload });
  }
  return intents;
}

/** Exposed for tests and for documenting coverage. */
export function partiesNotifiedOn(status: ApplicationStatus): Party[] {
  return (POLICY[status] ?? []).map((entry) => entry.party);
}

/**
 * Every message kind this table can emit.
 *
 * Checked against the template registry in tests: a policy entry naming a kind
 * with no template renders nothing and lands in the outbox as undeliverable —
 * a silent hole in exactly the lifecycle this table exists to cover.
 */
export function policyKinds(): string[] {
  return Object.values(POLICY)
    .flat()
    .filter((entry): entry is PolicyEntry => Boolean(entry))
    .map((entry) => entry.kind);
}
