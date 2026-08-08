/**
 * Core domain entities.
 *
 * Pure types with no UI or persistence dependency. Everything the five portals
 * render is a projection of what's declared here.
 */

// ---------------------------------------------------------------------------
// Identity and access
// ---------------------------------------------------------------------------

export type ActorRole = "admin" | "student" | "business" | "college" | "board";

/**
 * Role is never chosen by the client. It comes from a membership record
 * resolved server-side, and a person may hold several.
 */
export interface Membership {
  id: string;
  userId: string;
  organizationId: string | null; // null only for admin, who is cross-market
  marketId: string | null; // null only for admin
  role: ActorRole;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

/** The resolved caller. Every repository read is scoped through one of these. */
export interface ActorContext {
  user: User;
  membership: Membership;
}

// ---------------------------------------------------------------------------
// Market — the tenancy root
// ---------------------------------------------------------------------------

/**
 * A market is a workforce board, one or more colleges, and a geography,
 * launched by the administrator as a unit. Every other record belongs to
 * exactly one market.
 */
export type MarketStage =
  | "prospecting"
  | "board_engaged"
  | "board_committed"
  | "college_engaged"
  | "college_committed"
  | "configuring"
  | "live"
  | "paused"
  | "declined";

export interface Market {
  id: string;
  name: string;
  city: string;
  counties: string[];
  stage: MarketStage;
  boardId: string | null;
  collegeIds: string[];
  launchedOn: string | null;
  /** Board allocation for the program year, in whole dollars. */
  subsidyBudget: number;
  subsidyRatePerHour: number;
  programYear: string;
}

export type OrganizationKind = "business" | "college" | "board";

export type OrganizationStatus =
  | "applied"
  | "under_review"
  | "info_requested"
  | "approved"
  | "active"
  | "suspended"
  | "rejected";

export interface Organization {
  id: string;
  marketId: string;
  kind: OrganizationKind;
  name: string;
  county: string;
  status: OrganizationStatus;
  contactName: string;
  contactEmail: string;
  appliedOn: string;
  /** Colleges only: minimum student work hours required per credit awarded. */
  hoursPerCredit?: number;
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export type StudentStatus =
  | "registered"
  | "profile_complete"
  | "pending_verification"
  | "verified"
  | "verification_rejected"
  | "inactive";

/**
 * Participant eligibility is determined once by the board and travels with the
 * student. Per-placement funding authorization is separate — see Placement.
 */
export type EligibilityStatus =
  | "not_determined"
  | "interview_scheduled"
  | "eligible"
  | "not_eligible";

export interface Student {
  id: string;
  marketId: string;
  userId: string;
  collegeId: string;
  name: string;
  email: string;
  programOfStudy: string;
  classStanding: string;
  expectedGraduation: string;
  skills: string[];
  interests: string[];
  availableHoursPerWeek: number;
  status: StudentStatus;
  eligibility: EligibilityStatus;
  /** Set when the board determines eligibility; clearance expires. */
  eligibilityDeterminedOn: string | null;
  eligibilityExpiresOn: string | null;
  verifiedOn: string | null;
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

/**
 * The two tracks differ on more than duration, so the track drives which
 * workflow steps are required. See workflow.ts.
 */
export type Track = "standard" | "micro";

export type PostingStatus =
  | "draft"
  | "help_requested"
  | "college_drafting"
  | "pending_review"
  | "changes_requested"
  | "published"
  | "filled"
  | "closed"
  | "expired";

export interface Posting {
  id: string;
  marketId: string;
  businessId: string;
  track: Track;
  title: string;
  description: string;
  county: string;
  skillsRequired: string[];
  skillsPreferred: string[];
  status: PostingStatus;
  openings: number;
  createdOn: string;

  // Standard track
  wagePerHour?: number;
  hoursPerWeek?: number;
  weeks?: number;
  creditHours?: number;
  supervisorName?: string;

