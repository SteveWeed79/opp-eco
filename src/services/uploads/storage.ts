/**
 * File storage and retrieval.
 *
 * Three rules drive everything here:
 *
 *   1. The storage key is generated, never derived from the filename. That is
 *      what actually defeats path traversal — sanitising a name helps, but a
 *      key the client never influences cannot traverse anything.
 *   2. Nothing is ever served inline. A .docx is only provably a zip, and a
 *      zip can contain anything; served inline, an uploaded file becomes
 *      stored cross-site scripting against whoever opens it.
 *   3. Retrieval requires a signed, expiring URL **and** an authorization
 *      check. The signature stops guessing; the check stops a leaked link
 *      being as good as the record itself.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { UploadPurpose } from "./validation";

export type ScanStatus = "pending" | "clean" | "infected";

export interface StoredFile {
  /** Opaque, generated. Never contains anything the client supplied. */
  key: string;
  purpose: UploadPurpose;
  /** Original name, sanitised. Metadata only — never used as a path. */
  filename: string;
  contentType: string;
  bytes: number;
  uploadedBy: string;
  uploadedAt: string;
  /**
   * What the file is about. Every file here concerns exactly one student, and
   * retrieval authorization follows that attachment rather than the uploader —
   * a college uploading on a student's behalf must not widen who can read it.
   */
  studentId: string;
  /** Set when the file is a deliverable on a specific application. */
  applicationId?: string;
  /** Files are quarantined until scanned; only `clean` is retrievable. */
  scan: ScanStatus;
}

export interface FileStore {
  put(file: Omit<StoredFile, "key" | "uploadedAt">, data: Uint8Array): Promise<StoredFile>;
  get(key: string): Promise<{ meta: StoredFile; data: Uint8Array } | null>;
  metadata(key: string): Promise<StoredFile | null>;
  markScanned(key: string, status: ScanStatus): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Content types are assigned from the validated kind, never echoed from the
 * client. An attacker who could choose the response's content type could
 * choose how a browser executes it.
 */
const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export function contentTypeFor(extension: string): string {
  // Unknown falls back to a type no browser will render or execute.
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/** In-memory store. A Vercel Blob or S3 adapter satisfies the same interface. */
export function createMemoryFileStore(): FileStore {
  const files = new Map<string, { meta: StoredFile; data: Uint8Array }>();

  return {
    async put(file, data) {
      const meta: StoredFile = {
        ...file,
        // A UUID, not a hash of the content and not a sequence. A hash would
        // let someone confirm they hold the same file as a student; a sequence
        // would let them walk the whole store.
        key: randomUUID(),
        uploadedAt: new Date().toISOString(),
      };
      files.set(meta.key, { meta, data });
      return meta;
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    async metadata(key) {
      return files.get(key)?.meta ?? null;
    },
    async markScanned(key, status) {
      const entry = files.get(key);
      if (entry) entry.meta = { ...entry.meta, scan: status };
    },
    async remove(key) {
      files.delete(key);
    },
  };
}

export const fileStore = createMemoryFileStore();

// ---------------------------------------------------------------------------
// Signed retrieval
// ---------------------------------------------------------------------------

/**
 * The signing secret.
 *
 * Absent in production this throws rather than falling back, because a
 * predictable secret makes every signature forgeable and the failure would
 * otherwise be silent.
 */
function signingSecret(): string {
  const secret = process.env.UPLOAD_URL_SECRET;
  if (secret && secret.length >= 32) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "UPLOAD_URL_SECRET must be set to at least 32 characters in production",
    );
  }
  return "development-only-secret-not-for-production-use";
}

export const DEFAULT_URL_TTL_SECONDS = 300;

export function signDownloadUrl(
  key: string,
  ttlSeconds: number = DEFAULT_URL_TTL_SECONDS,
): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = sign(key, expires);
  return `/api/files/${encodeURIComponent(key)}?expires=${expires}&sig=${signature}`;
}

function sign(key: string, expires: number): string {
  return createHmac("sha256", signingSecret())
    .update(`${key}:${expires}`)
    .digest("hex");
}

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "expired" | "invalid" };

export function verifyDownloadUrl(
  key: string,
  expires: string | null,
  signature: string | null,
): SignatureCheck {
  if (!expires || !signature) return { ok: false, reason: "invalid" };

  const expiresAt = Number(expires);
  if (!Number.isSafeInteger(expiresAt)) return { ok: false, reason: "invalid" };
  if (expiresAt * 1000 < Date.now()) return { ok: false, reason: "expired" };

  const expected = sign(key, expiresAt);
  // Length check first: timingSafeEqual throws on a length mismatch, and
  // comparing with === would leak the signature a byte at a time.
  if (signature.length !== expected.length) return { ok: false, reason: "invalid" };

  const equal = timingSafeEqual(
    Buffer.from(signature, "utf8"),
    Buffer.from(expected, "utf8"),
  );
  return equal ? { ok: true } : { ok: false, reason: "invalid" };
}

/**
 * Response headers for a download.
 *
 * `attachment` rather than `inline` is the control that matters: it stops the
 * browser rendering an uploaded file in the app's own origin. `nosniff` stops
 * it second-guessing the declared type, and the CSP is a belt-and-braces
 * sandbox in case something is rendered anyway.
 */
export function downloadHeaders(meta: StoredFile): Record<string, string> {
  // RFC 5987 encoding keeps a non-ASCII filename from breaking the header,
  // and the quoted fallback is stripped of quotes and control characters.
  const fallback = meta.filename.replace(/["\\\r\n]/g, "_");
  return {
    "Content-Type": meta.contentType,
    "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(meta.filename)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    // Never cached by a shared proxy: these are education records behind a
    // short-lived signature.
    "Cache-Control": "private, no-store",
  };
}
