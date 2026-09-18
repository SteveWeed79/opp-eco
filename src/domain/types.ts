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
  /**
   * The session is real, and it may do exactly one thing: replace its password.
   *
   * Set when the stored password was put there by somebody else — an operator
   * standing up the first administrator, an administrator restoring access to
   * an account whose mailbox changed. Both factors have been proved, so this is
   * not a half-authenticated session; it is a fully authenticated one carrying
   * an obligation, which is why it is a property of the actor rather than a
   * separate token like the MFA challenge.
   *
   * Absent on every context the demo and the system mint, because neither has a
   * password to owe a change on.
   */
  passwordChangeOwed?: boolean;
  /**
   * Which world a cross-market administrator is looking at.
   *
   * Only an administrator has the question to answer. Every other role is
   * anchored to one market by their membership, so whether that market is the
   * demonstration is already decided for them and `marketScope` never consults
   * this.
   *
   * A switch rather than a filter that adds: the administrator is looking at
   * the demonstration *or* at real programmes, never both at once. Mixing them
   * is the bug this exists to prevent — a subsidy tile summing invented money
   * into a figure a funder is shown.
   *
   * Absent means real, matching the column's own default. Forgetting it shows
   * an empty console rather than somebody's learners.
   */
  viewingDemoData?: boolean;
  /**
   * Reads on nobody's behalf, across both worlds.
   *
   * The one context that must not be narrowed to the demonstration or away from
   * it, because it is not a viewer: `systemContext` resolves an address to a
   * sign-in method before anybody is authenticated, and dispatches queued
   * notifications. Both have to work for a real college and a fictional one
   * alike, and neither renders a figure to anybody — which is the whole reason
   * `viewingDemoData` exists.
   *
   * Set in exactly one place, `systemContext()`, and asserted to be set nowhere
   * else. It reopens the unrestricted cross-market read that `marketScope`
   * otherwise no longer has, so where it is settable is the whole of its
   * safety.
   */
  systemWide?: boolean;
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
  /**
   * `counties` and `state` used to live here. They are now `RegionDefinition`
   * rows, for the reason `FundingSource` took `subsidyBudget` off this type:
   * the figure belongs in one place, and a market's boundary is a thing that
   * changes on a date rather than a property it simply has.
   */
  stage: MarketStage;
  boardId: string | null;
  collegeIds: string[];
  launchedOn: string | null;
  programYear: string;
  /**
   * Whether this market is the demonstration.
   *
   * The one thing on this type that is a claim about the rows rather than a
   * property of the programme, and it is here because every other table in the
   * schema carries `market_id` — so one flag on a market answers "is this
   * fictional" for a posting, a learner, a placement and a dollar figure alike.
   *
   * Written by `db:seed` and by nothing else. The application has no write path
   * to `markets` at all, which is what makes this trustworthy: it cannot be
   * flipped by a bug or by whoever holds an administrator's password. Real
   * markets are real by default, so the failure mode of forgetting it is an
   * empty demonstration rather than an exposed learner.
   */
  isDemoData: boolean;
}

/**
 * The counties a market's retention figures are measured against, from a date.
 *
 * This was two columns on `Market`, and the comment on them said what this is:
 * *"these become state-level reference data with effective dates once regions
 * are redesignated"*. Local workforce areas are redesignated and MSAs are
 * redrawn after each census, and when that happens a single mutable list of
 * counties does something quietly catastrophic — it rewrites every historical
 * figure. The 2026 retention rate recomputed in 2029 would come back different,
 * against a boundary nobody had in 2026, and nothing would say so.
 *
 * So a definition is never edited. A boundary change writes a **new row with a
 * later `effectiveFrom`**, and an outcome is judged against whichever definition
 * was in force when it was observed. That is the whole guarantee, and it is why
 * `redefineRegion` has no counterpart that updates one.
 *
 * Predetermined boundaries rather than a judgement, still: an officer recording
 * where a learner went names a county, and whether that counts as staying is
 * derived from these rather than decided by whoever typed it.
 */
