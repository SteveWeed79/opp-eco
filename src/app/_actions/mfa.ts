"use server";

import { actorForPortal } from "@/auth/session";
import { attemptWrite, type ActionResult } from "@/app/_actions/transition";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import {
  beginEnrolment,
  confirmEnrolment,
  removeEnrolment,
  type EnrolmentOffer,
} from "@/services/mfa";

/**
 * Enrolling a second factor.
 *
 * Scoped to the administrator, because that is the role a second factor is
 * expected of — see `requiresSecondFactor`. Everyone else can already sign in
 * with a code to an address their organisation controls, and adding a factor
 * nobody asked for to a learner's account is friction without a matching risk.
 */

export async function startEnrolment(): Promise<
  ActionResult & { offer?: EnrolmentOffer }
> {
  const actor = await actorForPortal("admin");
  const result = await attemptWrite(() => beginEnrolment(actor));
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, offer: "offer" in result ? result.offer : undefined };
}

export async function finishEnrolment(
  code: unknown,
): Promise<ActionResult & { recoveryCodes?: string[] }> {
  const actor = await actorForPortal("admin");

  // The enrolment step is guessable in exactly the way sign-on is, so it gets
  // the same bucket.
  const limit = checkRateLimit(callerKey("mfaEnrol", actor.user.id), LIMITS.signIn);
  if (!limit.ok) {
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  if (typeof code !== "string") {
    return { ok: false, error: "Enter the code from your authenticator." };
  }

  const result = await attemptWrite(() => confirmEnrolment(actor, code));
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    // Shown once. They are stored as hashes, so there is no second chance to
    // display them and the screen says so.
    recoveryCodes: "recoveryCodes" in result ? result.recoveryCodes : undefined,
  };
}

export async function dropEnrolment(): Promise<ActionResult> {
  const actor = await actorForPortal("admin");
  await attemptWrite(async () => {
    await removeEnrolment(actor);
    return { ok: true as const };
  });
  return { ok: true };
}
