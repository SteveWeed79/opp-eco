/**
 * The shared body of the redefine action.
 *
 * Not a Server Action itself, for the reason the rest of `_actions` is not: the
 * portal exports its own `"use server"` wrapper with the role hardcoded, so a
 * direct POST cannot claim to be an administrator.
 *
 * There is only one wrapper, and the service refuses every other role again
 * regardless. A guard in one place is a guard somebody can route around.
 */

import { revalidatePath } from "next/cache";
import { actorForPortal } from "@/auth/session";
import { attemptWrite, type ActionResult } from "@/app/_actions/transition";
import { redefineRegion } from "@/services/region";
import { redefineRegionInput, validate } from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { PORTAL_PATH } from "@/routes";

/**
 * Every portal that renders a retention figure or a county list.
 *
 * Wider than most, and it has to be: a boundary is read by the college's
 * follow-up form, the learner's own, and the administrator's report. A stale
 * county list on one of them is a form offering the wrong answers.
 */
const AFFECTED = [PORTAL_PATH.admin, PORTAL_PATH.college, PORTAL_PATH.student];

export async function redefineMarketRegion(
  marketId: unknown,
  state: unknown,
  counties: unknown,
  effectiveFrom: unknown,
  source: unknown,
): Promise<ActionResult> {
  const input = validate(redefineRegionInput, {
    marketId,
    state,
    // A form posts one comma-separated string; the service takes a list. Split
    // here rather than in the schema so the schema describes the shape the
    // domain wants rather than the shape a browser happens to send.
    counties:
      typeof counties === "string"
        ? counties.split(",").map((c) => c.trim()).filter(Boolean)
        : counties,
    effectiveFrom,
    source,
  });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal("admin");

  const limit = checkRateLimit(callerKey("region", actor.user.id), LIMITS.mutation);
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", { action: "region", userId: actor.user.id });
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const result = await attemptWrite(() =>
    redefineRegion(actor, input.data).then((r) =>
      r.ok ? { ok: true as const, created: r.created } : r,
    ),
  );

  if (!result.ok) {
    logger.warn("region.redefine_refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}
