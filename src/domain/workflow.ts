/**
 * The application state machine.
 *
 * One guarded transition table serves both tracks and all five portals. Every
 * portal queue is a filter over this; every portal action is a transition
 * request checked against it. Nothing may move an application except through
 * `attemptTransition`.
 */

import type {
  ActorContext,
  Application,
  ApplicationStatus,
  ActorRole,
  Student,
  Track,
} from "./types";

export interface TransitionContext {
  application: Application;
  student: Student;
  /** Board allocation still uncommitted in this market, in dollars. */
  remainingBudget: number;
}

export interface Transition {
  from: ApplicationStatus;
  to: ApplicationStatus;
  /** Roles permitted to perform it. Admin is handled separately. */
  roles: ActorRole[];
  /** Tracks this transition exists for. Absent means both. */
  tracks?: Track[];
  label: string;
  /** Extra precondition beyond role and current state. */
  guard?: (ctx: TransitionContext) => string | null;
}

/**
 * Admin can force any transition, because unsticking stalled work is the
 * administrator's core job — but never silently. See `attemptTransition`.
 */
const ADMIN_OVERRIDE_ROLE: ActorRole = "admin";

export const TRANSITIONS: Transition[] = [
  // --- Business review -----------------------------------------------------
  {
    from: "submitted",
    to: "under_review",
    roles: ["business"],
    label: "Begin review",
  },
  {
    from: "under_review",
    to: "shortlisted",
    roles: ["business"],
    label: "Shortlist candidate",
  },
  {
    from: "under_review",
    to: "rejected",
    roles: ["business"],
    label: "Decline candidate",
  },
  {
    from: "submitted",
    to: "withdrawn",
    roles: ["student"],
    label: "Withdraw application",
  },
  {
    from: "under_review",
    to: "withdrawn",
    roles: ["student"],
    label: "Withdraw application",
  },

  // --- Mutual interest -----------------------------------------------------
  // The meaningful milestone: both sides have said yes. On the standard track
  // this opens the pause that the platform exists to close.
  {
    from: "shortlisted",
    to: "mutual_interest",
    roles: ["student"],
    label: "Confirm interest",
  },
  {
    from: "shortlisted",
    to: "withdrawn",
    roles: ["student"],
    label: "Withdraw application",
  },

  // --- The pause: board clearance (standard track only) --------------------
  // Micro-internships are a fixed project fee with no hours for an hourly
  // reimbursement to attach to, so they skip the board entirely.
  //
  // Clearance is per applicant *per job*: every standard application gets its
  // own interview, because the board is assessing this specific placement, not
  // issuing a portable credential. Board workload therefore scales with
  // applications rather than with students.
  {
    from: "mutual_interest",
    to: "interview_scheduled",
    roles: ["student"],
    tracks: ["standard"],
    label: "Book board interview",
    guard: ({ student }) =>
      student.eligibility === "not_eligible"
        ? "Student was previously determined ineligible for workforce funding"
        : null,
  },
  {
    from: "interview_scheduled",
    to: "interview_completed",
    roles: ["board"],
    tracks: ["standard"],
    label: "Record interview outcome",
  },
  {
    from: "interview_scheduled",
    to: "mutual_interest",
    roles: ["board", "student"],
    tracks: ["standard"],
    label: "Release slot and rebook",
  },
  {
    from: "interview_completed",
    to: "cleared",
    roles: ["board"],
    tracks: ["standard"],
    label: "Determine participant eligible",
  },
  {
    from: "interview_completed",
    to: "unsubsidized",
    roles: ["board"],
    tracks: ["standard"],
    label: "Determine not eligible for funding",
  },

  // --- Funding authorization ----------------------------------------------
  // Separate from the interview: having cleared this candidate for this job,
  // the board decides what to actually commit, at a rate and hour cap, against
  // a finite annual allocation.
  {
    from: "cleared",
    to: "funding_authorized",
    roles: ["board"],
    tracks: ["standard"],
    label: "Authorize funding",
    guard: ({ application, remainingBudget }) => {
      const hours = application.fundingAuthorizedHours ?? 0;
      const rate = application.fundingAuthorizedRate ?? 0;
      const commitment = hours * rate;
      if (commitment <= 0) return "Authorization needs an hour cap and a rate";
      if (commitment > remainingBudget) {
        return `Commitment of $${commitment.toLocaleString()} exceeds $${remainingBudget.toLocaleString()} remaining in the program year`;
      }
      return null;
    },
  },
  {
    from: "cleared",
    to: "unsubsidized",
    roles: ["board"],
    tracks: ["standard"],
    label: "Decline funding for this placement",
  },

  // --- Placement start -----------------------------------------------------
  {
    from: "funding_authorized",
    to: "placement_active",
    roles: ["business"],
    tracks: ["standard"],
    label: "Start placement",
  },
  {
    // An unfunded placement is still a real placement — it must not dead-end.
    from: "unsubsidized",
    to: "placement_active",
    roles: ["business"],
    tracks: ["standard"],
    label: "Start placement without subsidy",
  },
  {
    from: "unsubsidized",
    to: "closed",
    roles: ["business", "student"],
    tracks: ["standard"],
    label: "Close without placement",
  },
  {
    // Micro track: no board, no funding step. Interest to work in one move.
    from: "mutual_interest",
    to: "placement_active",
    roles: ["business"],
    tracks: ["micro"],
    label: "Assign project",
  },

  // --- The work ------------------------------------------------------------
  {
    from: "placement_active",
    to: "placement_completed",
    roles: ["business"],
    tracks: ["standard"],
    label: "Mark placement complete",
    guard: ({ application }) =>
      (application.hoursApproved ?? 0) > 0
        ? null
        : "No approved hours logged for this placement",
  },
  {
    from: "placement_active",
    to: "placement_completed",
    roles: ["business"],
    tracks: ["micro"],
    label: "Accept deliverable",
    guard: ({ application }) =>
      application.deliverableSubmitted
        ? null
        : "Student has not submitted the deliverable yet",
  },
  {
    from: "placement_active",
    to: "terminated_early",
    roles: ["business", "college"],
    label: "End placement early",
  },

  // --- Credit --------------------------------------------------------------
  {
    from: "placement_completed",
    to: "credit_pending",
    roles: ["student", "college"],
    label: "Submit for credit",
  },
  {
    from: "credit_pending",
    to: "credit_granted",
    roles: ["college"],
    label: "Grant credit",
  },
  {
    from: "credit_pending",
    to: "credit_denied",
    roles: ["college"],
    label: "Deny credit",
  },
  {
    from: "credit_granted",
    to: "closed",
    roles: ["college"],
    label: "Close",
  },
  {
    from: "credit_denied",
    to: "closed",
    roles: ["college"],
    label: "Close",
  },
  {
    from: "terminated_early",
    to: "closed",
    roles: ["college", "business"],
    label: "Close",
  },
];

