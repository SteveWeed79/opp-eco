/**
 * The shared body of the chase-queue nudge.
 *
 * Not a Server Action itself, for the reason the rest of `_actions` is not: the
 * portal exports its own `"use server"` wrapper with the role hardcoded, so a
 * direct POST cannot claim to be an administrator.
 *
 * There is only one wrapper — the administrator's — and the service refuses
 * every other role again regardless. A guard in one place is a guard somebody
 * can route around.
 */

import { revalidatePath } from "next/cache";
import { actorForPortal } from "@/auth/session";
import { attemptWrite, type ActionResult } from "@/app/_actions/transition";
import { sendFollowUpNudge } from "@/services/outreach";
import { sendNudgeInput, validate } from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { drainPending } from "@/services/outbox";
import { logger } from "@/services/logging";
import { PORTAL_PATH } from "@/routes";

export async function nudgeForFollowUp(
  applicationId: unknown,
  audience: unknown,
): Promise<ActionResult> {
  const input = validate(sendNudgeInput, { applicationId, audience });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal("admin");

  // Rate limited like every other write, and it earns it more than most: this
  // is the one action whose entire effect is an email to somebody outside the
  // building, so a stuck button is a stuck button that mails an employer
  // repeatedly.
  const limit = checkRateLimit(callerKey("nudge", actor.user.id), LIMITS.mutation);
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", { action: "nudge", userId: actor.user.id });
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const result = await attemptWrite(() =>
    sendFollowUpNudge(actor, input.data).then((r) =>
      r.ok ? { ok: true as const, created: r } : r,
    ),
  );

  if (!result.ok) {
    logger.warn("followup.nudge_refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  // Drained here rather than left for the scheduled sweep. The administrator
  // pressed a button and is watching; a message that sits in a queue for the
  // next cron tick is a message they will press again.
  await drainPending();

  revalidatePath(PORTAL_PATH.admin);
  return { ok: true };
}
