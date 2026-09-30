"use server";

import { registerLearner } from "@/services/registration";
import { registerLearnerInput, validate } from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";

export interface RegisterResult {
  ok: boolean;
  error?: string;
}

/**
 * Register a learner.
 *
 * **No actor, which is the point** — this is the one write in the application
 * reachable by somebody with no account, so everything that would normally be
 * decided by a session is decided by the data instead: the college's own email
 * domains say who may claim to be their learner, and the market's stage says
 * whether anybody may at all.
 *
 * Rate-limited on the address rather than on a user id, because there is no
 * user yet. That is a weaker key — an attacker varies it freely — and it is
 * aimed at the accident rather than the attack: a form submitted five times
 * because the page felt slow. The real cost ceiling is that a registration
 * writes nothing an attacker can read back, and that a duplicate is
 * indistinguishable from a success.
 */
export async function register(form: FormData): Promise<RegisterResult> {
  const input = validate(registerLearnerInput, {
    name: form.get("name"),
    email: form.get("email"),
    collegeId: form.get("collegeId"),
  });
  if (!input.ok) return { ok: false, error: input.error };

  const limit = checkRateLimit(
    callerKey("register", input.data.email.toLowerCase()),
    LIMITS.mutation,
  );
  if (!limit.ok) {
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const result = await registerLearner(input.data);
  if (!result.ok) {
    // The college is logged and the address is not: a refused registration is
    // the thing somebody reports, and a log of addresses people typed into a
    // public form is a list worth nobody holding.
    logger.warn("registration.refused", { collegeId: input.data.collegeId });
    return { ok: false, error: result.error };
  }
  return { ok: true };
}
