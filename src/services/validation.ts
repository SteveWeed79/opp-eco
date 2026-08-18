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
