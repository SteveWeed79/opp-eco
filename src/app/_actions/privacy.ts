/**
 * The shared body of the consent and retention actions.
 *
 * Not Server Actions themselves, for the reason `transition.ts` is not: each
 * portal exports its own `"use server"` wrapper with its role **hardcoded**.
 *
 * Who may actually do either is decided in the domain, and the two rules point
 * in opposite directions on purpose. Consent is the *institution's* paperwork
 * about its own records, so ownership decides it. A purge is the *platform*
 * discharging a statutory obligation across every institution in a market, and
 * it is irreversible, so it stays on the administrator's desk alone.
 */

import { revalidatePath } from "next/cache";
import type { ActorRole } from "@/domain/types";
import { actorForPortal } from "@/auth/session";
import { attemptWrite, type ActionResult } from "@/app/_actions/transition";
import { recordConsent, withdrawConsent } from "@/services/consent";
import { purgeLearnerIdentity } from "@/services/retention";
import {
  purgeLearnerInput,
  recordConsentInput,
  validate,
  withdrawConsentInput,
} from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { PORTAL_PATH } from "@/routes";

/**
 * Consent changes what an employer sees, so its portal is on the list too.
 */
const AFFECTED = [
  PORTAL_PATH.college,
  PORTAL_PATH.admin,
  PORTAL_PATH.business,
  PORTAL_PATH.student,
];

async function guard(role: ActorRole, bucket: string) {
  const actor = await actorForPortal(role);
  const limit = checkRateLimit(callerKey(bucket, actor.user.id), LIMITS.mutation);
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", { action: bucket, userId: actor.user.id });
    return {
      actor,
      refusal: {
        ok: false as const,
        error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
      },
    };
  }
  return { actor, refusal: null };
}

export async function addConsent(
  role: ActorRole,
  studentId: unknown,
  sourceOrgId: unknown,
  scope: unknown,
  grantedBy: unknown,
  note: unknown,
): Promise<ActionResult> {
  const input = validate(recordConsentInput, {
    studentId,
    sourceOrgId,
    scope,
    grantedBy,
    note: note === "" || note === null ? undefined : note,
  });
  if (!input.ok) return { ok: false, error: input.error };

  const { actor, refusal } = await guard(role, "consent.record");
  if (refusal) return refusal;

  const result = await attemptWrite(() =>
    recordConsent(actor, { ...input.data, expiresOn: null }).then((r) =>
      r.ok ? { ok: true as const, created: r.updated } : r,
    ),
  );

  if (!result.ok) {
    logger.warn("consent.refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  logger.info("consent.recorded", { scope: input.data.scope });
  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}

export async function revokeConsent(
  role: ActorRole,
  consentId: unknown,
  reason: unknown,
): Promise<ActionResult> {
  const input = validate(withdrawConsentInput, { id: consentId, reason });
  if (!input.ok) return { ok: false, error: input.error };

  const { actor, refusal } = await guard(role, "consent.withdraw");
  if (refusal) return refusal;

  const result = await attemptWrite(() =>
    withdrawConsent(actor, input.data.id, input.data.reason).then((r) =>
      r.ok ? { ok: true as const, created: r.updated } : r,
    ),
  );

  if (!result.ok) return { ok: false, error: result.error };

  logger.info("consent.withdrawn", { consentId: input.data.id });
  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}

export async function purgeLearner(
  role: ActorRole,
  studentId: unknown,
  reason: unknown,
): Promise<ActionResult> {
  const input = validate(purgeLearnerInput, { id: studentId, reason });
  if (!input.ok) return { ok: false, error: input.error };

  const { actor, refusal } = await guard(role, "retention.purge");
  if (refusal) return refusal;

  const result = await attemptWrite(() =>
    purgeLearnerIdentity(actor, input.data.id, input.data.reason).then((r) =>
      r.ok ? { ok: true as const, created: r.updated } : r,
    ),
  );

  if (!result.ok) {
    logger.warn("retention.purge_refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  logger.info("retention.purged", { studentId: input.data.id });
  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}
