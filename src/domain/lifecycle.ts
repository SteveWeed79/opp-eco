/**
 * The three machines that gate the application machine.
 *
 * An application's lifecycle was the only one modelled, which left three
 * status enums with no rules attached — and two claims in the interface that
 * nothing enforced. The admin console said "nothing transacts until an
 * organization is approved" while a business at `applied` could post, take
 * candidates, and approve hours a board would reimburse. The college portal
 * said "students cannot apply until verified" while applying worked regardless.
 *
 * Both were missing for the same reason: there was nowhere to put the rule.
 * The status existed, the queue rendered it, and nothing could move it, so
 * nothing could depend on it either.
 *
 * These are deliberately small. Each is a table plus the ownership rule that
 * says who the record belongs to; the resolution logic is shared with the
 * application machine in `machine.ts`.
 */

import type {
  Organization,
  OrganizationStatus,
  Posting,
  PostingStatus,
  Student,
  StudentStatus,
} from "./types";
import { createMachine, type StateTransition } from "./machine";

// ---------------------------------------------------------------------------
// Students — the college's trust gate
// ---------------------------------------------------------------------------

/**
 * Verification is the college asserting this person is enrolled and eligible
 * for internship credit. It is the reason an employer can trust a candidate
 * list at all, so it belongs to the college and to nobody else — an
 * administrator can override it, and that override is recorded.
 */
export interface StudentContext {
  student: Student;
}

export type StudentTransition = StateTransition<StudentStatus, StudentContext>;

export const STUDENT_TRANSITIONS: StudentTransition[] = [
  {
    from: "registered",
    to: "profile_complete",
    roles: ["student"],
    label: "Complete profile",
    guard: ({ student }) =>
      student.skills.length > 0 && student.programOfStudy.trim().length > 0
        ? null
        : "Add your program of study and at least one skill first",
  },
  {
    // The student asks to be checked; the college does the checking. Two steps
    // rather than one because the college's queue is built from students who
    // have asked, and a profile nobody submitted is not waiting on anyone.
    from: "profile_complete",
    to: "pending_verification",
    roles: ["student", "college"],
    label: "Submit for verification",
  },
  {
    from: "pending_verification",
    to: "verified",
    roles: ["college"],
    label: "Verify",
  },
  {
    from: "pending_verification",
    to: "verification_rejected",
    roles: ["college"],
    label: "Reject verification",
  },
  {
    // Rejection is not terminal. A student who was not enrolled last term may
    // be this one, and making them re-register would lose their application
    // history along with their profile.
    from: "verification_rejected",
    to: "pending_verification",
    roles: ["student", "college"],
    label: "Resubmit for verification",
  },
  {
    from: "verified",
    to: "inactive",
    roles: ["college"],
    label: "Mark inactive",
  },
  {
    from: "inactive",
    to: "pending_verification",
    roles: ["college"],
    label: "Reactivate",
  },
];

export const studentMachine = createMachine<
  StudentStatus,
  StudentContext,
  StudentTransition
>({
  subject: "student record",
  transitions: STUDENT_TRANSITIONS,
  statusOf: (ctx) => ctx.student.status,
  marketIdOf: (ctx) => ctx.student.marketId,
  ownership: (actor, ctx) =>
    actor.membership.role === "student" && actor.user.id !== ctx.student.userId
      ? "Students may only act on their own record"
      : null,
});

/**
 * Whether this student may apply to anything.
 *
 * The single definition, so the guard on applying and the message explaining
 * why cannot disagree. An unverified student appearing in an employer's
 * candidate list is the failure this prevents: the employer's entire basis for
 * trusting the list is that a college stood behind it.
 */
export function canApply(student: Student): boolean {
  return student.status === "verified";
}

// ---------------------------------------------------------------------------
// Postings — the college gates what students see
// ---------------------------------------------------------------------------

/**
 * The college is the local operator of the market, not a rubber stamp. A
 * posting reaches students only after it has been reviewed, because review is
 * what makes it credit-bearing — an employer publishing directly would bypass
 * the judgement that gives the credit its meaning.
 *
 * The assisted-drafting branch exists because the common failure in a small
 * market is not a bad posting, it is an employer who wants an intern and has
 * no idea how to scope the work.
 */
export interface PostingContext {
  posting: Posting;
  /** Live applications against it. A filled posting still has people in it. */
  openApplications: number;
}

export type PostingTransition = StateTransition<PostingStatus, PostingContext>;