  // Micro track — fixed fee, no hourly wage, no ongoing supervisor
  projectFee?: number;
  estimatedHours?: number;
  deliverable?: string;
  dueWithinDays?: number;
}

/** Total student work hours a posting represents, across either track. */
export function postingTotalHours(posting: Posting): number {
  if (posting.track === "micro") return posting.estimatedHours ?? 0;
  return (posting.hoursPerWeek ?? 0) * (posting.weeks ?? 0);
}

// ---------------------------------------------------------------------------
// Applications and placements
// ---------------------------------------------------------------------------

export type ApplicationStatus =
  | "submitted"
  | "under_review"
  | "shortlisted"
  | "mutual_interest"
  | "interview_scheduled"
  | "interview_completed"
  | "cleared"
  | "funding_authorized"
  | "unsubsidized"
  | "placement_active"
  | "placement_completed"
  | "credit_pending"
  | "credit_granted"
  | "credit_denied"
  | "rejected"
  | "withdrawn"
  | "terminated_early"
  | "closed";

export interface Application {
  id: string;
  marketId: string;
  postingId: string;
  studentId: string;
  track: Track;
  status: ApplicationStatus;
  /**
   * The furthest status this application ever reached.
   *
   * `closed` erases how far an application got, so funnel reporting would
   * otherwise show conversion falling as work completes. A production build
   * derives this from the audit log; here it is recorded on the row.
   */
  furthestStatus?: ApplicationStatus;
  submittedOn: string;
  /** When the current status was entered — drives dwell-time reporting. */
  statusSince: string;
  matchScore: MatchScore;

  interviewSlotId?: string;
  /** Board authorization for this specific placement. */
  fundingAuthorizedHours?: number;
  fundingAuthorizedRate?: number;

  hoursLogged?: number;
  hoursApproved?: number;
  deliverableSubmitted?: boolean;
  deliverableAccepted?: boolean;
  creditAwardId?: string;
  /**
   * Optimistic concurrency token, incremented on every write. Two actors
   * moving one application at once is routine, and the loser must be told to
   * reload rather than silently overwriting the winner.
   */
  version: number;
}

/**
 * Stored rather than computed on read, with the factors that produced it and
 * the algorithm version, because employers ask "why 94%?" and someone will
 * eventually audit it. It sorts; it never gates.
 */
export interface MatchScore {
  score: number;
  algorithmVersion: string;
  factors: MatchFactor[];
}

export interface MatchFactor {
  label: string;
  weight: number;
  contribution: number;
}

// ---------------------------------------------------------------------------
// Board interviews and funding
// ---------------------------------------------------------------------------

export interface InterviewSlot {
  id: string;
  marketId: string;
  boardId: string;
  startsAt: string;
  durationMinutes: number;
  officerName: string;
  bookedByStudentId: string | null;
  bookedAt?: string | null;
  meetingUrl: string | null;
  /** Two students racing for the last slot is the likeliest write conflict. */
  version: number;
}

// ---------------------------------------------------------------------------
// Credit
// ---------------------------------------------------------------------------

/**
 * Many-to-many with placements from the start. A standard internship earns
 * credit on its own; micro-internships accumulate hours across several
 * completed projects before reaching the college's threshold for one credit.
 */
export interface CreditAward {
  id: string;
  marketId: string;
  studentId: string;
  collegeId: string;
  applicationIds: string[];
  creditHours: number;
  totalWorkHours: number;
  /**
   * Hours this award consumed but did not convert into a credit. Micro
   * projects are indivisible, so covering 90 hours can take 120 hours of
   * work; the surplus carries into the student's next award rather than
   * being silently lost.
   */
  carriedHours: number;
  status: "pending" | "granted" | "denied";
  courseMapping: string;
  grantedOn: string | null;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * Every state transition writes one of these. Reporting is derived from the
 * log rather than computed ad hoc, which is what makes it auditable.
 */
export interface AuditEvent {
  id: string;
  marketId: string;
  at: string;
  actorUserId: string;
  actorRole: ActorRole;
  entityType: "market" | "organization" | "student" | "posting" | "application" | "credit";
  entityId: string;
  from: string | null;
  to: string;
  reason?: string;
  /**
   * True when an administrator overrode a role or guard check. Overrides are
   * legitimate — unsticking stalled work is the job — but never silent.
   */
  viaOverride?: boolean;
}
