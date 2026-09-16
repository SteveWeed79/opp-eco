/**
 * The shared body of the funding actions.
 *
 * Not a Server Action itself, for the reason `transition.ts` is not: each
 * portal exports its own `"use server"` wrapper with its role **hardcoded**. A
 * single action taking a role from the request would let anyone move money by
 * posting a different string, and Server Actions accept direct POSTs.
 *
 * The role is not what authorizes any of this, though. Who may spend a fund is
 * ownership — `canSpendFrom` in the domain — because "the board may commit"
 * stops being true the moment a market has two boards, and "the college may
 * commit" would let one college draw on another institution's scholarship. The
 * services check it again on every path below.
 */

import { revalidatePath } from "next/cache";
import type { ActorRole } from "@/domain/types";
import { actorForPortal } from "@/auth/session";
import { attemptWrite, type ActionResult } from "@/app/_actions/transition";
import {
  adjustFundingSource,
  commitFunds,
  releaseCommitment,
} from "@/services/funding";
import {
  adjustFundingInput,
  commitFundsInput,
  releaseCommitmentInput,
  validate,
} from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { PORTAL_PATH } from "@/routes";

/**
 * Money shows up on four surfaces.
 *
 * The board's rail, the administrator's funds table, the employer's
 * reimbursement line and the student's own assistance — a figure that moved and
 * is still stale on one of them is the drift this whole change removes.
 */
const AFFECTED = [
  PORTAL_PATH.board,
  PORTAL_PATH.admin,
  PORTAL_PATH.business,
  PORTAL_PATH.student,
  PORTAL_PATH.college,
];

function revalidate() {
  for (const path of AFFECTED) revalidatePath(path);
}

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

export async function changeAllocation(
  role: ActorRole,
  sourceId: unknown,
  allocated: unknown,
  ratePerHour: unknown,
  reason: unknown,
): Promise<ActionResult> {
  const input = validate(adjustFundingInput, {
    sourceId,
    allocated,
    // A form sends "" for a field it does not show. Normalised here so "not
    // changing the rate" is one value rather than three that mean the same.
    ratePerHour: ratePerHour === "" || ratePerHour === null ? undefined : ratePerHour,
    reason,
  });
  if (!input.ok) return { ok: false, error: input.error };

  const { actor, refusal } = await guard(role, "funding.adjust");
  if (refusal) return refusal;

  const result = await attemptWrite(() =>
    adjustFundingSource(actor, input.data.sourceId, {
      allocated: input.data.allocated,
      ratePerHour: input.data.ratePerHour,
      reason: input.data.reason,
    }).then((r) => (r.ok ? { ok: true as const, created: r.updated } : r)),
  );

  if (!result.ok) {
    logger.warn("funding.adjust_refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  logger.info("funding.adjusted", { sourceId: input.data.sourceId });
  revalidate();
  return { ok: true };
}

export async function awardFunds(
  role: ActorRole,
  sourceId: unknown,
  studentId: unknown,
  applicationId: unknown,
  amount: unknown,
  note: unknown,
): Promise<ActionResult> {
  const input = validate(commitFundsInput, {
    sourceId,
    studentId,
    applicationId:
      applicationId === "" || applicationId === undefined ? null : applicationId,
    amount,
    note: note === "" || note === null ? undefined : note,
  });
  if (!input.ok) return { ok: false, error: input.error };

  const { actor, refusal } = await guard(role, "funding.commit");
  if (refusal) return refusal;

  const result = await attemptWrite(() =>
    commitFunds(actor, input.data).then((r) =>
      r.ok ? { ok: true as const, created: r.updated } : r,
    ),
  );

  if (!result.ok) {
    logger.warn("funding.commit_refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  logger.info("funding.committed", { commitmentId: result.created.id });
  revalidate();
  return { ok: true };
}

export async function giveBackFunds(
  role: ActorRole,
  commitmentId: unknown,
  reason: unknown,
): Promise<ActionResult> {
  const input = validate(releaseCommitmentInput, { id: commitmentId, reason });
  if (!input.ok) return { ok: false, error: input.error };

  const { actor, refusal } = await guard(role, "funding.release");
  if (refusal) return refusal;

  const result = await attemptWrite(() =>
    releaseCommitment(actor, input.data.id, input.data.reason).then((r) =>
      r.ok ? { ok: true as const, created: r.updated } : r,
    ),
  );

  if (!result.ok) {
    logger.warn("funding.release_refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  logger.info("funding.released", { commitmentId: input.data.id });
  revalidate();
  return { ok: true };
}