export const POSTING_TRANSITIONS: PostingTransition[] = [
  {
    from: "draft",
    to: "pending_review",
    roles: ["business"],
    label: "Submit for review",
    guard: ({ posting }) =>
      posting.description.trim().length > 0
        ? null
        : "A posting needs a description before the college can review it",
  },
  {
    // "I want an intern but I don't know how to write this."
    from: "draft",
    to: "help_requested",
    roles: ["business"],
    label: "Ask the college for help",
  },
  {
    from: "help_requested",
    to: "college_drafting",
    roles: ["college"],
    label: "Help draft",
  },
  {
    from: "college_drafting",
    to: "pending_review",
    roles: ["college"],
    label: "Finish draft",
  },
  {
    from: "pending_review",
    to: "published",
    roles: ["college"],
    label: "Publish",
    guard: ({ posting }) =>
      posting.skillsRequired.length > 0
        ? null
        : "A posting with no required skills will not match anyone — add skills before publishing",
  },
  {
    from: "pending_review",
    to: "changes_requested",
    roles: ["college"],
    label: "Request changes",
  },
  {
    from: "changes_requested",
    to: "pending_review",
    roles: ["business", "college"],
    label: "Resubmit for review",
  },
  {
    from: "published",
    to: "filled",
    roles: ["business", "college"],
    label: "Mark filled",
  },
  {
    from: "published",
    to: "closed",
    roles: ["business", "college"],
    label: "Close posting",
    guard: ({ openApplications }) =>
      openApplications === 0
        ? null
        : `${openApplications} candidate${openApplications === 1 ? " is" : "s are"} still in this posting's pipeline — decline or place them first`,
  },
  {
    from: "filled",
    to: "closed",
    roles: ["business", "college"],
    label: "Close posting",
  },
  {
    from: "published",
    to: "expired",
    roles: ["college"],
    label: "Expire posting",
  },
  {
    // A filled posting that loses its placement is open again rather than
    // needing to be rewritten from scratch.
    from: "filled",
    to: "published",
    roles: ["business", "college"],
    label: "Reopen",
  },
];

export const postingMachine = createMachine<
  PostingStatus,
  PostingContext,
  PostingTransition
>({
  subject: "posting",
  transitions: POSTING_TRANSITIONS,
  statusOf: (ctx) => ctx.posting.status,
  marketIdOf: (ctx) => ctx.posting.marketId,
  ownership: (actor, ctx) =>
    actor.membership.role === "business" &&
    actor.membership.organizationId !== ctx.posting.businessId
      ? "That posting belongs to another organization"
      : null,
});

/** Whether students can see and apply to this posting. */
export function isOpenToStudents(posting: Posting): boolean {
  return posting.status === "published";
}

// ---------------------------------------------------------------------------
// Organizations — the administrator's gate on everything
// ---------------------------------------------------------------------------

/**
 * Vetting is the check that an organization is what it says it is before it
 * can transact — before an employer can take a student onto their site, before
 * a college can grant credit, before a board can commit public money.
 *
 * Owned by the administrator alone. There is no self-service path from
 * `applied` to `approved`, which is the entire point: an organization that
 * could approve itself is an organization nobody vetted.
 */
export interface OrganizationContext {
  organization: Organization;
}

export type OrganizationTransition = StateTransition<
  OrganizationStatus,
  OrganizationContext
>;

export const ORGANIZATION_TRANSITIONS: OrganizationTransition[] = [
  {
    from: "applied",
    to: "under_review",
    roles: ["admin"],
    label: "Begin vetting",
  },
  {
    from: "under_review",
    to: "info_requested",
    roles: ["admin"],
    label: "Request more information",
  },
  {
    from: "info_requested",
    to: "under_review",
    roles: ["admin"],
    label: "Information received",
  },
  {
    from: "under_review",
    to: "approved",
    roles: ["admin"],
    label: "Approve",
    guard: ({ organization }) =>
      organization.contactEmail.trim().length > 0
        ? null
        : "An approved organization needs a contact we can reach",
  },
  {
    from: "under_review",
    to: "rejected",
    roles: ["admin"],
    label: "Reject",
  },
  {
    // Approved means vetted; active means operating. Kept separate because a
    // market opens on the administrator's schedule, not on the day the last
    // organization clears vetting.
    from: "approved",
    to: "active",
    roles: ["admin"],
    label: "Activate",
  },
  {
    from: "active",
    to: "suspended",
    roles: ["admin"],
    label: "Suspend",
  },
  {
    from: "approved",
    to: "suspended",
    roles: ["admin"],
    label: "Suspend",
  },
  {
    from: "suspended",
    to: "active",
    roles: ["admin"],
    label: "Reinstate",
  },
];

export const organizationMachine = createMachine<
  OrganizationStatus,
  OrganizationContext,
  OrganizationTransition
>({
  subject: "organization",
  transitions: ORGANIZATION_TRANSITIONS,
  statusOf: (ctx) => ctx.organization.status,
  marketIdOf: (ctx) => ctx.organization.marketId,
});

/**
 * Whether this organization may transact — post work, take students, grant
 * credit, commit funds.
 *
 * `approved` and `active` both qualify: approved is vetted, active is vetted
 * and operating. Everything else is either not yet checked or deliberately
 * stopped.
 */
export function canTransact(organization: Organization): boolean {
  return organization.status === "approved" || organization.status === "active";
}

/**
 * Why an organization cannot transact, phrased for the person reading it.
 *
 * Suspension in particular deserves its own sentence — telling a suspended
 * employer that their organization "is not approved" invites them to apply
 * again, which is not the remedy.
 */
export function transactBlockReason(organization: Organization): string | null {
  if (canTransact(organization)) return null;

  switch (organization.status) {
    case "suspended":
      return `${organization.name} is suspended. Contact the program administrator before continuing.`;
    case "rejected":
      return `${organization.name} was not approved to take part in this program.`;
    default:
      return `${organization.name} is still being vetted. Nothing can transact until the program administrator approves it.`;
  }
}
