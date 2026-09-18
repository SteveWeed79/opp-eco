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
  User,
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
  /**
   * Everybody holding the administrator role.
   *
   * Passed in already resolved, like the three organizations above and for the
   * same reason: the unit of work is a synchronous callback, so every read a
   * notification needs has to be in hand before the transaction opens.
   *
   * A **list**, unlike every other party here, because administrators are the
   * one role without a market — there is no single "the administrator of this
   * placement" to resolve, and an entry addressed to them fans out to all of
   * them. See `addressee`.
   */
  administrators: User[];
  /**
   * What the board pays per hour here, from the market's wage-subsidy fund.
   *
   * Passed in rather than read off the market, which no longer carries a rate:
   * the figure lives on the fund now, and a message quoting it must quote the
   * one actually in force rather than a copy that drifted.
   *
   * Zero where a market has no wage fund yet. The messages that use it are all
   * about a funded placement, which cannot exist in that market.
   */
  wageRatePerHour: number;
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
    // Budget stewardship. A board declining funding is the signal that the
    // allocation is running down or that this learner did not qualify, and
    // deciding what happens as the pot empties is the administrator's job
    // rather than something either party above can act on.
    { party: "admin", kind: "clearance.declined.admin" },
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
    // The board paid for this and was never told it finished. Completion is
    // the outcome it reports upward, and it already hears about the two ways a
    // placement goes wrong — mutual interest stalling, and early termination —
    // so being silent about the way it goes right left its picture skewed.
    { party: "board", kind: "placement.completed.board", unless: isMicro },
  ],

  credit_pending: [{ party: "college", kind: "credit.pending.college" }],

  credit_granted: [
    { party: "student", kind: "credit.granted" },
    { party: "employer", kind: "credit.granted.employer" },
  ],

  credit_denied: [
    { party: "student", kind: "credit.denied.student" },
    // The programme's central promise failing for one learner. Rare enough
    // that each one is a story worth an administrator reading rather than a
    // figure in a report.
    { party: "admin", kind: "credit.denied.admin" },
  ],

  rejected: [
    { party: "student", kind: "application.rejected.student" },
    // The college advises this learner and could not see this at all. One
    // rejection is nothing; three is a conversation about the profile, and
    // only the party holding the whole pattern can have it.
    { party: "college", kind: "application.rejected.college" },
  ],

  terminated_early: [
    { party: "student", kind: "placement.terminated.student" },
    { party: "college", kind: "placement.terminated.college" },
    // The board committed money against this placement and has to release it.
    { party: "board", kind: "placement.terminated.board", unless: isMicro },
    // The clearest failure the system produces, and intervention is the
    // administrator's job. Three parties were told and the operator was not.
    { party: "admin", kind: "placement.terminated.admin" },
  ],

  // `withdrawn` tells the employer their candidate is gone; the student did it
  // themselves and does not need telling.
  withdrawn: [
    { party: "employer", kind: "application.withdrawn.employer" },
    // A learner pulling out usually means something the college can fix — a
    // timetable clash, a transport problem, cold feet about a placement nobody
    // talked them through. Silence here is how that stays invisible.
    { party: "college", kind: "application.withdrawn.college" },
  ],
};

/**
 * A recipient address for a party.
 *
 * Users win where they exist; organizations fall back to their published
 * contact, because an employer is reachable long before anyone there has an
 * account. Returning null drops the message loudly in the outbox rather than
 * guessing at a recipient.
 */
/**
 * The addresses for a party — plural, because one of them is.
 *
 * **This returned a single recipient, and `admin` resolved to the literal
 * `"u-admin"`.** That is a seed fixture inside a service: on the demonstration
 * it happens to be a real user, and on any other deployment it resolves to
 * nothing, so `addressFor` would drop the message — into the outbox, which is
 * the place nobody checks. It never fired only because no entry in the table
 * used the party. The first one added would have failed silently, which is the
 * failure mode this codebase treats most seriously.
 *
 * It is a list now because administrators are the one role the schema forbids a
 * market on, so "the administrator for this placement" does not exist. The
 * other four parties return exactly one address as before.
 */
function addressees(
  party: Party,
  context: PolicyContext,
): { recipientUserId: string; recipientOrganizationId?: string }[] {
  switch (party) {
    case "student":
      return [{ recipientUserId: context.student.userId }];
    case "employer":
      return context.employer
        ? [
            {
              recipientUserId: `contact:${context.employer.id}`,
              recipientOrganizationId: context.employer.id,
            },
          ]
        : [];
    case "college":
      return context.college
        ? [
            {
              recipientUserId: `contact:${context.college.id}`,
              recipientOrganizationId: context.college.id,
            },
          ]
        : [];
    case "board":
      return context.board
        ? [
            {
              recipientUserId: `contact:${context.board.id}`,
              recipientOrganizationId: context.board.id,
            },
          ]
        : [];
    case "admin":
      // Every administrator, resolved from `memberships` by the caller. An
      // empty list is a real answer — a deployment with no administrator yet —
      // and means no message rather than a message to nobody.
      return context.administrators.map((a) => ({ recipientUserId: a.id }));
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
    postingTitle: context.posting.title,
    employerName: context.employer?.name ?? "the employer",
    collegeName: context.college?.name ?? "your college",
    boardName: context.board?.name ?? "the workforce board",
    track: context.application.track,
    applicationId: context.application.id,
    hours: context.application.fundingAuthorizedHours,
    rate: context.application.fundingAuthorizedRate,
    ratePerHour: context.wageRatePerHour,
    creditHours: context.posting.creditHours,
    deliverable: context.posting.deliverable,
  };

  const intents: Omit<NotificationIntent, "marketId">[] = [];
  for (const entry of entries) {
    if (entry.unless?.(context)) continue;
    // One entry can now produce several messages, because an administrator
    // entry addresses every administrator. The other four parties still
    // produce exactly one, or none where the organization is unresolvable.
    for (const to of addressees(entry.party, context)) {
      intents.push({ ...to, kind: entry.kind, payload });
    }
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
/**
 * Which party each message kind is addressed to.
 *
 * Exported so a test can assert that every employer-facing message carries the
 * FERPA redisclosure notice, rather than that assertion depending on a naming
 * convention in the kind string.
 */
export function partyForKind(kind: string): Party | null {
  for (const entries of Object.values(POLICY)) {
    for (const entry of entries ?? []) {
      if (entry.kind === kind) return entry.party;
    }
  }
  return null;
}

export function policyKinds(): string[] {
  return Object.values(POLICY)
    .flat()
    .filter((entry): entry is PolicyEntry => Boolean(entry))
    .map((entry) => entry.kind);
}
