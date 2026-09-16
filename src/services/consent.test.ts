/**
 * The consent write path, and the gate it opens.
 *
 * These mutate the shared seed arrays, so each test puts back what it changed.
 */

import { describe, it, expect, afterEach } from "vitest";
import { recordConsent, withdrawConsent } from "./consent";
import { contextFor } from "@/data/session";
import { repositories } from "@/data/backend";
import * as seed from "@/data/seed";

const COLLEGE = "org-verdigris";
const original = seed.consents.map((c) => ({ ...c }));
const added: string[] = [];

afterEach(() => {
  seed.consents.splice(0, seed.consents.length, ...original.map((c) => ({ ...c })));
  for (const id of added) {
    const i = seed.auditEvents.findIndex((e) => e.entityId === id);
    if (i !== -1) seed.auditEvents.splice(i, 1);
  }
  for (const c of original) {
    let i = seed.auditEvents.findIndex((e) => e.entityId === c.id);
    while (i !== -1) {
      seed.auditEvents.splice(i, 1);
      i = seed.auditEvents.findIndex((e) => e.entityId === c.id);
    }
  }
  added.length = 0;
});

const college = () => contextFor("college");
const admin = () => contextFor("admin");
const board = () => contextFor("board");
const business = () => contextFor("business");

/** The learner the seed deliberately leaves without an education-record consent. */
const UNCONSENTED = "stu-jordan";