// ---------------------------------------------------------------------------
// Transition resolution
// ---------------------------------------------------------------------------

export interface TransitionResult {
  ok: boolean;
  /** Why the transition was refused. Present only when `ok` is false. */
  error?: string;
  /** True when the move was only possible via administrator override. */
  viaOverride?: boolean;
}

function trackAllows(transition: Transition, track: Track): boolean {
  return !transition.tracks || transition.tracks.includes(track);
}

/** Transitions defined for a status on a given track, ignoring who is asking. */
export function transitionsFrom(
  status: ApplicationStatus,
  track: Track,
): Transition[] {
  return TRANSITIONS.filter(
    (t) => t.from === status && trackAllows(t, track),
  );
}

/**
 * What this actor may do right now — the source of truth for which buttons a
 * portal renders. A button that isn't here doesn't exist for that actor.
 */
export function availableTransitions(
  actor: ActorContext,
  ctx: TransitionContext,
): Transition[] {
  const { application } = ctx;
  const candidates = transitionsFrom(application.status, application.track);
  if (actor.membership.role === ADMIN_OVERRIDE_ROLE) return candidates;
  return candidates.filter(
    (t) => t.roles.includes(actor.membership.role) && !t.guard?.(ctx),
  );
}

/**
 * The only way an application changes status.
 *
 * Checks that the transition exists for the track, that the actor holds a
 * permitted role, that the actor is in the same market, and that any guard
 * passes. Administrators may override role and guard checks — that is what
 * unsticking stalled work means — but the result is flagged so the caller can
 * record it as an override in the audit log, and a reason is required.
 */
export function attemptTransition(
  actor: ActorContext,
  ctx: TransitionContext,
  to: ApplicationStatus,
  reason?: string,
): TransitionResult {
  const { application } = ctx;
  const isAdmin = actor.membership.role === ADMIN_OVERRIDE_ROLE;

  if (!isAdmin && actor.membership.marketId !== application.marketId) {
    return { ok: false, error: "Actor is not a member of this market" };
  }

  const transition = TRANSITIONS.find(
    (t) =>
      t.from === application.status &&
      t.to === to &&
      trackAllows(t, application.track),
  );

  if (!transition) {
    return {
      ok: false,
      error: `No transition from ${application.status} to ${to} on the ${application.track} track`,
    };
  }

  const roleAllowed = transition.roles.includes(actor.membership.role);
  const guardError = transition.guard?.(ctx) ?? null;

  if (isAdmin && (!roleAllowed || guardError)) {
    if (!reason) {
      return {
        ok: false,
        error: "Administrator override requires a reason",
      };
    }
    return { ok: true, viaOverride: true };
  }

  if (!roleAllowed) {
    return {
      ok: false,
      error: `A ${actor.membership.role} may not perform "${transition.label}"`,
    };
  }

  if (guardError) return { ok: false, error: guardError };

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reporting helpers derived from the machine
// ---------------------------------------------------------------------------

/**
 * Statuses where an application is waiting on someone. Dwell time in these is
 * the administrator's most important operational signal — `mutual_interest`
 * and `interview_scheduled` especially, because that is where placements die.
 */
export const WAITING_STATUSES: ApplicationStatus[] = [
  "submitted",
  "under_review",
  "shortlisted",
  "mutual_interest",
  "interview_scheduled",
  "interview_completed",
  "cleared",
  "credit_pending",
];

/** Statuses that make up the pause between mutual interest and a funded start. */
export const PAUSE_STATUSES: ApplicationStatus[] = [
  "mutual_interest",
  "interview_scheduled",
  "interview_completed",
  "cleared",
];

export const TERMINAL_STATUSES: ApplicationStatus[] = [
  "closed",
  "rejected",
  "withdrawn",
];

export function isTerminal(status: ApplicationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function daysInStatus(application: Application, now: Date): number {
  const since = new Date(application.statusSince).getTime();
  return Math.floor((now.getTime() - since) / 86_400_000);
}

/** Dollars a funded placement commits against the board's annual allocation. */
export function fundingCommitment(application: Application): number {
  return (
    (application.fundingAuthorizedHours ?? 0) *
    (application.fundingAuthorizedRate ?? 0)
  );
}
