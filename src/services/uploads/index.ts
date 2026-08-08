/**
 * Upload pipeline.
 *
 * One entry point, so no caller can accidentally skip a step. The order is
 * load-bearing:
 *
 *   rate limit → size → filename → extension → magic bytes → store
 *   quarantined → scan → clean
 *
 * Cheap rejections come first so a hostile body is refused before anything
 * reads it, and the file is unreachable between storing and scanning.
 */

import type { ActorContext } from "@/domain/types";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import {
  checkUpload,
  extensionOf,
  type UploadPurpose,
} from "./validation";
import {
  contentTypeFor,
  fileStore,
  signDownloadUrl,
  type FileStore,
  type StoredFile,
} from "./storage";
import { scanStoredFile, type Scanner, stubScanner } from "./scanning";

export * from "./validation";
export * from "./storage";
export * from "./scanning";
export * from "./access";

export type UploadResult =
  | { ok: true; file: StoredFile; downloadUrl: string }
  | { ok: false; error: string };

export interface UploadTarget {
  /** The student this file concerns. Required — every file here is about one. */
  studentId: string;
  /** Set when the file is a deliverable on a specific application. */
  applicationId?: string;
}

export async function receiveUpload(
  actor: ActorContext,
  purpose: UploadPurpose,
  filename: string,
  data: Uint8Array,
  target: UploadTarget,
  deps: { store?: FileStore; scanner?: Scanner } = {},
): Promise<UploadResult> {
  const store = deps.store ?? fileStore;
  const scanner = deps.scanner ?? stubScanner;

  const limit = checkRateLimit(
    callerKey("upload", actor.user.id),
    LIMITS.mutation,
  );
  if (!limit.ok) {
    return {
      ok: false,
      error: `Too many uploads. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const check = checkUpload(purpose, filename, data);
  if (!check.ok) {
    // The rejection reason is logged; the filename is not, since a hostile
    // name is exactly what should never reach a log.
    logger.warn("upload.rejected", {
      purpose,
      reason: check.reason,
      bytes: data.length,
      userId: actor.user.id,
    });
    return { ok: false, error: check.error ?? "That file can't be accepted." };
  }

  const file = await store.put(
    {
      purpose,
      filename: check.safeName!,
      // Assigned from the validated extension, never echoed from the client.
      contentType: contentTypeFor(extensionOf(check.safeName!)),
      bytes: data.length,
      uploadedBy: actor.user.id,
      studentId: target.studentId,
      applicationId: target.applicationId,
      // Quarantined until a scanner says otherwise.
      scan: "pending",
    },
    data,
  );

  const outcome = await scanStoredFile(store, file.key, scanner);
  if (outcome.status !== "clean") {
    logger.warn("upload.quarantined", {
      key: file.key,
      status: outcome.status,
      deleted: outcome.deleted,
      userId: actor.user.id,
    });
    return {
      ok: false,
      error:
        outcome.status === "infected"
          ? "That file failed a malware scan and was not kept."
          : "That file is still being scanned. Try again shortly.",
    };
  }

  logger.info("upload.accepted", {
    key: file.key,
    purpose,
    bytes: data.length,
    userId: actor.user.id,
  });

  return {
    ok: true,
    file: { ...file, scan: "clean" },
    downloadUrl: signDownloadUrl(file.key),
  };
}
