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
  programYear: string;
}

/**
 * Money, and where it came from.
 *
 * `Market` used to carry `subsidyBudget` and `subsidyRatePerHour` directly, and
 * that was the whole funding model: one workforce board, one allocation, one
 * hourly rate. It was also a number written in one place and read in five,
 * which is the shape this codebase distrusts everywhere else — and it could not
 * express the thing the venture actually sells, which is funding
 * *coordination*: a board's wage subsidy, a foundation's grant toward the cost
 * of internship credit, a college's fee waiver, and an employer's own
 * contribution, layered on one placement.
 *
 * So the figure now lives on a `FundingSource` row and nowhere else. Every
 * balance on every screen is derived from sources and the commitments against
 * them, and changing an allocation is an audited write rather than an edit to
 * a fixture.
 */
export type FundKind =
  /** WIOA and equivalent. Eligibility-gated, and the only one that pays hourly today. */
  | "workforce"
  /** The CCLN foundation and other grantmakers. */
  | "philanthropic"
  /** A college's own scholarship or fee waiver. */
  | "institutional"
  /** The employer's own wage or project fee. */
  | "employer";

/**
 * What a fund may be spent on.
 *
 * Deliberately separate from `FundKind`: a foundation can pay a wage or a
 * transport cost, and a college can waive a fee or fund a stipend. Collapsing
 * the two would mean a new kind of sponsor every time a new cost appears.
 *
 * `credit_cost` is the one that motivated this. The 177-student survey's top
 * barrier to taking a placement is the tuition a student pays to receive credit
 * for work a board is already subsidising, and the platform could not record
 * the cost or the grant that covered it.
 */
export type FundPurpose =
  | "wage_subsidy"
  | "credit_cost"
  | "transportation"
  | "stipend"
  | "employer_support";

/**
 * `exhausted` is derived state made explicit: a source with nothing left is not
 * closed, because a release can put money back into it. `closed` is the sponsor
 * saying the fund is finished, which no release reopens.
 */
export type FundingSourceStatus = "active" | "exhausted" | "closed";

export interface FundingSource {
  id: string;
  marketId: string;
  /** The board, the foundation, the college — whoever the money belongs to. */
  sponsorOrgId: string;
  kind: FundKind;
  purpose: FundPurpose;
  programYear: string;
  /** What a board officer would call it on their own paperwork. */
  name: string;
  /**
   * Whole dollars, and **expected to change**.
   *
   * A supplemental award arrives, a rescission takes some back, a foundation
   * adds to the pot mid-year. That is ordinary program administration rather
   * than a correction, so it runs through `adjustFundingSource` with a reason
   * and lands in the audit log — the number moving is the normal case, and the
   * record of why it moved is what makes it trustworthy.
   */
  allocated: number;
  /**
   * Set only where the fund pays by the hour, as a board's wage subsidy does.
   *
   * Also adjustable, and the reason commitments store their own rate: a board
   * moving next year's cohort from $20 to $18 must not retroactively rewrite
   * what it already committed at $20.
   */
  ratePerHour?: number;
  status: FundingSourceStatus;
  openedOn: string;
  /**
   * Optimistic concurrency. Two administrators adjusting one allocation is the
   * likeliest write conflict here, and the loser must be told to reload rather
   * than silently overwriting the winner's figure with a stale one.
   */
  version: number;
}

/**
 * `released` returns the money and is not a deletion.
 *
 * A placement that never starts has its commitment released, and the row stays:
 * a board asking "what did we commit and not spend" is asking a question a
 * deleted row cannot answer.
 */
export type CommitmentStatus = "authorized" | "disbursed" | "released";

/**
 * One draw against one source.
 *
 * The ledger, and the only thing that counts as committed. The application's
 * `fundingAuthorizedHours` and `fundingAuthorizedRate` remain beside it as a
 * cache the transition guards read, for exactly the reason `hoursApproved` is a
 * cache over time entries: a guard takes an `Application` and no repository.
 * `funding.test.ts` pins the two against each other.
 */
export interface FundingCommitment {
  id: string;
  marketId: string;
  fundingSourceId: string;
  studentId: string;
  /**
   * The placement this pays for, when there is one.
   *
   * Null is a real case rather than missing data: a transport grant or a fee
   * waiver can reach a learner who has not been placed yet, and refusing to
   * record it until they are is how the barrier stays invisible.
   */
  applicationId: string | null;
  /** Whole dollars, fixed at authorization. */
  amount: number;
  /** Hours this covers, where the fund pays hourly. */
  hours?: number;
  /**
   * The rate this was committed at, copied from the source rather than read
   * through it. A source's rate can change; what was already promised cannot.
   */
  ratePerHour?: number;
  status: CommitmentStatus;
  authorizedOn: string;
  authorizedByUserId: string;
  /** Why this was committed, or on release, why it was given back. */
  note?: string;
  version: number;
}

