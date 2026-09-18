/**
 * The shared body of the micro track's hand-in actions.
 *
 * Not Server Actions themselves, for the reason `outcome.ts` and
 * `escalation.ts` are not: each portal exports its own `"use server"` wrapper
 * with its role hardcoded, because Server Actions accept direct POSTs and a
 * single action taking a role from the request would let a caller accept their
 * own work.
 */

import { revalidatePath } from "next/cache";
import { actorForPortal } from "@/auth/session";
import { attemptWrite, type ActionResult } from "@/app/_actions/transition";
import {
  acceptDeliverable,
  requestRevision,
  submitDeliverable,
} from "@/services/deliverable";
import {
  answerDeliverableInput,
  submitDeliverableInput,
  validate,
} from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { PORTAL_PATH } from "@/routes";
import { repositories } from "@/data/backend";
import { receiveUpload } from "@/services/uploads";

/**
 * Three surfaces, and the college is the one worth naming.
 *
 * It never touches a deliverable and its page changes anyway: acceptance is
 * what makes a micro placement's hours count toward a credit, so the credit
 * queue gains a row the moment an employer takes the work.
 */
const AFFECTED = [PORTAL_PATH.student, PORTAL_PATH.business, PORTAL_PATH.college];

/**
 * Takes `FormData` rather than plain arguments, because one of the fields is a
 * file and bytes do not survive being flattened into a string.
 *
 * The upload happens **before** the hand-in is recorded and outside its
 * transaction, deliberately. A file lands in a store, gets scanned, and may be
 * refused for reasons the record knows nothing about — so it resolves to a key
 * or to an error first, and only then does a deliverable get written. The
 * alternative, writing the row and attaching the file afterwards, leaves a
 * hand-in claiming an attachment that is not there.
 *
 * The reverse — a stored file with no row pointing at it, when the hand-in is
 * then refused — is the harmless direction: the retention sweep collects
 * unreferenced files, and nobody is shown a promise that was not kept.
 */
export async function handInWork(form: FormData): Promise<ActionResult> {
  const input = validate(submitDeliverableInput, {
    applicationId: form.get("applicationId"),
    summary: form.get("summary"),
  });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal("student");
  const limit = checkRateLimit(callerKey("deliverable", actor.user.id), LIMITS.mutation);
  if (!limit.ok) {
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  let fileKey: string | null = null;
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    const student = await repositories.students.forUser(actor, actor.user.id);
    if (!student) {
      return { ok: false, error: "No learner record for this account." };
    }
    const upload = await receiveUpload(
      actor,
      "deliverable",
      file.name,
      new Uint8Array(await file.arrayBuffer()),
      // Both, because access to the file follows the thing it is attached to:
      // `canRetrieve` reads the application to decide whether an employer is
      // the one hosting this placement.
      { studentId: student.id, applicationId: input.data.applicationId },
    );
    if (!upload.ok) {
      // Surfaced rather than swallowed. The commonest refusal is a deployment
      // holding real records with no malware scanner configured, which is a
      // sentence an operator needs to read rather than a silent missing
      // attachment.
      logger.warn("deliverable.upload_refused", {});
      return { ok: false, error: upload.error };
    }
    fileKey = upload.file.key;
  }

  const result = await attemptWrite(() =>
    submitDeliverable(actor, { ...input.data, fileKey }),
  );
  if (!result.ok) {
    logger.warn("deliverable.refused", { code: result.code });
    return { ok: false, error: result.error };
  }
  logger.info("deliverable.submitted", {
    deliverableId: result.updated.id,
    round: result.updated.round,
  });
  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}

export async function acceptWork(
  deliverableId: unknown,
  evaluation: unknown,
): Promise<ActionResult> {
  const input = validate(answerDeliverableInput, { deliverableId, response: evaluation });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal("business");
  const result = await attemptWrite(() =>
    acceptDeliverable(actor, input.data.deliverableId, input.data.response),
  );
  if (!result.ok) {
    logger.warn("deliverable.refused", { code: result.code });
    return { ok: false, error: result.error };
  }
  logger.info("deliverable.accepted", { deliverableId: input.data.deliverableId });
  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}

export async function askForChange(
  deliverableId: unknown,
  response: unknown,
): Promise<ActionResult> {
  const input = validate(answerDeliverableInput, { deliverableId, response });
  if (!input.ok) return { ok: false, error: input.error };

  const actor = await actorForPortal("business");
  const result = await attemptWrite(() =>
    requestRevision(actor, input.data.deliverableId, input.data.response),
  );
  if (!result.ok) {
    logger.warn("deliverable.refused", { code: result.code });
    return { ok: false, error: result.error };
  }
  logger.info("deliverable.revision_requested", {
    deliverableId: input.data.deliverableId,
  });
  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}
