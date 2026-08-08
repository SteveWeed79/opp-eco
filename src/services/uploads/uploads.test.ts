/**
 * Upload hardening tests.
 *
 * Weighted toward hostile input, because that is what this code exists for.
 * A test suite for uploads that only checks the happy path is testing the
 * wrong thing.
 */

import { describe, it, expect } from "vitest";
import {
  checkUpload,
  sanitiseFilename,
  extensionOf,
} from "./validation";
import {
  createMemoryFileStore,
  signDownloadUrl,
  verifyDownloadUrl,
  downloadHeaders,
  contentTypeFor,
  type StoredFile,
} from "./storage";
import { scanStoredFile, stubScanner, EICAR_SIGNATURE } from "./scanning";
import { receiveUpload } from "./index";
import { canRetrieve } from "./access";
import { contextFor } from "@/data/session";

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // MZ — Windows PE
const ELF_BYTES = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
const HTML_BYTES = new TextEncoder().encode("<script>alert(1)</script>");

// --- filenames -------------------------------------------------------------

describe("filename sanitisation", () => {
  it("keeps an ordinary name", () => {
    expect(sanitiseFilename("Omar_Haddad_Resume.pdf")).toBe("Omar_Haddad_Resume.pdf");
  });

  it("strips a traversal path", () => {
    expect(sanitiseFilename("../../../etc/passwd")).toBe("passwd");
  });

  it("strips a Windows traversal path", () => {
    expect(sanitiseFilename("..\\..\\Windows\\System32\\cmd.exe")).toBe("cmd.exe");
  });

  it("rejects a null byte, which can truncate the name downstream", () => {
    // "safe.pdf\0.exe" passes an extension check and lands as an executable.
    expect(sanitiseFilename("safe.pdf\0.exe")).toBeNull();
  });

  it("rejects a name that is only dots", () => {
    expect(sanitiseFilename("..")).toBeNull();
    expect(sanitiseFilename(".")).toBeNull();
  });

  it("rejects a Windows reserved name", () => {
    expect(sanitiseFilename("CON.pdf")).toBeNull();
    expect(sanitiseFilename("lpt1.docx")).toBeNull();
  });

  it("rejects an absurdly long name", () => {
    expect(sanitiseFilename("a".repeat(500) + ".pdf")).toBeNull();
  });

  it("strips characters that mean something to a shell or a header", () => {
    const cleaned = sanitiseFilename('re"su|me?.pdf');
    expect(cleaned).not.toMatch(/["|?]/);
  });

  it("strips control characters", () => {
    expect(sanitiseFilename("resume\r\n.pdf")).toBe("resume.pdf");
  });
});

// --- content validation ----------------------------------------------------

describe("content validation", () => {
  it("accepts a genuine PDF named .pdf", () => {
    const result = checkUpload("resume", "resume.pdf", PDF_BYTES);
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("PDF");
  });

  it("rejects an executable renamed to .pdf", () => {
    // The whole point: the extension is attacker-controlled, the bytes are not.
    const result = checkUpload("resume", "resume.pdf", EXE_BYTES);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("content_mismatch");
  });

  it("rejects an ELF binary renamed to .docx", () => {
    const result = checkUpload("resume", "cv.docx", ELF_BYTES);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("content_mismatch");
  });

  it("rejects HTML renamed to .pdf", () => {
    // Served inline this would be stored XSS.
    const result = checkUpload("resume", "resume.pdf", HTML_BYTES);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("content_mismatch");
  });

  it("rejects .svg outright, since it is executable in a browser", () => {
    const result = checkUpload("deliverable", "mockup.svg", PNG_BYTES);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("extension_not_allowed");
  });

  it("rejects .html outright", () => {
    const result = checkUpload("deliverable", "report.html", HTML_BYTES);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("extension_not_allowed");
  });

  it("rejects an image on the resume purpose", () => {
    // Allowlists are per purpose, not global.
    const result = checkUpload("resume", "photo.png", PNG_BYTES);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("extension_not_allowed");
  });

  it("accepts the same image as a deliverable", () => {
    expect(checkUpload("deliverable", "mockup.png", PNG_BYTES).ok).toBe(true);
  });

  it("rejects an empty file", () => {
    expect(checkUpload("resume", "resume.pdf", new Uint8Array()).reason).toBe("empty");
  });

  it("rejects a file over the purpose's size limit", () => {
    const huge = new Uint8Array(6 * 1024 * 1024);
    huge.set(PDF_BYTES);
    expect(checkUpload("resume", "resume.pdf", huge).reason).toBe("too_large");
  });

  it("checks size before reading content, so a hostile body is cheap to refuse", () => {
    const huge = new Uint8Array(6 * 1024 * 1024); // no magic bytes at all
    expect(checkUpload("resume", "resume.pdf", huge).reason).toBe("too_large");
  });

  it("treats a .docx as a zip, which is all its signature proves", () => {
    // Documented limitation rather than a gap: nothing is served inline.
    expect(checkUpload("resume", "cv.docx", ZIP_BYTES).ok).toBe(true);
  });
});

// --- storage keys ----------------------------------------------------------

describe("storage keys", () => {
  it("never derives the key from the filename", async () => {
    const store = createMemoryFileStore();
    const file = await store.put(
      {
        purpose: "resume",
        filename: "passwd",
        contentType: "application/pdf",
        bytes: 8,
        uploadedBy: "u-omar",
        studentId: "stu-omar",
        scan: "pending",
      },
      PDF_BYTES,
    );
    expect(file.key).not.toContain("passwd");
    expect(file.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("gives identical content different keys", async () => {
    const store = createMemoryFileStore();
    const base = {
      purpose: "resume" as const,
      filename: "a.pdf",
      contentType: "application/pdf",
      bytes: 8,
      uploadedBy: "u-omar",
      studentId: "stu-omar",
      scan: "pending" as const,
    };
    const first = await store.put(base, PDF_BYTES);
    const second = await store.put(base, PDF_BYTES);
    // A content hash would let someone confirm they hold the same file as a
    // student; a sequence would let them walk the store.
    expect(first.key).not.toBe(second.key);
  });
});

// --- signed URLs -----------------------------------------------------------

describe("signed URLs", () => {
  it("verifies a freshly signed URL", () => {
    const url = signDownloadUrl("key-1");
    const params = new URL(url, "http://x").searchParams;
    expect(
      verifyDownloadUrl("key-1", params.get("expires"), params.get("sig")).ok,
    ).toBe(true);
  });

  it("refuses a signature for a different key", () => {
    const url = signDownloadUrl("key-1");
    const params = new URL(url, "http://x").searchParams;
    const result = verifyDownloadUrl("key-2", params.get("expires"), params.get("sig"));
    expect(result.ok).toBe(false);
  });

  it("refuses a tampered expiry", () => {
    const url = signDownloadUrl("key-1");
    const params = new URL(url, "http://x").searchParams;
    // Extending your own link should not work.
    const result = verifyDownloadUrl("key-1", "99999999999", params.get("sig"));
    expect(result.ok).toBe(false);
  });

  it("refuses an expired URL", () => {
    const url = signDownloadUrl("key-1", -10);
    const params = new URL(url, "http://x").searchParams;
    expect(verifyDownloadUrl("key-1", params.get("expires"), params.get("sig"))).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses a missing signature", () => {
    expect(verifyDownloadUrl("key-1", "9999999999", null).ok).toBe(false);
  });

  it("refuses a non-numeric expiry without throwing", () => {
    expect(verifyDownloadUrl("key-1", "not-a-number", "abc").ok).toBe(false);
  });
});

// --- download headers ------------------------------------------------------

describe("download headers", () => {
  const meta: StoredFile = {
    key: "k",
    purpose: "resume",
    filename: "resume.pdf",
    contentType: "application/pdf",
    bytes: 8,
    uploadedBy: "u-omar",
    uploadedAt: new Date().toISOString(),
    studentId: "stu-omar",
    scan: "clean",
  };

  it("always serves as an attachment, never inline", () => {
    expect(downloadHeaders(meta)["Content-Disposition"]).toMatch(/^attachment;/);
  });

  it("stops the browser sniffing a type", () => {
    expect(downloadHeaders(meta)["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("sandboxes anything that does get rendered", () => {
    expect(downloadHeaders(meta)["Content-Security-Policy"]).toContain("sandbox");
  });

  it("keeps education records out of shared caches", () => {
    expect(downloadHeaders(meta)["Cache-Control"]).toContain("no-store");
  });

  it("neutralises a filename that would break the header", () => {
    const hostile = { ...meta, filename: 'evil".pdf' };
    const disposition = downloadHeaders(hostile)["Content-Disposition"];
    // The quoted segment must not contain a bare quote that ends it early.
    expect(disposition.split(";")[1]).not.toContain('evil".pdf');
  });

  it("falls back to a type no browser will execute", () => {
    expect(contentTypeFor(".weird")).toBe("application/octet-stream");
  });
});

// --- quarantine and scanning ----------------------------------------------

describe("quarantine", () => {
  it("stores as pending and clears only after a scan", async () => {
    const store = createMemoryFileStore();
    const actor = contextFor("student");
    const result = await receiveUpload(actor, "resume", "resume.pdf", PDF_BYTES, { studentId: "stu-omar" }, { store });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.scan).toBe("clean");
  });

  it("deletes an infected file rather than quarantining it", async () => {
    const store = createMemoryFileStore();
    const infected = new TextEncoder().encode(`%PDF-1.7 ${EICAR_SIGNATURE}`);
    const actor = contextFor("student");

    const result = await receiveUpload(actor, "resume", "resume.pdf", infected, { studentId: "stu-omar" }, { store });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("malware");
  });

  it("leaves a file quarantined when the scanner is unavailable", async () => {
    const store = createMemoryFileStore();
    const broken = {
      name: "broken",
      async scan(): Promise<never> {
        throw new Error("scanner unreachable");
      },
    };
    const file = await store.put(
      {
        purpose: "resume",
        filename: "r.pdf",
        contentType: "application/pdf",
        bytes: 8,
        uploadedBy: "u-omar",
        studentId: "stu-omar",
        scan: "pending",
      },
      PDF_BYTES,
    );

    const outcome = await scanStoredFile(store, file.key, broken);
    // Failing open on a malware check defeats the check.
    expect(outcome.status).toBe("pending");
    expect((await store.metadata(file.key))?.scan).toBe("pending");
  });

  it("flags the EICAR test file", async () => {
    const data = new TextEncoder().encode(EICAR_SIGNATURE);
    expect(await stubScanner.scan(data)).toBe("infected");
  });
});

// --- retrieval authorization ----------------------------------------------

describe("retrieval authorization", () => {
  const clean: StoredFile = {
    key: "k",
    purpose: "resume",
    filename: "resume.pdf",
    contentType: "application/pdf",
    bytes: 8,
    uploadedBy: "u-omar",
    uploadedAt: new Date().toISOString(),
    studentId: "stu-omar",
    scan: "clean",
  };

  it("refuses an unscanned file to everyone, including an administrator", () => {
    const pending = { ...clean, scan: "pending" as const };
    const result = canRetrieve(contextFor("admin"), pending, { key: "k", studentId: "stu-omar" });
    expect(result).toEqual({ ok: false, reason: "quarantined" });
  });

  it("lets a student open their own file", () => {
    expect(
      canRetrieve(contextFor("student"), clean, { key: "k", studentId: "stu-omar" }).ok,
    ).toBe(true);
  });

  it("refuses a student someone else's file", () => {
    expect(
      canRetrieve(contextFor("student"), clean, { key: "k", studentId: "stu-jordan" }).ok,
    ).toBe(false);
  });

  it("lets the college open it, since it owns the relationship", () => {
    expect(
      canRetrieve(contextFor("college"), clean, { key: "k", studentId: "stu-omar" }).ok,
    ).toBe(true);
  });

  it("refuses the board, which has no workflow reason to read a resume", () => {
    expect(
      canRetrieve(contextFor("board"), clean, { key: "k", studentId: "stu-omar" }).ok,
    ).toBe(false);
  });

  it("refuses a business with no application attachment", () => {
    expect(
      canRetrieve(contextFor("business"), clean, { key: "k", studentId: "stu-omar" }).ok,
    ).toBe(false);
  });

  it("refuses a business before the placement releases the student's details", () => {
    // app-11 is shortlisted — the stage at which a surname is still withheld.
    const result = canRetrieve(contextFor("business"), clean, {
      key: "k",
      studentId: "stu-omar",
      applicationId: "app-11",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a business an application it does not own", () => {
    const result = canRetrieve(contextFor("business"), clean, {
      key: "k",
      studentId: "stu-priya",
      applicationId: "app-2",
    });
    expect(result.ok).toBe(false);
  });
});

describe("extension parsing", () => {
  it("takes the last extension, not the first", () => {
    // "resume.pdf.exe" is .exe, whatever it hopes you read.
    expect(extensionOf("resume.pdf.exe")).toBe(".exe");
  });

  it("is case-insensitive", () => {
    expect(extensionOf("RESUME.PDF")).toBe(".pdf");
  });

  it("returns empty for no extension", () => {
    expect(extensionOf("resume")).toBe("");
  });
});