/**
 * `nonprofit` is one value out of the several the vision names, added because
 * there is now something concrete that needs it: a foundation sponsoring a fund.
 *
 * The rest of the wider network the venture describes — K-12 districts, training
 * providers, economic development offices, chambers — are deliberately still
 * absent. Each needs its own answer to what vetting means for it, since
 * `canTransact` gates posting and mentorship on a check written for employers,
 * and adding kinds nothing uses would be a migration that buys a longer enum.
 * A foundation earns its value here by being the sponsor on a `FundingSource`.
 */
export type OrganizationKind = "business" | "college" | "board" | "nonprofit";

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

  /**
   * Partner branding. Education organizations only — a student sees the school
   * they attend, not a vendor.
   *
   * `brandColor` seeds a hue; the ramp rendered from it is computed so every
   * step meets its contrast target. The exact hex is never rendered, which is
   * what stops a partner shipping an accessibility failure under this
   * product's name. See `src/theme/ramp.ts`.
   */
  brandColor?: string;
  /**
   * The school's second colour. Institutions almost always have two — a
   * crimson and a gold, a navy and a vegas gold.
   *
   * Used as a fill with automatically chosen ink on it, never as a text colour
   * or an interactive one. A gold is unreadable as text on white, and solving
   * it as though it were the primary would darken it into a brown that is no
   * longer the school's colour. See `accentFromHue`.
   */
  accentColor?: string;
  logoUrl?: string;
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
  /**
   * When this learner's direct identifiers were removed under the retention
   * schedule, or null while they are still held.
   *
   * On the record rather than inferred from a sentinel name, because "is this
   * purged" is a question reporting asks and a name comparison is the kind of
   * check that silently starts matching a real person called the same thing.
   */
  purgedOn: string | null;
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
// Mentorship
// ---------------------------------------------------------------------------

/**
 * How an employer is willing to give time.
 *
 * The product vision names job shadows and mentorships as career-connected
 * learning in its relational form, alongside placements and projects. They sit
 * on the same dimensions the platform already models, with every one of them
 * turned off: unpaid, no credit, no funding clearance, nothing produced.
 */
export type MentorshipFormat =
  | "one_to_one"
  | "job_shadow"
  | "portfolio_review"
  | "group_session";

/**
 * `withdrawn` is separate from `paused` because they answer different
 * questions. A busy quarter is a pause and the offer comes back; withdrawn is
 * the employer leaving the mentor list, and an offer that could only be paused
 * would leave stale names in front of students forever.
 */
export type MentorshipOfferStatus = "open" | "paused" | "withdrawn";

/**
 * An employer's standing offer to spend time with students.
 *
 * Deliberately carries no wage, no credit hours, and no timesheet. A mentorship
 * is not a small internship — nobody is paid, no board reimburses it, and no
 * college awards credit for it, so giving it any of those fields would invite
 * the reimbursement and credit machinery to attach to something that must not
 * reach either.
 */
export interface MentorshipOffer {
  id: string;
  marketId: string;
  businessId: string;
  format: MentorshipFormat;
  /**
   * The person who would actually meet the student, and what they do.
   *
   * Required for the same reason a standard posting names a supervisor: an
   * offer of mentorship from a company with no human attached to it is a logo,
   * and a student cannot be introduced to a logo.
   */
  mentorName: string;
  mentorRole: string;
  /** What they can usefully talk about. Drawn from the market's skill vocabulary. */
  topics: string[];
  description: string;
  /** Students this mentor will take at once. A declaration, not a reservation. */
  capacity: number;
  status: MentorshipOfferStatus;
  createdOn: string;
}

/**
 * An introduction, and what became of it.
 *
 * `introduced` is the live state and the only one that occupies a place on the
 * offer: the mentorship is in flight. `met` says it happened, `declined` says
 * it did not — and both free the place, because a portfolio review that took an
 * hour in March is not still using one of three seats in September.
 */
export type MentorshipPairingStatus = "introduced" | "met" | "declined";