describe("recording a consent", () => {
  it("lets the institution record one for its own learner", async () => {
    const result = await recordConsent(college(), {
      studentId: UNCONSENTED,
      sourceOrgId: COLLEGE,
      scope: "education_record",
      grantedBy: "learner",
      expiresOn: null,
      note: "Release signed at advising.",
    });
    expect(result.ok).toBe(true);
    if (result.ok) added.push(result.updated.id);
  });

  it("records the scope and the grantor in the audit log", async () => {
    // "Consent recorded" answers none of the questions anyone asks of a consent
    // later — which disclosure, and on whose signature.
    const result = await recordConsent(college(), {
      studentId: UNCONSENTED,
      sourceOrgId: COLLEGE,
      scope: "education_record",
      grantedBy: "parent_guardian",
      expiresOn: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    added.push(result.updated.id);

    const event = seed.auditEvents.find((e) => e.entityId === result.updated.id)!;
    expect(event.entityType).toBe("consent");
    expect(event.to).toContain("education_record");
    expect(event.to).toContain("parent_guardian");
  });

  it("refuses a board recording consent on a college's records", async () => {
    // Ownership, not role. The board is a recipient of the disclosure, not the
    // institution that holds the record.
    const result = await recordConsent(board(), {
      studentId: UNCONSENTED,
      sourceOrgId: COLLEGE,
      scope: "education_record",
      grantedBy: "learner",
      expiresOn: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("lets an administrator record on an institution's behalf", async () => {
    const result = await recordConsent(admin(), {
      studentId: UNCONSENTED,
      sourceOrgId: COLLEGE,
      scope: "education_record",
      grantedBy: "learner",
      expiresOn: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) added.push(result.updated.id);
  });

  it("refuses a duplicate while one is already in force", async () => {
    const existing = seed.consents.find((c) => c.scope === "education_record")!;
    const result = await recordConsent(college(), {
      studentId: existing.studentId,
      sourceOrgId: existing.sourceOrgId,
      scope: "education_record",
      grantedBy: "learner",
      expiresOn: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("conflict");
  });
});

describe("withdrawing one", () => {
  it("changes the status and keeps the row", async () => {
    // An institution that disclosed while the consent stood may have to account
    // for having done so, and a deleted row cannot say what was permitted when.
    const existing = seed.consents.find((c) => c.scope === "education_record")!;
    const result = await withdrawConsent(college(), existing.id, "Learner asked us to stop.");
    expect(result.ok).toBe(true);

    const after = seed.consents.find((c) => c.id === existing.id);
    expect(after).toBeDefined();
    expect(after!.status).toBe("withdrawn");
  });

  it("refuses without a reason", async () => {
    const existing = seed.consents.find((c) => c.scope === "education_record")!;
    expect((await withdrawConsent(college(), existing.id, "   ")).ok).toBe(false);
  });

  it("refuses to withdraw one twice", async () => {
    const existing = seed.consents.find((c) => c.scope === "education_record")!;
    await withdrawConsent(college(), existing.id, "Learner asked us to stop.");
    const again = await withdrawConsent(college(), existing.id, "Again.");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("conflict");
  });
});

describe("the gate on employer disclosure", () => {
  /** An application far enough along that the stage rule alone would disclose. */
  function placementFor(studentId: string) {
    return seed.applications.find(
      (a) =>
        a.studentId === studentId &&
        ["placement_active", "placement_completed", "credit_pending", "credit_granted"].includes(
          a.status,
        ),
    );
  }

  it("withholds contact details when no consent is on file", async () => {
    const application = placementFor(UNCONSENTED)!;
    const seen = await repositories.students.forApplication(business(), application);
    // The employer still sees enough to do its job — an abbreviated name — but
    // the disclosure that FERPA covers does not widen on a status change.
    expect(seen).not.toBeNull();
    expect(seen!.email).toBe("");
  });

  it("discloses once the consent exists", async () => {
    const application = placementFor(UNCONSENTED)!;
    const result = await recordConsent(college(), {
      studentId: UNCONSENTED,
      sourceOrgId: COLLEGE,
      scope: "education_record",
      grantedBy: "learner",
      expiresOn: null,
    });
    if (result.ok) added.push(result.updated.id);

    const seen = await repositories.students.forApplication(business(), application);
    expect(seen!.email).not.toBe("");
  });

  it("narrows again when it is withdrawn", async () => {
    const consented = seed.consents.find(
      (c) => c.scope === "education_record" && placementFor(c.studentId),
    )!;
    const application = placementFor(consented.studentId)!;

    const before = await repositories.students.forApplication(business(), application);
    expect(before!.email).not.toBe("");

    await withdrawConsent(college(), consented.id, "Learner asked us to stop.");

    const after = await repositories.students.forApplication(business(), application);
    expect(after!.email).toBe("");
  });

  it("does not widen a disclosure the stage still refuses", async () => {
    // Consent is a second condition, not a replacement for the first. An
    // employer deciding whether to shortlist has no need for contact details
    // however much paperwork is on file.
    const early = seed.applications.find((a) => a.status === "submitted")!;
    const seen = await repositories.students.forApplication(business(), early);
    if (seen) expect(seen.email).toBe("");
  });
});

describe("who may read a consent", () => {
  it("shows an employer none of them", async () => {
    // It is the beneficiary of the disclosure, not a party to the agreement.
    expect(await repositories.consents.list(business())).toEqual([]);
  });

  it("shows a college the ones it recorded", async () => {
    const theirs = await repositories.consents.list(college());
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every((c) => c.sourceOrgId === COLLEGE)).toBe(true);
  });

  it("shows a learner their own", async () => {
    const student = contextFor("student");
    const self = seed.studentForUser(student.user.id)!;
    const theirs = await repositories.consents.list(student);
    expect(theirs.every((c) => c.studentId === self.id)).toBe(true);
  });
});

describe("purging a learner's identity", () => {
  it("is the administrator's alone", async () => {
    // The opposite of who records consent, deliberately: consent is the
    // institution's own paperwork, a purge is the platform discharging a
    // statutory obligation across every institution in a market.
    const { purgeLearnerIdentity } = await import("./retention");
    const result = await purgeLearnerIdentity(college(), "stu-jordan", "Retention.");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("refuses a learner who is still taking part", async () => {
    const { purgeLearnerIdentity } = await import("./retention");
    const active = seed.applications.find((a) => a.status === "placement_active")!;
    const result = await purgeLearnerIdentity(admin(), active.studentId, "Retention.");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/still taking part|not due/i);
  });

  it("refuses one whose clock has not run out", async () => {
    // Nothing in the seed is three years past its last participation, so this
    // is the case the fixtures actually exercise.
    const { purgeLearnerIdentity } = await import("./retention");
    const result = await purgeLearnerIdentity(admin(), "stu-jordan", "Retention.");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not due until|still taking part/i);
  });

  it("takes the learner's files with their identity", async () => {
    // New, and new because storage became durable. A resume used to die with
    // the process; now it outlives the record it was attached to unless the
    // purge reaches it, and a document with a learner's name on the front is
    // exactly what anonymising the record was for.
    //
    // Driven with an injected clock because nothing in the seed is due yet —
    // which is the honest reason the success path had no test until now.
    const { purgeLearnerIdentity } = await import("./retention");
    const { createMemoryFileStore } = await import("@/services/uploads/storage");
    const { store } = await import("@/data/backend");

    const { isTerminal } = await import("@/domain/workflow");
    // A learner with nothing open. `purgeBlockReason` refuses anyone still
    // taking part whatever the clock says, and rightly — the schedule runs from
    // last participation, which has not happened yet for an active placement.
    const learner = seed.students.find(
      (s) =>
        !s.purgedOn &&
        seed.applications
          .filter((a) => a.studentId === s.id)
          .every((a) => isTerminal(a.status)),
    )!;
    const before = { ...learner };

    const files = createMemoryFileStore();
    const mine = await files.put(
      {
        purpose: "resume",
        filename: "resume.pdf",
        contentType: "application/pdf",
        bytes: 3,
        uploadedBy: learner.userId,
        studentId: learner.id,
        scan: "clean",
      },
      new Uint8Array([1, 2, 3]),
    );
    const someoneElse = await files.put(
      {
        purpose: "resume",
        filename: "resume.pdf",
        contentType: "application/pdf",
        bytes: 3,
        uploadedBy: "u-alex",
        studentId: "stu-alex",
        scan: "clean",
      },
      new Uint8Array([1, 2, 3]),
    );

    // Far enough past every retention clock in the schedule that nothing is
    // holding this record open.
    const farFuture = new Date("2040-01-01T00:00:00.000Z");

    try {
      const result = await purgeLearnerIdentity(
        admin(),
        learner.id,
        "Retention schedule.",
        { store, now: () => farFuture, files: () => files },
      );

      expect(result.ok).toBe(true);
      expect(await files.metadata(mine.key)).toBeNull();
      // Scoped, not a sweep: another learner's file is untouched.
      expect(await files.metadata(someoneElse.key)).not.toBeNull();
    } finally {
      const i = seed.students.findIndex((s) => s.id === before.id);
      if (i !== -1) seed.students[i] = before;
      const at = seed.auditEvents.findIndex(
        (e) => e.entityId === before.id && e.to === "purged",
      );
      if (at !== -1) seed.auditEvents.splice(at, 1);
    }
  });
});
