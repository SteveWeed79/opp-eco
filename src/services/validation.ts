/**
 * Input validation at the trust boundary.
 *
 * Server Actions accept direct POSTs with arbitrary payloads — the UI is not a
 * gate. `attemptTransition` guards *authorization*, but it assumes it is being
 * handed the shapes it expects; nothing previously checked that an
 * `applicationId` was a string, or that an hour cap was a positive integer
 * rather than `NaN` or a 40-megabyte string.
 *
 * These schemas run before anything else in every action. Validation failures
 * are returned as values rather than thrown, because a malformed request is an
 * expected condition, not an exceptional one.
 */

import { z } from "zod";
import { MAX_HOURS_PER_WEEK } from "@/domain/timesheet";

/**
 * Entity identifiers are opaque slugs. Bounding the length and character set
 * keeps a hostile id out of logs, audit records, and error messages, and costs
 * nothing legitimate.
 */
const id = z
  .string()
  .min(1, "Required")
  .max(64, "Too long")
  .regex(/^[a-zA-Z0-9_-]+$/, "Contains unexpected characters");

/**
 * Reasons are written to the audit log and read back by people. Long enough
 * for a real explanation, bounded so one request cannot bloat the log.
 */
const reason = z.string().trim().min(1).max(2000);

export const bookInterviewInput = z.object({
  applicationId: id,
  slotId: id,
});

export const transitionInput = z.object({
  applicationId: id,
  to: z.string().min(1).max(64),
  reason: reason.optional(),
});

export const fundingAuthorizationInput = z.object({
  applicationId: id,
  // An hour cap commits real money, so it must be a whole positive number
  // with a sane ceiling — not NaN, not negative, not a typo with an extra zero.
  hours: z.number().int().positive().max(2000),
  ratePerHour: z.number().int().positive().max(200),
  reason: reason.optional(),
});

export const overrideInput = z.object({
  applicationId: id,
  to: z.string().min(1).max(64),
  // Overrides always carry a reason; the state machine refuses without one,
  // and this catches an empty string before it gets that far.
  reason,
});

/**
 * Free text that other people read: a posting title, a description, a
 * deliverable. Trimmed and bounded — an unbounded description is a storage
 * and rendering problem, and a blank one is a posting nobody can answer.
 */
const shortText = z.string().trim().min(1).max(200);
const longText = z.string().trim().min(1).max(5000);

/** A skill tag. Bounded and pattern-checked so tags stay a vocabulary. */
const skill = z.string().trim().min(1).max(40);

export const applyInput = z.object({
  postingId: id,
});

/**
 * A move on one of the three gating machines.
 *
 * The target status is a bounded string rather than an enum per entity: the
 * machine is the authority on whether the move exists, and duplicating its
 * vocabulary here would give two places to update and one to forget.
 */
export const lifecycleInput = z.object({
  id,
  to: z.string().min(1).max(64),
  reason: reason.optional(),
});

/**
 * An introduction: which mentor, which student.
 *
 * Two ids and nothing else. The market, the employer and the introducer are
 * all derived server-side — a caller who could name the introducer would be
 * naming who vouched for a student in front of an adult.
 */
export const introduceInput = z.object({
  offerId: id,
  studentId: id,
});

/**
 * Closing an introduction. The note is required, not optional: see
 * `recordMentorshipOutcome`.
 */
export const introductionOutcomeInput = z.object({
  id,
  to: z.enum(["met", "declined"]),
  note: reason,
});

/**
 * Recording a consent.
 *
 * `sourceOrgId` is accepted from the caller and then checked against them,
 * rather than being taken from the acting membership: an administrator can
 * record on a college's behalf, and the record has to name the college either
 * way. `grantedBy` is likewise accepted rather than derived — whose signature
 * was required is a question for a registrar, not a schema.
 */
export const recordConsentInput = z.object({
  studentId: id,
  sourceOrgId: id,
  scope: z.enum(["education_record", "workforce_data", "program_participation"]),
  grantedBy: z.enum(["learner", "parent_guardian"]),
  note: z.string().trim().min(1).max(1000).optional(),
});

export const withdrawConsentInput = z.object({ id, reason });

/** Purging a learner's identity. Irreversible, so the reason is required. */
export const purgeLearnerInput = z.object({ id, reason });

/**
 * Who gets an account, and under what address.
 *
 * The address is bounded and lightly shaped here — one `@`, something either
 * side, no whitespace — and the rule that actually matters is checked in the
 * service, where the organization's declared domains are known. This is the
 * trust boundary catching a 40-kilobyte string, not the policy.
 */
const workAddress = z
  .string()
  .trim()
  .min(3, "Enter a work email address")
  .max(254, "That address is too long")
  .regex(/^[^\s@]+@[^\s@]+$/, "That is not an email address");

export const addMemberInput = z.object({
  organizationId: id,
  name: z.string().trim().min(1, "Enter the person's name").max(120, "That name is too long"),
  email: workAddress,
});

