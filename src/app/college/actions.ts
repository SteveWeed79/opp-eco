"use server";

import { runTransition, type ActionResult } from "@/app/_actions/transition";

/**
 * College-side transitions: submitting for credit, granting it, denying it,
 * ending a placement early, closing.
 *
 * **What this deliberately does not do.** Granting credit moves the
 * application's status and writes the audit record; it does not construct a
 * `CreditAward`. Building one means deciding which completed projects an award
 * consumes and what happens to hours left over — micro-internships are
 * indivisible, so covering 90 hours can take 120 hours of work, and the
 * surplus has to go somewhere. `buildCreditAward` implements one answer, and
 * `saveCreditAward` is waiting on the UnitOfWork to persist it.
 *
 * That is the open credit-stacking question (Q21 in docs/user-story.md), and
 * it is a policy decision the college and the administrator have to make, not
 * one to settle inside a Server Action because it was convenient. Wiring the
 * status transition is correct now and does not prejudge it; the award is one
 * `sideEffects` callback away once the rule is decided.
 */
export async function collegeTransition(
  applicationId: unknown,
  to: unknown,
  reason?: unknown,
): Promise<ActionResult> {
  return runTransition("college", { applicationId, to, reason });
}
