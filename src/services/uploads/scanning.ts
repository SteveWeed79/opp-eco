/**
 * Malware scanning.
 *
 * A file passing format validation is still just bytes — a genuine PDF can
 * carry an exploit, and a genuine .docx can carry a macro. Validation proves
 * the file is what it claims to be, not that it is safe.
 *
 * Files are therefore **quarantined on arrival** and only retrievable once a
 * scan clears them. That ordering is the point: scanning after a file is
 * downloadable protects nobody.
 */

import type { FileStore, ScanStatus } from "./storage";

export interface Scanner {
  readonly name: string;
  /** Resolves to the verdict, or throws if the scanner is unavailable. */
  scan(data: Uint8Array): Promise<ScanStatus>;
}

/**
 * Stand-in scanner.
 *
 * Detects the EICAR test string — the standard harmless file every real
 * scanner flags — so the quarantine path can be exercised end to end without
 * a scanning service. Replacing this with ClamAV or a hosted API is one class.
 *
 * It does **not** detect real malware, and says so loudly rather than
 * implying coverage it does not have.
 */
export const EICAR_SIGNATURE =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export const stubScanner: Scanner = {
  name: "stub-eicar-only",
  async scan(data) {
    const text = Buffer.from(
      data.slice(0, Math.min(data.length, 4096)),
    ).toString("latin1");
    return text.includes(EICAR_SIGNATURE) ? "infected" : "clean";
  },
};

export interface ScanOutcome {
  status: ScanStatus;
  /** True when the file was removed rather than kept in quarantine. */
  deleted: boolean;
}

/**
 * Scan a stored file and record the verdict.
 *
 * An infected file is deleted outright rather than left quarantined, because
 * a stored copy is an incident waiting to be mishandled. A scanner failure
 * leaves the file `pending` — which is to say unreachable — since failing open
 * on a malware check defeats the check.
 */
export async function scanStoredFile(
  store: FileStore,
  key: string,
  scanner: Scanner = stubScanner,
): Promise<ScanOutcome> {
  const stored = await store.get(key);
  if (!stored) return { status: "pending", deleted: false };

  let status: ScanStatus;
  try {
    status = await scanner.scan(stored.data);
  } catch {
    // Unavailable scanner: leave it quarantined for a later run.
    return { status: "pending", deleted: false };
  }

  if (status === "infected") {
    await store.remove(key);
    return { status, deleted: true };
  }

  await store.markScanned(key, status);
  return { status, deleted: false };
}
