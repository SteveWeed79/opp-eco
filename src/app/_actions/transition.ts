/**
 * The shared body of every portal's transition action.
 *
 * Not a Server Action itself — deliberately. Each portal exports its own
 * `"use server"` wrapper that calls this with its role **hardcoded**, because
 * the role must never be something the caller supplies. A single generic action
 * taking `{ portal }` from the client would let anyone act as a workforce board
 * by posting a different string, and Server Actions accept direct POSTs.
 *
 * So: one action per portal, each pinned to one role, all sharing this.
 *
 * The other half of the same rule is that the client names a *target status*
 * and nothing else. It never supplies a patch. Anything a transition needs to
 * write — an hour cap, a slot id — is derived here from server state or read
 * from a field-specific validated schema. Otherwise `to: "funding_authorized"`
 * would arrive with whatever `fundingAuthorizedHours` the caller fancied.
 */

import { revalidatePath } from "next/cache";
import type { ActorRole, Application } from "@/domain/types";
import { actorForPortal } from "@/auth/session";
import { executeTransition, type TransitionCommand } from "@/services/transitions";
import { transitionInput, validate } from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { drainPending } from "@/services/outbox";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Every portal reads applications, so every portal's view can go stale. */
const PORTAL_PATHS = ["/admin", "/student", "/business", "/college", "/board"];

export interface TransitionRequest {
  applicationId: unknown;
  to: unknown;
  reason?: unknown;
}

/**
 * Run a status transition on behalf of one portal.
 *
 * `role` is supplied by the calling module, never by the request.
 */
export async function runTransition(
  role: ActorRole,
  request: TransitionRequest,
  extras?: {
    /**
     * Fields this transition writes, computed by the caller from server state.
     * Never forwarded from the request — see the note at the top of this file.
     */
    patch?: Partial<Application>;
    sideEffects?: TransitionCommand["sideEffects"];
    notifications?: TransitionCommand["notifications"];
    /** Names the action in logs and rate-limit buckets. */
    label?: string;
  },
): Promise<ActionResult> {
  const input = validate(transitionInput, request);
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal(role);
  const label = extras?.label ?? `transition.${input.data.to}`;

  // Per action *and* per caller, so exhausting one bucket does not lock a user
  // out of everything else they can legitimately do.
  const limit = checkRateLimit(callerKey(label, actor.user.id), LIMITS.mutation);
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", { action: label, userId: actor.user.id });
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const result = await executeTransition(actor, {
    applicationId: input.data.applicationId,
    // Cast is safe because the state machine rejects any status it does not
    // recognise — an unknown string finds no transition and is refused. The
    // schema bounds the length; the domain decides the meaning.
    to: input.data.to as Application["status"],
    reason: input.data.reason,
    patch: extras?.patch,
    sideEffects: extras?.sideEffects,
    notifications: extras?.notifications,
  });

  if (!result.ok) {
    logger.warn("transition.refused", {
      action: label,
      applicationId: input.data.applicationId,
      code: result.code,
    });
    return { ok: false, error: result.error };
  }

  logger.info("transition.applied", {
    action: label,
    applicationId: input.data.applicationId,
    to: input.data.to,
  });

  // After the commit, never inside it. A failure here leaves a durable state
  // change and an undelivered message, which is recoverable; the reverse is
  // not.
  await drainPending();

  for (const path of PORTAL_PATHS) revalidatePath(path);
  return { ok: true };
}
