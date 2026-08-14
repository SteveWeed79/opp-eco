"use server";

import { revalidatePath } from "next/cache";
import type { ActorRole } from "@/domain/types";
import type { ActionResult } from "@/app/_actions/transition";
import { actorForPortal } from "@/auth/session";
import {
  transitionOrganization,
  transitionPosting,
  transitionStudent,
} from "@/services/lifecycle";
import { lifecycleInput, validate } from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { drainPending } from "@/services/outbox";

/**
 * Server Actions for the three gating machines.
 *
 * The same shape as `runTransition`, and for the same reason: **the portal is
 * hardcoded per action**, never taken from the request. A caller who could
 * name their own role would be supplying their own authorization, and Server
 * Actions accept direct POSTs — the button a page did or did not render proves
 * nothing about what someone can attempt.
 *
 * The status is taken from the request, because the machine is the authority
 * on whether that move exists from where the record currently is. Everything
 * else is derived server-side.
 */

type Entity = "student" | "posting" | "organization";

const MOVERS = {
  student: transitionStudent,
  posting: transitionPosting,
  organization: transitionOrganization,
} as const;

/**
 * Pages to refresh after a move.
 *
 * Generous on purpose: verifying a student changes the college's queue and the
 * student's own portal, and vetting an organization changes what every portal
 * will let that organization do. A missed revalidation shows a stale queue to
 * the person who just acted on it, which reads as the click not working.
 */
const AFFECTED: Record<Entity, string[]> = {
  student: ["/college", "/student", "/admin"],
  posting: ["/college", "/business", "/student", "/admin"],
  organization: ["/admin", "/business", "/college", "/board"],
};

async function move(
  entity: Entity,
  portal: ActorRole,
  raw: { id: unknown; to: unknown; reason?: unknown },
): Promise<ActionResult> {
  const input = validate(lifecycleInput, raw);
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal(portal);

  const limit = checkRateLimit(
    callerKey(`lifecycle:${entity}`, actor.user.id),
    LIMITS.mutation,
  );
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", { action: entity, userId: actor.user.id });
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const result = await MOVERS[entity](
    actor,
    input.data.id,
    // The machine validates the target against its own table; an unknown
    // status is refused there rather than trusted here.
    input.data.to as never,
    input.data.reason,
  );

  if (!result.ok) {
    logger.warn("lifecycle.refused", { entity, to: input.data.to, code: result.code });
    return { ok: false, error: result.error };
  }

  logger.info("lifecycle.moved", {
    entity,
    id: input.data.id,
    to: input.data.to,
    viaOverride: result.viaOverride,
  });

  await drainPending();
  for (const path of AFFECTED[entity]) revalidatePath(path);
  return { ok: true };
}

/** The college verifies, rejects, or reactivates a student on its roster. */
export async function studentLifecycle(
  id: unknown,
  to: unknown,
  reason?: unknown,
): Promise<ActionResult> {
  return move("student", "college", { id, to, reason });
}

/** The college reviews, publishes, or sends back a posting. */
export async function postingLifecycleAsCollege(
  id: unknown,
  to: unknown,
  reason?: unknown,
): Promise<ActionResult> {
  return move("posting", "college", { id, to, reason });
}

/** The employer submits, resubmits, fills, reopens, or closes their own. */
export async function postingLifecycleAsBusiness(
  id: unknown,
  to: unknown,
  reason?: unknown,
): Promise<ActionResult> {
  return move("posting", "business", { id, to, reason });
}

/** The administrator vets an organization. */
export async function organizationLifecycle(
  id: unknown,
  to: unknown,
  reason?: unknown,
): Promise<ActionResult> {
  return move("organization", "admin", { id, to, reason });
}