/**
 * Moving an address carries a reason for the same reason an override does: it
 * is the one write that can hand an account to somebody else, and an audit
 * entry that cannot say why is the entry nobody can act on a year later.
 */
export const changeAddressInput = z.object({
  currentEmail: workAddress,
  newEmail: workAddress,
  reason,
});

/**
 * Changing what a fund holds.
 *
 * The reason is required rather than optional, unlike most reasons here. An
 * allocation that moved with nothing recorded about why is the one figure a
 * funder will certainly ask about, and the moment to capture it is the moment
 * it changes.
 *
 * Both figures are bounded: a whole positive number with a ceiling, so a
 * fat-fingered extra zero is refused before it becomes a budget somebody plans
 * against.
 */
export const adjustFundingInput = z.object({
  sourceId: id,
  allocated: z.number().int().min(0).max(100_000_000).optional(),
  ratePerHour: z.number().int().positive().max(500).optional(),
  reason,
});

/** Drawing on a fund. The rate and the market are derived server-side. */
export const commitFundsInput = z.object({
  sourceId: id,
  studentId: id,
  // Nullable rather than optional, matching the domain: a grant reaching a
  // learner with no placement is a real case, and an absent key and an explicit
  // null must not mean different things at the trust boundary.
  applicationId: id.nullable(),
  amount: z.number().int().positive().max(1_000_000),
  note: z.string().trim().min(1).max(1000).optional(),
});

export const releaseCommitmentInput = z.object({
  id,
  reason,
});

/**
 * A follow-up observation.
 *
 * `applicationId` is nullable rather than optional, matching the domain: a
 * learner reached some way other than a placement is a real case, and an
 * absent key and an explicit null must not mean different things at the trust
 * boundary.
 *
 * The kind is an enum here as well as in the database, because the whole value
 * of an outcome taxonomy is that nobody can invent a seventh category that
 * reporting then has to guess about. `source` is deliberately **not** accepted:
 * it is frozen from the acting membership, and a caller who could name it could
 * file their own guess as a college's finding.
 */
export const recordOutcomeInput = z.object({
  studentId: id,
  applicationId: id.nullable(),
  kind: z.enum([
    "employed",
    "continued_education",
    "entered_training",
    "still_seeking",
  ]),
  employedByHost: z.boolean().optional(),
  /**
   * Where they went to work.
   *
   * Bounded and lightly shaped here; whether the county is one the market
   * actually covers is not validated at all, deliberately. A learner can take
   * a job anywhere, and the point of capturing the place is that the platform
   * decides what it counts as rather than refusing what it did not expect.
   *
   * The state is two letters because that is what makes a county name
   * unambiguous — Kansas and Missouri each have a Jackson County.
   */
  employmentCounty: z.string().trim().min(1).max(80).optional(),
  employmentState: z
    .string()
    .trim()
    .length(2, "Use the two-letter state code")
    .regex(/^[A-Za-z]{2}$/, "Use the two-letter state code")
    .optional(),
  observedOn: z.string().min(1).max(40),
  // Optional, unlike the note closing an introduction. A college that knows
  // only "she is working locally" should be able to say so — demanding the
  // employer's name as the price of recording the fact is how a follow-up
  // queue goes unworked.
  detail: z.string().trim().min(1).max(1000).optional(),
});

/**
 * What the host did at the end of a placement.
 *
 * Three fields, and two of them are the whole request: which placement, and
 * what happened. Everything else about the record — the employer, the learner,
 * the market, the role that answered — is derived server-side from the
 * placement and the acting membership, so there is nothing here a caller could
 * use to file somebody else's hiring decision.
 *
 * `source` is deliberately absent for the same reason it is absent from
 * `recordOutcomeInput`, and it matters more here: a caller who could name the
 * source could file their own guess as an employer's firsthand answer, which
 * is precisely the claim this record exists to be trusted about.
 */
export const recordHostOfferInput = z.object({
  applicationId: id,
  answer: z.enum(["accepted", "declined", "none"]),
  // Never required. An employer who answered without explaining has still
  // answered, and demanding a sentence as the price of a click is how a
  // one-click question becomes a form nobody finishes.
  note: z.string().trim().min(1).max(1000).optional(),
});

/**
 * A market's new boundary.
 *
 * `source` is required, unlike almost every other note in this file. A
 * redesignation moves every figure reported after it, and "why did this
 * market's retention rate change in 2027" is a question somebody will ask —
 * the answer has to be in the record rather than in somebody's memory.
 */
export const redefineRegionInput = z.object({
  marketId: id,
  state: z
    .string()
    .trim()
    .length(2, "Use the two-letter state code")
    .regex(/^[A-Za-z]{2}$/, "Use the two-letter state code"),
  // Bounded, not validated against a real gazetteer. The platform decides what
  // a county name *counts as* rather than refusing one it did not expect —
  // the same stance `recordOutcomeInput` takes about where somebody works.
  counties: z.array(z.string().trim().min(1).max(80)).min(1).max(120),
  effectiveFrom: z.string().min(1).max(40),
  source: z.string().trim().min(1).max(500),
});

