/**
 * Who may retrieve a file.
 *
 * A signed URL proves the link was issued, not that the person holding it is
 * still entitled to it. Links get forwarded, pasted into chat, and left in
 * browser history — so retrieval checks authorization every time, and the
 * signature only stops someone guessing keys.
 *
 * The rules mirror the record's own disclosure rules rather than inventing new
 * ones: an employer who cannot see a student's email should not be able to
 * open their resume.
 */

import type { ActorContext } from "@/domain/types";
import { repositories } from "@/data/memory";
import { disclosureFor } from "@/domain/disclosure";
import type { StoredFile } from "./storage";

export type AccessDecision =
  | { ok: true }
  | { ok: false; reason: "quarantined" | "forbidden" | "not_found" };

/**
 * A file is attached to something — a student's profile, or an application's
 * deliverable. Access follows that attachment.
 */
export interface FileAttachment {
  key: string;
  /** The student the file concerns. Always set: every file here is about one. */
  studentId: string;
  /** Set when the file is a deliverable on a specific application. */
  applicationId?: string;
}

export function canRetrieve(
  actor: ActorContext,
  meta: StoredFile,
  attachment: FileAttachment = { key: meta.key, studentId: meta.studentId, applicationId: meta.applicationId },
): AccessDecision {
  // Quarantine outranks everything. An unscanned file is not retrievable by
  // its owner, an administrator, or anyone else.
  if (meta.scan !== "clean") return { ok: false, reason: "quarantined" };

  const student = repositories.students.find(actor, attachment.studentId);
  // Not visible through the actor's own scope means not theirs to open —
  // this is where market and organisation scoping is inherited rather than
  // reimplemented.
  if (!student) return { ok: false, reason: "not_found" };

  switch (actor.membership.role) {
    case "admin":
      return { ok: true };

    case "student":
      // Their own files only.
      return actor.user.id === student.userId
        ? { ok: true }
        : { ok: false, reason: "forbidden" };

    case "college":
      // The college owns the student relationship within its market.
      return { ok: true };

    case "business": {
      // Only against an application they own, and only once the placement has
      // progressed far enough to release the student's details.
      if (!attachment.applicationId) return { ok: false, reason: "forbidden" };
      const application = repositories.applications.find(
        actor,
        attachment.applicationId,
      );
      if (!application) return { ok: false, reason: "forbidden" };
      return disclosureFor(application) === "full"
        ? { ok: true }
        : { ok: false, reason: "forbidden" };
    }

    case "board":
      // The board determines eligibility from an interview, not from reading
      // a student's resume. Nothing in the workflow requires this.
      return { ok: false, reason: "forbidden" };

    default:
      return { ok: false, reason: "forbidden" };
  }
}
