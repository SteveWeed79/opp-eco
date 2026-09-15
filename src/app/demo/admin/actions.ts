"use server";

import { awardFunds, changeAllocation } from "@/app/_actions/funding";
import { runTransition, type ActionResult } from "@/app/_actions/transition";
import { closeIntroduction, makeIntroduction } from "@/app/_actions/mentorship";
import { overrideInput, validate } from "@/services/validation";

/**
 * Administrator override.
 *
 * Unsticking stalled work is the administrator's job, so they can force any
 * transition regardless of role or guard — but never silently. The state
 * machine refuses an override without a reason, the audit record is flagged
 * `viaOverride`, and this validates the reason before the domain gets a chance
 * to, so an empty string fails with a message about the reason rather than a
 * message about the transition.
 *
 * This is the one action where the caller names both the target status and the
 * justification, which is exactly why it is separated from the ordinary
 * per-portal transitions rather than being a flag on them.
 */
export async function adminOverride(
  applicationId: unknown,
  to: unknown,
  reason: unknown,
): Promise<ActionResult> {
  const input = validate(overrideInput, { applicationId, to, reason });
  if (!input.ok) return { ok: false, error: input.error };

  return runTransition(
    "admin",
    {
      applicationId: input.data.applicationId,
      to: input.data.to,
      reason: input.data.reason,
    },
    { label: "admin.override" },
  );
}


/**
 * The administrator makes an introduction.
 *
 * Same act as the college's, and deliberately not an override: an
 * administrator introducing a student is the market operator doing the
 * operator's job, not bypassing a rule. Every check the college's path runs,
 * this one runs — the only difference is that an administrator is not confined
 * to one market.
 */
export async function adminIntroduceStudent(
  offerId: unknown,
  studentId: unknown,
): Promise<ActionResult> {
  return makeIntroduction("admin", offerId, studentId);
}

/** Close an introduction, for the same unstick-the-market reason. */
export async function adminCloseIntroduction(
  pairingId: unknown,
  to: unknown,
  note: unknown,
): Promise<ActionResult> {
  return closeIntroduction("admin", pairingId, to, note);
}

/**
 * Commit money from a fund, as the administrator.
 *
 * The administrator can spend any fund in any market — which is not an override
 * in the state-machine sense, and worth saying plainly. `canSpendFrom` grants
 * it because the operator runs the foundation whose fund it usually is, and
 * because a market whose sponsor has not acted is exactly what an operator
 * exists to unstick. Every other caller is narrowed to funds their own
 * organization sponsors.
 */
export async function adminAwardFunds(
  sourceId: string,
  studentId: string,
  applicationId: string | null,
  amount: number,
  note: string,
): Promise<ActionResult> {
  return awardFunds("admin", sourceId, studentId, applicationId, amount, note);
}

/** Change what any fund holds. Same ownership rule, same audit trail. */
export async function adminAdjustAllocation(
  sourceId: string,
  allocated: unknown,
  ratePerHour: unknown,
  reason: string,
): Promise<ActionResult> {
  return changeAllocation("admin", sourceId, allocated, ratePerHour, reason);
}
