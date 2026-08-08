"use server";

import { runTransition, type ActionResult } from "@/app/_actions/transition";
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