/**
 * A student introduced to a mentor, by the party that made the introduction.
 *
 * Without this record the offer's `capacity` is a number nobody can check, and
 * a mentorship cannot count toward the outcome this platform says it measures.
 * That was the cost of leaving the pairing off-platform: the college knew who
 * it had introduced and the system did not.
 */
export interface MentorshipPairing {
  id: string;
  marketId: string;
  offerId: string;
  /**
   * The employer, denormalised. A pairing is narrowed to its owner the same way
   * a time entry is, and the scoping rule should not need a join to say so.
   */
  businessId: string;
  studentId: string;
  /**
   * Who made the introduction. A college officer or an administrator — never
   * the student and never the employer, which is the answer to the question
   * this record exists to settle.
   */
  introducedByUserId: string;
  introducedOn: string;
  status: MentorshipPairingStatus;
  /** What happened, or why it did not. Required to close a pairing. */
  outcomeNote?: string;
  outcomeOn?: string;
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

  /**
   * Running totals over this placement's time entries, maintained by the
   * timesheet service inside the same transaction that writes an entry.
   *
   * Denormalised rather than derived because the transition guards and the
   * credit calculation take an `Application` and no repository — recomputing
   * on read would mean handing every guard a database. `timesheet.test.ts`
   * pins them against the entries so the cache cannot drift.
   */
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
// Hours
// ---------------------------------------------------------------------------

export type TimeEntryStatus = "submitted" | "approved" | "rejected";

/**
 * One week of a student's logged hours on one placement.
 *
 * Weekly rather than daily because that is the period a workforce board
 * reimburses against, and a daily grid would be a data-entry burden on a
 * student for precision nobody downstream consumes.
 *
 * **Only the standard track has these.** Micro-internships are fixed-fee for
 * an agreed deliverable — there is no hourly wage to reimburse and no
 * supervisor watching the clock, so billing them by the hour would misstate
 * what was bought. `workHoursFor` uses the posting's estimate instead.
 */
export interface TimeEntry {
  id: string;
  marketId: string;
  applicationId: string;
  /** Denormalised so a row can be scoped without joining through the application. */
  studentId: string;
  /** The employer supervising this placement — the only party that may approve. */
  businessId: string;
  /** Monday of the week worked, ISO date. One entry per placement per week. */
  weekStarting: string;
  hours: number;
  /**
   * What the student worked on.
   *
   * Read by the employer approving it and the college awarding credit for it.
   * Deliberately **not** shown to the workforce board: the board validates a
   * reimbursement claim, which needs hours and periods, not a description of
   * the work. See `TimeEntryRepository`.
   */
  summary: string;
  status: TimeEntryStatus;
  submittedOn: string;
  reviewedOn?: string;
  reviewedByUserId?: string;
  /** Why it was sent back. Required on rejection — see `reviewHoursInput`. */
  reviewNote?: string;
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
// Consent
// ---------------------------------------------------------------------------

/**
 * What a consent covers.
 *
 * Separate scopes rather than one blanket agreement, because they are granted
 * to different parties for different purposes and a learner can reasonably say
 * yes to one and no to another. Someone happy for a college to verify their
 * enrolment to an employer may not want their details going to a government
 * agency for an eligibility determination, and a model with one flag cannot
 * represent that refusal.
 */
export type ConsentScope =
  /** FERPA: the institution disclosing an education record to an employer. */
  | "education_record"
  /** Sharing participant details with a workforce board for a determination. */
  | "workforce_data"
  /** Taking part in the programme at all. */
  | "program_participation";

/**
 * Who gave it.
 *
 * **Recorded, not computed**, and that is the load-bearing decision. FERPA
 * rights transfer to the learner at 18 *or* on enrolment at a postsecondary
 * institution at any age — so for records a college holds about a dual-enrolled
 * sixteen-year-old's college coursework, that learner consents for themselves,
 * while records their high school holds stay the parent's until they turn 18.
 * One placement can generate both.
 *
 * Deriving the right answer would need the school a learner *attends*, which
 * this model does not have yet. It would also need a district's counsel and the
 * partner college's registrar, who will have a settled local answer that
 * overrides any general reasoning. So the platform records which it obtained
 * and does not guess.
 */
export type ConsentGrantor = "learner" | "parent_guardian";

/**
 * `withdrawn` is a status rather than a deletion.
 *
 * A learner withdrawing consent is an event with a date that the institution
 * which relied on it may have to account for. Deleting the row would leave the
 * platform unable to say what was permitted when.
 */
export type ConsentStatus = "granted" | "withdrawn" | "expired";

/**
 * One consent, attached to the institution whose records it covers.
 *
 * `sourceOrgId` is the whole design. Consent is a property of the record's
 * source institution, not of the learner and not of the platform — a college's
 * consent does not authorise a high school's records, and a second institution
 * joining a learner's story means a second consent rather than a wider one.
 */
export interface ConsentRecord {
  id: string;
  marketId: string;
  studentId: string;
  /** The institution whose records this covers. */
  sourceOrgId: string;
  scope: ConsentScope;
  grantedBy: ConsentGrantor;
  grantedOn: string;
  /**
   * When it lapses, or null for open-ended.
   *
   * Null is common and correct — most institutional consent forms run until
   * withdrawn — but the column exists because a district that issues
   * per-academic-year consent has no way to express that otherwise.
   */
  expiresOn: string | null;
  status: ConsentStatus;
  recordedByUserId: string;
  /** What was signed, in the institution's own words. */
  note?: string;
  version: number;
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/**
 * What the learner did next.
 *
 * The lifecycle ends at credit granted, which measures whether the *experience*
 * worked. It says nothing about whether the venture did — the claim this
 * platform actually makes is that a learner who takes part is more likely to
 * end up working in their own region, and until now nothing could record that
 * either way.
 *
 * `employed_in_region` versus `employed_elsewhere` is the distinction the whole
 * argument rests on, so it is a first-class value rather than a note on a
 * general "employed". A programme that reliably produces graduates who leave is
 * a talent pipeline out of the county, and a board funding it deserves to be
 * able to see that.
 *
 * `still_seeking` is a recorded fact, not an absence. A learner who was asked
 * and is still looking is different evidence from a learner nobody followed up
 * with, and collapsing the two would let an unworked follow-up queue read as a
 * bad result — or, worse, let a good one be claimed from silence. **Absence is
 * absence: it has no row.**
 */
export type OutcomeKind =
  | "employed_by_host"
  | "employed_in_region"
  | "employed_elsewhere"
  | "continued_education"
  | "entered_training"
  | "still_seeking";

/**
 * One follow-up observation about one learner.
 *
 * Several per learner is normal and intended: employment measured three months
 * after a placement and again a year later are two facts, not a correction of
 * the first. Nothing here supersedes anything, which is why there is no status
 * and no version — an outcome is an observation, and observations accumulate.
 */
export interface Outcome {
  id: string;
  marketId: string;
  studentId: string;
  /**
   * The experience this followed, when there is one.
   *
   * Null is a real case rather than missing data: a learner reached through
   * mentorship alone has no application, and the day the venture measures
   * career exposure that never became a placement, that learner still has an
   * outcome worth holding.
   */
  applicationId: string | null;
  kind: OutcomeKind;
  /**
   * The date the outcome was true as of — **not** the day someone typed it in.
   *
   * A follow-up made in March about a job that started in January is a January
   * fact, and reporting that grouped it by the entry date would put it in the
   * wrong quarter. `recordedOn` keeps the entry date separately, because the
   * gap between the two is how you tell a live follow-up process from a
   * back-filled one.
   */
  observedOn: string;
  recordedOn: string;
  recordedByUserId: string;
  /**
   * The role that recorded it, frozen at the moment it was recorded.
   *
   * A deliberate departure from `MentorshipPairing.introducedByUserId`, which
   * stores only the user and lets the membership behind it carry the role. That
   * is right for provenance and wrong here, because the source *is* the
   * evidence: "the college followed up" and "the employer told us they hired
   * her" are different strengths of claim, and if the role were resolved at
   * read time, an officer moving between organizations would silently rewrite
   * the evidentiary weight of records they made years earlier.
   */
  source: ActorRole;
  /** The employer, the institution, the programme. Free text, and optional. */
  detail?: string;
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
  entityType:
    | "market"
    | "organization"
    | "student"
    | "posting"
    | "application"
    | "credit"
    | "time_entry"
    | "mentorship_offer"
    | "mentorship_pairing"
    | "outcome"
    | "funding_source"
    | "funding_commitment"
    | "consent";
  entityId: string;
  from: string | null;
  to: string;
  reason?: string;
  /**
   * True when an administrator overrode a role or guard check. Overrides are
   * legitimate — unsticking stalled work is the job — but never silent.
   *
   * Required rather than optional, matching the NOT NULL column behind it: an
   * audit entry that is silent about whether it was an override is the one
   * question an auditor is certain to ask.
   */
  viaOverride: boolean;
}
