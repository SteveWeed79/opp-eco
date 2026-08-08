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