/**
 * A nudge from the chase queue.
 *
 * Two fields, and there is deliberately no third. The message itself is a
 * template — see `outreach.ts` for why a compose box is the one thing this
 * particular action must not have.
 */
export const sendNudgeInput = z.object({
  applicationId: id,
  audience: z.enum(["employer", "learner"]),
});

/**
 * A week of logged hours.
 *
 * The hour bound is `MAX_HOURS_PER_WEEK` and exists to catch a fat-fingered
 * 400 before it reaches a reimbursement claim, not to legislate overtime.
 * Half-hours are allowed — a real timesheet has them — but nothing finer,
 * because a claim of 16.37 hours is a unit error somewhere upstream.
 */
export const logHoursInput = z.object({
  applicationId: id,
  weekStarting: z.string().min(1).max(40),
  hours: z
    .number()
    .positive()
    .max(MAX_HOURS_PER_WEEK)
    .refine((h) => Number.isInteger(h * 2), {
      message: "Log hours to the nearest half hour",
    }),
  summary: z.string().trim().min(1).max(1000),
});

/**
 * A supervisor's decision on a week.
 *
 * The note is required on rejection and that rule lives in the service rather
 * than here: it depends on the value of another field, and a schema that
 * enforced it would still have to be re-checked server-side where the entry is
 * actually read. One place, not two.
 */
export const reviewHoursInput = z.object({
  entryId: id,
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(2000).optional(),
});

/**
 * A new posting.
 *
 * The two tracks have genuinely different shapes — an hourly standard
 * internship and a fixed-fee micro project — so this validates the union
 * rather than one loose object with every field optional. A micro posting with
 * a `wagePerHour` is not a slightly wrong standard posting; it is a caller
 * who has misunderstood the model.
 */
const postingCommon = {
  title: shortText,
  description: longText,
  county: shortText,
  skillsRequired: z.array(skill).max(20).default([]),
  skillsPreferred: z.array(skill).max(20).default([]),
  openings: z.number().int().positive().max(50),
};

export const postingInput = z.discriminatedUnion("track", [
  z.object({
    ...postingCommon,
    track: z.literal("standard"),
    wagePerHour: z.number().int().positive().max(200),
    hoursPerWeek: z.number().int().positive().max(40),
    weeks: z.number().int().positive().max(52),
    creditHours: z.number().int().positive().max(12),
    supervisorName: shortText,
  }),
  z.object({
    ...postingCommon,
    track: z.literal("micro"),
    // Parker Dewey's model: a scoped project of 5–40 hours for a fixed fee.
    // The bounds are the model, not arbitrary limits — a 200-hour "micro"
    // project is a standard internship avoiding the board.
    projectFee: z.number().int().positive().max(10_000),
    estimatedHours: z.number().int().min(5).max(40),
    deliverable: longText,
    dueWithinDays: z.number().int().positive().max(180),
  }),
]);

/**
 * An offer to mentor students.
 *
 * Notably short next to `postingInput`, and that is the shape of the thing
 * rather than a first pass: there is no wage to bound, no hour cap to keep out
 * of a reimbursement claim, and no fee. What is left is who shows up, what
 * they can talk about, and how many students they will take.
 *
 * `capacity` is bounded generously because a group session legitimately holds a
 * class, and at 1 because an offer to mentor nobody is a contradiction rather
 * than a pause — pausing is a state the machine already has.
 */
export const mentorshipOfferInput = z.object({
  format: z.enum(["one_to_one", "job_shadow", "portfolio_review", "group_session"]),
  mentorName: shortText,
  mentorRole: shortText,
  topics: z.array(skill).max(20).default([]),
  description: longText,
  capacity: z.number().int().positive().max(50),
});

export type ValidationFailure = { ok: false; error: string; code: "invalid" };

/**
 * Run a schema and flatten a failure into the same result shape actions
 * already return, so a caller handles one kind of outcome.
 */
export function validate<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { ok: true; data: T } | ValidationFailure {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };

  const first = result.error.issues[0];
  const field = first?.path.join(".");
  return {
    ok: false,
    code: "invalid",
    // Names the offending field so the message is actionable rather than
    // "invalid input".
    error: field ? `${field}: ${first.message}` : (first?.message ?? "Invalid request"),
  };
}

/**
 * Raising a problem about a placement.
 *
 * The role is deliberately absent: it comes from the actor, because who was
 * speaking is part of what was said and a caller must not be able to file a
 * complaint in somebody else's voice. Same reasoning as `recordHostOfferInput`.
 *
 * `longText` rather than `shortText` for the summary, and the floor that makes
 * it useful lives in `raiseBlockReason` rather than here — the schema says what
 * shape the field is, and the domain says what makes it worth acting on.
 */
export const raiseEscalationInput = z.object({
  applicationId: id,
  kind: z.enum(["safety", "pay", "hours", "supervision", "academic", "other"]),
  summary: longText,
});

/** Closing one out. The resolution is required, which the domain repeats. */
export const resolveEscalationInput = z.object({
  escalationId: id,
  resolution: reason,
});
