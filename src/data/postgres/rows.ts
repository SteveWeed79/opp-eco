/**
 * Rows to domain objects.
 *
 * The schema and the domain types deliberately disagree in four places, and
 * every one of them is a bug waiting to happen if it is done ad hoc at each
 * query. So it is done once, here, and pinned by tests.
 *
 * 1. **Money is cents in the database and dollars in the domain.** The schema
 *    says so in as many words — "Money is stored in cents. Floating-point
 *    dollars in a system that reports to a funder is not acceptable." The
 *    domain works in whole dollars because that is what a wage and an
 *    allocation are quoted in. Converting in one direction only, in one place.
 *
 * 2. **`numeric` and `bigint` arrive as strings.** node-postgres will not
 *    silently parse them, because both can hold values a JS number cannot
 *    represent exactly. Every one here is small enough to be safe, so they are
 *    parsed — but explicitly, so `hoursApproved` is never the string "44"
 *    quietly failing every `>` comparison in the guards.
 *
 * 3. **A student's name and email live on `users`.** The `students` table has
 *    neither; identity belongs to the person, not to their enrolment. Reads
 *    join, and the mapper takes the joined shape.
 *
 * 4. **Two relationships are join tables** — a market's colleges and a credit
 *    award's applications — which arrive aggregated rather than as columns.
 */

import { clearanceExpiry } from "@/domain/eligibility";
import type {
  Application,
  AuditEvent,
  ConsentRecord,
  CreditAward,
  InterviewSlot,
  MarketStage,
  MatchFactor,
  MentorshipOffer,
  FundingCommitment,
  FundingSource,
  MentorshipPairing,
  Organization,
  HostOffer,
  Outcome,
  Posting,
  Student,
  TimeEntry,
  User,
} from "@/domain/types";

export type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Cents to whole dollars.
 *
 * Rounded rather than truncated: the seed is whole dollars so nothing should
 * carry a remainder, and if one ever does, a wage of $21.99 reading back as
 * $21 is a worse failure than one cent of rounding.
 */
export function dollars(value: unknown): number {
  return Math.round(number(value) / 100);
}

/** A nullable money column as dollars, keeping "not set" distinct from zero. */
export function optionalDollars(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : dollars(value);
}

/** Dollars to cents, for the write side. */
export function cents(value: number): number {
  return Math.round(value * 100);
}

/** `numeric` and `bigint` arrive as strings; everything else is already one. */
export function number(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new TypeError(`Expected a number from the database, got ${String(value)}`);
  }
  return parsed;
}

function optionalNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : number(value);
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function optionalText(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

/**
 * A nullable column as `string | null`, keeping the null.
 *
 * Distinct from `optionalText` on purpose. A column the domain models as
 * `string | null` is one where absence carries meaning — an outcome with no
 * application is a learner reached some other way — and mapping it to
 * `undefined` would make it indistinguishable from a field that was never set.
 */
function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function bool(value: unknown): boolean {
  return value === true;
}

/** `text[]` arrives as a real array; null becomes empty rather than absent. */
function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * A `timestamptz` as the ISO string the domain uses.
 *
 * The driver hands back a `Date`. Everything downstream — dwell time, sorting,
 * `toLocaleDateString` — takes a string and reparses it, which is the format
 * the fixtures already produce.
 */
export function timestamp(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function optionalTimestamp(value: unknown): string | undefined {
  const at = timestamp(value);
  return at === "" ? undefined : at;
}

function nullableTimestamp(value: unknown): string | null {
  const at = timestamp(value);
  return at === "" ? null : at;
}

/**
 * A `date` as `YYYY-MM-DD`.
 *
 * Separate from `timestamp` because a week-starting Monday must not acquire a
 * time. The driver parses `date` into a `Date` at *local* midnight, so taking
 * the ISO string's leading ten characters would shift the day backwards for
 * anyone west of UTC — the date parts are read directly instead.
 */
export function dateOnly(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/** Markets carry their colleges from `market_colleges`, aggregated by the query. */
export function toMarket(row: Row): import("@/domain/types").Market {
  return {
    id: text(row.id),
    name: text(row.name),
    city: text(row.city),
    counties: list(row.counties),
    state: text(row.state),
    stage: text(row.stage) as MarketStage,
    boardId: row.board_id === null || row.board_id === undefined ? null : text(row.board_id),
    collegeIds: list(row.college_ids),
    launchedOn: nullableTimestamp(row.launched_on),
    programYear: text(row.program_year),
  };
}

export function toOrganization(row: Row): Organization {
  return {
    id: text(row.id),
    marketId: text(row.market_id),
    kind: text(row.kind) as Organization["kind"],
    name: text(row.name),
    county: text(row.county),
    status: text(row.status) as Organization["status"],
    contactName: text(row.contact_name),
    contactEmail: text(row.contact_email),
    appliedOn: timestamp(row.applied_on),
    hoursPerCredit: optionalNumber(row.hours_per_credit),
    brandColor: optionalText(row.brand_color),
    accentColor: optionalText(row.accent_color),
    logoUrl: optionalText(row.logo_url),
    identityMode: text(row.identity_mode) as Organization["identityMode"],
    emailDomains: list(row.email_domains),
  };
}

export function toUser(row: Row): User {
  return {
    id: text(row.id),
    name: text(row.name),
    email: text(row.email),
  };
}

/** Takes the students-joined-users shape: `name` and `email` come from `users`. */
export function toStudent(row: Row): Student {
  return {
    id: text(row.id),
    marketId: text(row.market_id),
    userId: text(row.user_id),
    collegeId: text(row.college_id),
    name: text(row.name),
    email: text(row.email),
    programOfStudy: text(row.program_of_study),
    classStanding: text(row.class_standing),
    expectedGraduation: text(row.expected_graduation),
    skills: list(row.skills),
    interests: list(row.interests),
    availableHoursPerWeek: number(row.available_hours_per_week),
    status: text(row.status) as Student["status"],
    eligibility: text(row.eligibility) as Student["eligibility"],
    eligibilityDeterminedOn: nullableTimestamp(row.eligibility_determined_on),
    // Derived, not stored, from the domain's rule — the same call the fixtures
    // make, so both data layers give one student one expiry.
    eligibilityExpiresOn: clearanceExpiry(
      nullableTimestamp(row.eligibility_determined_on),
    ),
    verifiedOn: nullableTimestamp(row.verified_on),
    purgedOn: nullableTimestamp(row.purged_on),
  };
}

export function toPosting(row: Row): Posting {
  return {
    id: text(row.id),
    marketId: text(row.market_id),
    businessId: text(row.business_id),
    track: text(row.track) as Posting["track"],
    title: text(row.title),
    description: text(row.description),
    county: text(row.county),
    skillsRequired: list(row.skills_required),
    skillsPreferred: list(row.skills_preferred),
    status: text(row.status) as Posting["status"],
    openings: number(row.openings),
    createdOn: timestamp(row.created_at),
    wagePerHour:
      row.wage_cents === null || row.wage_cents === undefined
        ? undefined
        : dollars(row.wage_cents),
    hoursPerWeek: optionalNumber(row.hours_per_week),
    weeks: optionalNumber(row.weeks),
    creditHours: optionalNumber(row.credit_hours),
    supervisorName: optionalText(row.supervisor_name),
    projectFee:
      row.project_fee_cents === null || row.project_fee_cents === undefined
        ? undefined
        : dollars(row.project_fee_cents),
    estimatedHours: optionalNumber(row.estimated_hours),
    deliverable: optionalText(row.deliverable),
    dueWithinDays: optionalNumber(row.due_within_days),
  };
}

export function toMentorshipOffer(row: Row): MentorshipOffer {
  return {
    id: text(row.id),
    marketId: text(row.market_id),
    businessId: text(row.business_id),
    format: text(row.format) as MentorshipOffer["format"],
    mentorName: text(row.mentor_name),
    mentorRole: text(row.mentor_role),
    topics: list(row.topics),
    description: text(row.description),
    capacity: number(row.capacity),
    status: text(row.status) as MentorshipOffer["status"],
    createdOn: timestamp(row.created_at),
  };
}

export function toMentorshipPairing(row: Row): MentorshipPairing {
  return {
    id: text(row.id),
    marketId: text(row.market_id),
    offerId: text(row.offer_id),
    businessId: text(row.business_id),
    studentId: text(row.student_id),
    introducedByUserId: text(row.introduced_by),
    introducedOn: timestamp(row.introduced_on),
    status: text(row.status) as MentorshipPairing["status"],
    outcomeNote: optionalText(row.outcome_note),
    outcomeOn: optionalTimestamp(row.outcome_on),
  };
}

export function toConsentRecord(row: Row): ConsentRecord {
  return {
    id: text(row.id),
    marketId: text(row.market_id),
    studentId: text(row.student_id),
    sourceOrgId: text(row.source_org_id),
    scope: text(row.scope) as ConsentRecord["scope"],
    grantedBy: text(row.granted_by) as ConsentRecord["grantedBy"],
    grantedOn: timestamp(row.granted_on),
    // Nullable rather than optional: open-ended is what most institutional
    // consent forms are, and it must not read as a field somebody forgot.
    expiresOn: nullableTimestamp(row.expires_on),
    status: text(row.status) as ConsentRecord["status"],
    recordedByUserId: text(row.recorded_by),
    note: optionalText(row.note),
    version: number(row.version),
  };
}

export function toFundingSource(row: Row): FundingSource {
  return {
    id: text(row.id),
    marketId: text(row.market_id),
    sponsorOrgId: text(row.sponsor_org_id),
    kind: text(row.kind) as FundingSource["kind"],
    purpose: text(row.purpose) as FundingSource["purpose"],
    programYear: text(row.program_year),
    name: text(row.name),
    allocated: dollars(row.allocated_cents),
    // `optionalDollars`, not `dollars`: a fund that does not pay by the hour
    // has no rate, and mapping that to 0 would make "unpaid hourly" and "free"
    // the same value on a screen that multiplies by it.
    ratePerHour: optionalDollars(row.rate_cents),
    status: text(row.status) as FundingSource["status"],
    openedOn: timestamp(row.opened_on),
    version: number(row.version),
  };
}

export function toFundingCommitment(row: Row): FundingCommitment {
  return {
    id: text(row.id),
    marketId: text(row.market_id),
    fundingSourceId: text(row.funding_source_id),
    studentId: text(row.student_id),
    applicationId: nullableText(row.application_id),
    amount: dollars(row.amount_cents),
    hours: row.hours === null || row.hours === undefined ? undefined : number(row.hours),
    ratePerHour: optionalDollars(row.rate_cents),
    status: text(row.status) as FundingCommitment["status"],
    authorizedOn: timestamp(row.authorized_on),
    authorizedByUserId: text(row.authorized_by),
    note: optionalText(row.note),
    version: number(row.version),
  };
}

export function toOutcome(row: Row): Outcome {
  return {
    id: text(row.id),
    marketId: text(row.market_id),
    studentId: text(row.student_id),
    employedByHost: Boolean(row.employed_by_host),
    // Nullable together. The column pair is constrained so that a place is
    // both parts or neither, and reading them the same way keeps the in-memory
    // layer and this one answering the same question.
    employmentCounty: nullableText(row.employment_county),
    employmentState: nullableText(row.employment_state),
    assertedInRegion:
      row.asserted_in_region === null || row.asserted_in_region === undefined
        ? null
        : Boolean(row.asserted_in_region),
    // `nullableText` rather than `optionalText`: the domain declares this
    // `string | null` because a learner with no application is a real case, not
    // a field somebody forgot to fill in, and `undefined` would say the
    // opposite of what the column means.
    applicationId: nullableText(row.application_id),
    kind: text(row.kind) as Outcome["kind"],
    observedOn: timestamp(row.observed_on),
    recordedOn: timestamp(row.recorded_on),
    recordedByUserId: text(row.recorded_by),
    source: text(row.source) as Outcome["source"],
    detail: optionalText(row.detail),
  };
}

export function toHostOffer(row: Row): HostOffer {
  return {
    id: text(row.id),
    marketId: text(row.market_id),
    applicationId: text(row.application_id),
    businessId: text(row.business_id),
    studentId: text(row.student_id),
    answer: text(row.answer) as HostOffer["answer"],
    recordedByUserId: text(row.recorded_by),
    recordedOn: timestamp(row.recorded_on),
    source: text(row.source) as HostOffer["source"],
    // `optionalText` rather than `nullableText`: the domain declares the note
    // optional, because an employer who answered without explaining has still
    // answered. That is not the same shape as `Outcome.applicationId`, where
    // null is a real case the type has to name.
    note: optionalText(row.note),
  };
}

export function toApplication(row: Row): Application {
  return {
    id: text(row.id),
    marketId: text(row.market_id),
    postingId: text(row.posting_id),
    studentId: text(row.student_id),
    track: text(row.track) as Application["track"],
    status: text(row.status) as Application["status"],
    furthestStatus: row.furthest_status
      ? (text(row.furthest_status) as Application["status"])
      : undefined,
    submittedOn: timestamp(row.submitted_on),
    statusSince: timestamp(row.status_since),
    matchScore: {
      score: number(row.match_score),
      algorithmVersion: text(row.match_algorithm_version),
      // `jsonb` comes back parsed; the cast is the shape contract, and a bad
      // shape here would surface as a missing label rather than a crash.
      factors: (Array.isArray(row.match_factors)
        ? row.match_factors
        : []) as MatchFactor[],
    },
    interviewSlotId: optionalText(row.interview_slot_id),
    fundingAuthorizedHours: optionalNumber(row.funding_authorized_hours),
    fundingAuthorizedRate:
      row.funding_authorized_rate_cents === null ||
      row.funding_authorized_rate_cents === undefined
        ? undefined
        : dollars(row.funding_authorized_rate_cents),
    hoursLogged: number(row.hours_logged),
    hoursApproved: number(row.hours_approved),
    deliverableSubmitted: bool(row.deliverable_submitted),
    deliverableAccepted: bool(row.deliverable_accepted),
    creditAwardId: optionalText(row.credit_award_id),
    version: number(row.version),
  };
}

export function toInterviewSlot(row: Row): InterviewSlot {
  return {
    id: text(row.id),
    marketId: text(row.market_id),
    boardId: text(row.board_id),
    startsAt: timestamp(row.starts_at),
    durationMinutes: number(row.duration_minutes),
    officerName: text(row.officer_name),
    bookedByStudentId:
      row.booked_by === null || row.booked_by === undefined ? null : text(row.booked_by),
    bookedAt: nullableTimestamp(row.booked_at),
    meetingUrl:
      row.meeting_url === null || row.meeting_url === undefined
        ? null
        : text(row.meeting_url),
    version: number(row.version),
  };
}

export function toTimeEntry(row: Row): TimeEntry {
  return {
    id: text(row.id),
    marketId: text(row.market_id),
    applicationId: text(row.application_id),
    studentId: text(row.student_id),
    businessId: text(row.business_id),
    weekStarting: dateOnly(row.week_starting),
    hours: number(row.hours),
    summary: text(row.summary),
    status: text(row.status) as TimeEntry["status"],
    submittedOn: timestamp(row.submitted_on),
    reviewedOn: optionalTimestamp(row.reviewed_on),
    reviewedByUserId: optionalText(row.reviewed_by),
    reviewNote: optionalText(row.review_note),
    version: number(row.version),
  };
}

/** `application_ids` is aggregated from `credit_award_applications`. */
export function toCreditAward(row: Row): CreditAward {
  return {
    id: text(row.id),
    marketId: text(row.market_id),
    studentId: text(row.student_id),
    collegeId: text(row.college_id),
    applicationIds: list(row.application_ids),
    creditHours: number(row.credit_hours),
    totalWorkHours: number(row.total_work_hours),
    carriedHours: number(row.carried_hours),
    status: text(row.status) as CreditAward["status"],
    courseMapping: text(row.course_mapping),
    grantedOn: nullableTimestamp(row.granted_on),
  };
}

/**
 * The audit log's id is a `bigserial`, and the domain's is a string.
 *
 * Kept as a string on this side because nothing does arithmetic on it — it is
 * a React key and an equality check — and a bigint that silently loses
 * precision at 2^53 is a worse default than a string that never can.
 */
export function toAuditEvent(row: Row): AuditEvent {
  return {
    id: text(row.id),
    marketId: text(row.market_id),
    at: timestamp(row.occurred_at),
    actorUserId: text(row.actor_user_id),
    actorRole: text(row.actor_role) as AuditEvent["actorRole"],
    entityType: text(row.entity_type) as AuditEvent["entityType"],
    entityId: text(row.entity_id),
    from: row.from_state === null || row.from_state === undefined
      ? null
      : text(row.from_state),
    to: text(row.to_state),
    reason: optionalText(row.reason),
    viaOverride: bool(row.via_override),
  };
}