export interface RegionDefinition {
  id: string;
  marketId: string;
  /**
   * The state those counties are in, as a two-letter code.
   *
   * Load-bearing rather than decoration. Kansas and Missouri both have a
   * Jackson County, and Pittsburg is twenty miles from Joplin across the state
   * line — so a county name alone cannot answer whether somebody stayed.
   */
  state: string;
  counties: string[];
  /**
   * Inclusive. The definition in force at a moment is the latest one whose
   * `effectiveFrom` is at or before it.
   *
   * One date rather than a from/to pair: a closed interval has to be kept
   * consistent with its neighbour, and two rows disagreeing about where one
   * boundary ends and the next begins is a gap no query would report.
   */
  effectiveFrom: string;
  /** The redesignation notice, the census, the board's own paperwork. */
  source?: string;
  /**
   * Null on the definitions migrated out of `markets`, because nobody recorded
   * them — they were a column, and a column has no author. Every definition
   * written since names one.
   */
  recordedByUserId: string | null;
  recordedOn: string;
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
  /**
   * How this organization's people sign in.
   *
   * On the organization rather than the user because it is an institutional
   * decision, not a personal preference: a workforce board does not let some of
   * its officers federate and others pick a password, and the platform should
   * not offer that.
   */
  identityMode: IdentityMode;
  /**
   * Work-address domains this organization's people must sign in from.
   *
   * Empty means any address already on a user record. Populated, it is the
   * control that stops a public employee's account being bound to a personal
   * mailbox — which is how a government identity quietly becomes something the
   * agency cannot revoke.
   */
  emailDomains: string[];
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
  /**
   * When the placement itself ended, written once and never overwritten.
   *
   * Distinct from `statusSince`, which every later move rewrites. A placement
   * that finishes in May, has credit granted in June and is closed in August
   * carries `statusSince` of August — so a follow-up clock running from it
   * would be three months out, which is enough to push an observation into the
   * wrong quarter. That is the same failure as the in-region boolean arriving
   * by a different door: a comparison broken in a way that still renders as a
   * clean chart.
   *
   * Set on the first transition into a status that means the work is over,
   * whatever happens afterwards. Optional only for the rows that predate the
   * column; migration 0016 backfills them from the audit log, which has
   * recorded the real transition all along.
   */
  exitedOn?: string;
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
// What the host decided
// ---------------------------------------------------------------------------

/**
 * What the employer who supervised a placement did at the end of it.
 *
 * Three answers rather than two, and the middle one is the reason this exists.
 * "We offered and they turned it down" and "we made no offer" are opposite
 * findings about a town: the first says the work is there and something else
 * pulled the learner away, the second says the work is not there. A programme
 * trying to answer why rural graduates leave needs to tell those apart, and
 * collapsed into one "did not convert" they are indistinguishable — not just
 * hard to separate, but unrecoverable, because separating them later means
 * asking an employer again about a placement that ended a year ago.
 */
export type HostOfferAnswer = "accepted" | "declined" | "none";

/**
 * The host's answer about one finished placement.
 *
 * Its own record rather than columns on `Application`, following
 * `MentorshipPairing`: this is a thing one party said on one date, and who said
 * it is part of what it means. An application is a mutable entity that five
 * roles move between states; this is a statement, and statements do not get
 * edited by whoever touches the row next.
 *
 * **No row means nobody has answered**, which is the whole reason it is a
 * record rather than a nullable column on the application. A three-valued
 * column makes the absence of an answer look like a fourth answer sitting in
 * the same field as the real ones, and the one thing that must never happen
 * here is silence being read as "no offer" — an employer who has not replied is
 * not an employer who declined to hire, and a retention figure that confused
 * the two would understate the programme by the size of its own admin backlog.
 * Absence is work to chase, exactly as a missing `Outcome` is.
 */
export interface HostOffer {
  id: string;
  marketId: string;
  applicationId: string;
  /**
   * The employer, denormalised, so the scoping rule can narrow a row to its
   * owner without a join — the same reason `MentorshipPairing` carries it.
   */
  businessId: string;
  studentId: string;
  answer: HostOfferAnswer;
  recordedByUserId: string;
  recordedOn: string;
  /**
   * The role that gave the answer, frozen when it was recorded, for the reason
   * `Outcome.source` gives at length. Here it separates the employer answering
   * for itself from an administrator writing down what an employer said on the
   * phone — both are the employer's answer, and only one of them is firsthand.
   */
  source: ActorRole;
  /**
   * Why, when there was no offer, or why they turned it down. Optional and
   * deliberately not required: a required note is how a one-click answer turns
   * into a form, and an employer who abandons the form tells you nothing at all.
   */
  note?: string;
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
// Identity
// ---------------------------------------------------------------------------

/**
 * How an organization's people prove who they are.
 *
 * **There is no password anywhere in this model, and that is the point.** A
 * credential this platform does not hold is a credential it cannot leak, and
 * one set of users here are public employees: the data rules say to federate a
 * government identity and never replicate it, so the schema gives it nowhere to
 * land.
 *
 * `federated` is not "SSO is available" — it is "this organization's people may
 * **only** arrive through their own identity provider". No adapter ships yet, so
 * declaring it today means nobody from that organization can sign in through
 * this platform at all. That is the correct failure: a workforce board whose
 * IdP is not wired should be locked out, not quietly issued a platform-held
 * identity for a public employee.
 */
/**
 * How an organization's people prove who they are.
 *
 *  - `password` — an address and a password. Colleges, employers, and the
 *    learners whose membership points at their college.
 *  - `email_code` — a one-time code to a work address, no password anywhere.
 *    Government organizations, and the platform's own administrators.
 *  - `federated` — the agency's own identity provider. The destination for a
 *    government organization, and refused at sign-in until an adapter exists.
 *
 * An institutional property rather than a per-person one: a college decides
 * that its people use passwords, and a public agency decides that its officers
 * do not. Nobody picks individually.
 */
export type IdentityMode = "password" | "email_code" | "federated";

/**
 * A signed-in session, held server-side.
 *
 * `id` is the SHA-256 of the token in the cookie, never the token itself. A
 * dump of this table yields nothing anyone can present — which is the whole
 * reason the session is a record here rather than a signed blob in the browser.
 */
export interface Session {
  id: string;
  userId: string;
  createdAt: string;
  /** Hard stop, regardless of activity. */
  expiresAt: string;
  /** Moved forward on each request, and compared against the idle window. */
  lastSeenAt: string;
  revokedAt: string | null;
}

/**
 * A one-time code, issued to a work address and good for minutes.
 *
 * Keyed by user rather than given its own id: requesting a new code replaces
 * the outstanding one, so a person who clicks twice cannot leave two live codes
 * behind, and there is no way to accumulate guesses across several.
 *
 * The code itself is never stored — `codeHash` is. The platform can check a
 * code and cannot reproduce one, which matters because an unconsumed code is a
 * bearer token for somebody's account.
 */
/**
 * What an emailed code is for.
 *
 * A code sent to prove an address is not a code sent to reset a password, and
 * until this existed there was nothing in the row to tell them apart — so
 * either could have been spent as the other by whoever got hold of it first.
 */
export type CodePurpose = "sign_in" | "password_reset";

/**
 * Somebody's password, as the database holds it.
 *
 * The hash is self-describing — `scrypt$N$r$p$salt$key` — so the cost can be
 * raised later without a migration that locks everybody out. See
 * `domain/password.ts`.
 */
export interface StoredPassword {
  userId: string;
  hash: string;
  updatedAt: string;
  /**
   * Set when somebody other than the owner put this password here — an
   * administrator restoring access to an account whose mailbox changed. They
   * must choose their own before doing anything else, so a temporary credential
   * cannot quietly become a permanent one.
   */
  mustChange: boolean;
}

export interface SignInCode {
  userId: string;
  purpose: CodePurpose;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  /** Guesses so far. A code is retired well before brute force is plausible. */
  attempts: number;
  consumedAt: string | null;
}

/**
 * Somebody's enrolled authenticator.
 *
 * The secret is held in a form the server can compute with, unlike every other
 * credential here — TOTP is shared, so there is no hash that would still let
 * the server produce the same six digits the phone does. See
 * `0011_second_factor.sql` for what follows from that.
 */
export interface TotpEnrolment {
  userId: string;
  /** Base32, as the authenticator app was given it. */
  secret: string;
  createdAt: string;
  /** Null until they have proved they can read a code from it. */
  confirmedAt: string | null;
  /** The last counter accepted, so a code cannot be replayed inside its window. */
  lastCounter: number | null;
}

/** One way back in from a lost phone. Single use, stored as a hash. */
export interface RecoveryCode {
  id: string;
  userId: string;
  codeHash: string;
  createdAt: string;
  usedAt: string | null;
}

/**
 * Somebody between the two factors.
 *
 * Deliberately not a session: nothing resolves to an actor until both factors
 * are in, so there is no half-authenticated row for a missing predicate to turn
 * into a working login.
 */
export interface MfaChallenge {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
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
 * Whether the learner stayed is still the distinction the whole argument rests
 * on — a programme that reliably produces graduates who leave is a talent
 * pipeline out of the county, and a board funding it deserves to see that. But
 * it is **derived from where they went**, not chosen here.
 *
 * This enum used to carry `employed_by_host`, `employed_in_region` and
 * `employed_elsewhere`, which answered three questions at once: what happened,
 * who employs them, and where. Welding the place into the outcome type made
 * "in region" a judgement the recorder made with no definition of region — and
 * two colleges will draw that line differently. `Outcome` now captures the
 * county and state, and `inRegion` derives the answer against the market's own
 * counties. One captured place also answers county, workforce-area and state
 * roll-ups, which a boolean never could.
 *
 * `still_seeking` is a recorded fact, not an absence. A learner who was asked
 * and is still looking is different evidence from a learner nobody followed up
 * with, and collapsing the two would let an unworked follow-up queue read as a
 * bad result — or, worse, let a good one be claimed from silence. **Absence is
 * absence: it has no row.**
 */
export type OutcomeKind =
  | "employed"
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
   * Whether the employer who supervised the placement took them on.
   *
   * Its own field rather than a kind, because it answers a different question
   * from the other two: `employed` says what happened, the county says where,
   * and this says who. A hire by the host is the strongest result the programme
   * can produce and the one an employer can attest to first-hand — but it was
   * never a *place*, and folding it into the same enum as "in region" is what
   * made that enum unable to answer either question cleanly.
   *
   * False for everything that is not employment.
   */
  employedByHost: boolean;
  /**
   * Where they went to work — the county and the two-letter state.
   *
   * Captured rather than judged. Whether this counts as staying is derived
   * against the market's own counties, so two colleges cannot draw the line
   * differently, and a boundary that turns out to be wrong can be re-derived
   * from the same rows instead of re-asked of people nobody can reach.
   *
   * Name and state rather than a FIPS code, deliberately: both are unambiguous
   * — Kansas and Missouri each have a Jackson County, so the state is what
   * disambiguates — and a name joins to FIPS later from a real reference
   * dataset. Inventing five-digit codes from memory would put a wrong one in
   * the column that everything else is going to key on.
   *
   * Null together, never singly, and null for any outcome that is not
   * employment. Null on an employment outcome means the place was not captured
   * — which is a real state for rows that predate this field.
   */
  employmentCounty: string | null;
  employmentState: string | null;
  /**
   * The in-region judgement carried over from the rows that only had one.
   *
   * Before the county was captured, `employed_in_region` and
   * `employed_elsewhere` were the whole answer, and those rows are real
   * history. This preserves what was asserted without pretending to a precision
   * they never had: their place is unknown and stays unknown, but what the
   * recorder claimed is not thrown away.
   *
   * Null on every row written since. `inRegion` prefers the captured place and
   * falls back to this, which is why both can coexist without either being a
   * lie.
   */
  assertedInRegion: boolean | null;
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
    | "interview_slot"
    | "outcome"
    // What the host did at the end of a placement. Audited like an outcome and
    // for the same reason: it is a figure a board will be shown, so who entered
    // it and when has to be answerable a year later — particularly when the
    // answer was transcribed by an administrator rather than given firsthand.
    | "host_offer"
    // A market's boundary. Audited because a redesignation moves every figure
    // reported after it, and "why did this market's retention rate change in
    // 2027" has to be answerable with something other than a guess.
    | "region"
    | "funding_source"
    | "funding_commitment"
    | "consent"
    // An account: added to an organization, or moved to a new work address.
    // Both are identity rather than work, and both are the answer to "who was
    // this account when it signed that" — which is the question attribution
    // gets asked a year later.
    | "user";
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
