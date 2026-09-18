/**
 * The shared body of the escalation actions.
 *
 * Not a Server Action itself, for the reason `outcome.ts` and `transition.ts`
 * are not: each portal exports its own `"use server"` wrapper with its role
 * **hardcoded**. A single action taking a role from the request would let
 * anybody file a complaint in somebody else's voice, and Server Actions accept
 * direct POSTs.
 *
 * Who may raise one is everybody, which is the point — the check that matters
 * is not on the role but on the placement, and it is the repository's: an actor
 * naming an application they cannot see is refused by `applications.find`
 * before this file has an opinion.
 */

import { revalidatePath } from "next/cache";
import type { ActorRole } from "@/domain/types";
import { actorForPortal } from "@/auth/session";
import { attemptWrite, type ActionResult } from "@/app/_actions/transition";
import {
  acknowledgeEscalation,
  raiseEscalation,
  resolveEscalation,
  withdrawEscalation,
} from "@/services/escalation";
import { raiseEscalationInput, resolveEscalationInput, validate } from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { PORTAL_PATH } from "@/routes";

/**
 * Only two surfaces change, and one of them is the point.
 *
 * The administrator's queue gains a row, and the raiser's own portal shows what
 * they reported. Nothing else is revalidated, because nothing else can see it —
 * revalidating the employer's page for an escalation raised about them would be
 * work done to change nothing, and a reviewer reading this list should be able
 * to see the visibility rule reflected in it.
 */
const AFFECTED = [PORTAL_PATH.admin];

export async function raiseProblem(
  role: ActorRole,
  applicationId: unknown,
  kind: unknown,
  summary: unknown,
): Promise<ActionResult> {
  const input = validate(raiseEscalationInput, { applicationId, kind, summary });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal(role);

  const limit = checkRateLimit(callerKey("escalation", actor.user.id), LIMITS.mutation);
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", { action: "escalation", userId: actor.user.id });
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const result = await attemptWrite(() => raiseEscalation(actor, input.data));
  if (!result.ok) {
    logger.warn("escalation.refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  // The kind and never the summary, for the same reason the audit entry omits
  // it: a log is read by people who cannot read the report.
  logger.info("escalation.raised", {
    escalationId: result.updated.id,
    kind: result.updated.kind,
    role,
  });

  for (const path of [...AFFECTED, PORTAL_PATH[role]]) revalidatePath(path);
  return { ok: true };
}

/** The raiser takes their own back. Their portal and the queue both change. */
export async function withdrawProblem(
  role: ActorRole,
  escalationId: unknown,
): Promise<ActionResult> {
  if (typeof escalationId !== "string" || !escalationId) {
    return { ok: false, error: "Which report?" };
  }
  const actor = await actorForPortal(role);
  const result = await attemptWrite(() => withdrawEscalation(actor, escalationId));
  if (!result.ok) {
    logger.warn("escalation.refused", { code: result.code });
    return { ok: false, error: result.error };
  }
  for (const path of [...AFFECTED, PORTAL_PATH[role]]) revalidatePath(path);
  return { ok: true };
}

/**
 * The administrator picks one up.
 *
 * No role parameter: this one genuinely is the administrator's alone, so there
 * is nothing for a caller to assert and the wrapper that exports it lives in
 * the admin portal.
 */
export async function acknowledgeProblem(escalationId: unknown): Promise<ActionResult> {
  if (typeof escalationId !== "string" || !escalationId) {
    return { ok: false, error: "Which report?" };
  }
  const actor = await actorForPortal("admin");
  const result = await attemptWrite(() => acknowledgeEscalation(actor, escalationId));
  if (!result.ok) {
    logger.warn("escalation.refused", { code: result.code });
    return { ok: false, error: result.error };
  }
  logger.info("escalation.acknowledged", { escalationId });
  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}

/** The administrator closes one, saying what was done about it. */
export async function resolveProblem(
  escalationId: unknown,
  resolution: unknown,
): Promise<ActionResult> {
  const input = validate(resolveEscalationInput, { escalationId, resolution });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal("admin");
  const result = await attemptWrite(() =>
    resolveEscalation(actor, input.data.escalationId, input.data.resolution),
  );
  if (!result.ok) {
    logger.warn("escalation.refused", { code: result.code });
    return { ok: false, error: result.error };
  }
  logger.info("escalation.resolved", { escalationId: input.data.escalationId });
  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}
