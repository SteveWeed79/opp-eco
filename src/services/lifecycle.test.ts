import { describe, it, expect, beforeEach } from "vitest";
import {
  transitionOrganization,
  transitionPosting,
  transitionStudent,
} from "./lifecycle";
import { contextFor } from "@/data/session";
import * as seed from "@/data/seed";
import { pendingNotifications } from "@/data/memory-store";

/**
 * The write path for the three gating machines.
 *
 * These mutate the shared seed arrays, so each test restores what it touched —
 * the counts every other suite asserts on depend on it.
 */

let snapshot: {
  students: string[];
  postings: string[];
  organizations: string[];
  auditLength: number;
};

beforeEach(() => {
  if (snapshot) {
    for (const raw of snapshot.students) {
      const row = JSON.parse(raw);
      const i = seed.students.findIndex((s) => s.id === row.id);
      if (i !== -1) seed.students[i] = row;
    }
    for (const raw of snapshot.postings) {
      const row = JSON.parse(raw);
      const i = seed.postings.findIndex((p) => p.id === row.id);
      if (i !== -1) seed.postings[i] = row;
    }
    for (const raw of snapshot.organizations) {
      const row = JSON.parse(raw);
      const i = seed.organizations.findIndex((o) => o.id === row.id);
      if (i !== -1) seed.organizations[i] = row;
    }
    seed.auditEvents.splice(0, seed.auditEvents.length - snapshot.auditLength);
  } else {
    snapshot = {
      students: seed.students.map((s) => JSON.stringify(s)),
      postings: seed.postings.map((p) => JSON.stringify(p)),
      organizations: seed.organizations.map((o) => JSON.stringify(o)),
      auditLength: seed.auditEvents.length,
    };
  }
  pendingNotifications.length = 0;
});

const college = () => contextFor("college");
const business = () => contextFor("business");
const admin = () => contextFor("admin");
const student = () => contextFor("student");

/** Put a seeded record into a known state without going through the machine. */
function force<T extends { id: string }>(rows: T[], id: string, patch: Partial<T>): T {
  const row = rows.find((r) => r.id === id)!;
  Object.assign(row, patch);
  return row;
}

describe("verifying a student", () => {
  it("stamps the date rather than accepting one", async () => {
    const target = force(seed.students, "stu-omar", {
      status: "pending_verification",
      verifiedOn: null,
    });

    const result = await transitionStudent(college(), target.id, "verified");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verifiedOn).not.toBeNull();
    expect(Date.parse(result.value.verifiedOn!)).not.toBeNaN();
  });

  it("clears a stale verification date when the student leaves verified", async () => {
    // A rejected record still carrying "verified on 3 March" is the kind of
    // thing an auditor finds and nobody can explain.
    force(seed.students, "stu-omar", {
      status: "pending_verification",
      verifiedOn: "2026-03-03T00:00:00.000Z",
    });

    const result = await transitionStudent(
      college(),
      "stu-omar",
      "verification_rejected",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verifiedOn).toBeNull();
  });

  it("opens applying, which was refused a moment earlier", async () => {
    // The two halves of the same rule, checked together: this is the whole
    // reason the machine exists.
    force(seed.students, "stu-omar", { status: "pending_verification" });
    const { submitApplication } = await import("./creation");

    const before = await submitApplication(student(), publishedPostingId());
    expect(before.ok).toBe(false);

    await transitionStudent(college(), "stu-omar", "verified");

    const after = await submitApplication(student(), publishedPostingId());
    expect(after.ok).toBe(true);
    if (after.ok) {
      const i = seed.applications.findIndex((a) => a.id === after.created.id);
      seed.applications.splice(i, 1);
    }
  });

  it("tells the student, and writes an audit record", async () => {
    force(seed.students, "stu-omar", { status: "pending_verification" });

    await transitionStudent(college(), "stu-omar", "verified");

    expect(pendingNotifications.filter((n) => n.kind === "student.verified")).toHaveLength(1);
    expect(seed.auditEvents[0]).toMatchObject({
      entityType: "student",
      entityId: "stu-omar",
      to: "verified",
    });
  });

  it("says nothing to the student about being picked up for review", async () => {
    // The college's own bookkeeping. A message per internal step is how a
    // product teaches people to filter its mail.
    force(seed.students, "stu-omar", { status: "profile_complete" });

    await transitionStudent(college(), "stu-omar", "pending_verification");

    expect(pendingNotifications).toEqual([]);
  });

  it("refuses a student verifying themselves", async () => {
    force(seed.students, "stu-omar", { status: "pending_verification" });

    const result = await transitionStudent(student(), "stu-omar", "verified");
    expect(result.ok).toBe(false);
  });
});

describe("publishing a posting", () => {
  function pendingPosting() {
    return force(seed.postings, "post-apex-swe", {
      status: "pending_review",
      skillsRequired: ["Python"],
    });
  }

  it("lets the college publish and tells the employer", async () => {
    const target = pendingPosting();

    const result = await transitionPosting(college(), target.id, "published");

    expect(result.ok).toBe(true);
    expect(
      pendingNotifications.filter((n) => n.kind === "posting.published"),
    ).toHaveLength(1);
  });

  it("sends a change request with the reason attached", async () => {
    const target = pendingPosting();

    await transitionPosting(
      college(),
      target.id,
      "changes_requested",
      "The hours per week do not match the credit you asked for.",
    );

    const sent = pendingNotifications.find(
      (n) => n.kind === "posting.changes_requested",
    );
    expect(sent?.payload.reason).toContain("hours per week");
  });

  it("refuses to publish a posting nobody could match", async () => {
    force(seed.postings, "post-apex-swe", {
      status: "pending_review",
      skillsRequired: [],
    });

    const result = await transitionPosting(college(), "post-apex-swe", "published");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("will not match anyone");
  });

  it("counts open applications itself rather than trusting the caller", async () => {
    // The close guard depends on the count, and a page rendering a button
    // from a stale one must not be able to talk the service into stranding
    // people mid-process.
    force(seed.postings, "post-apex-swe", { status: "published" });

    const result = await transitionPosting(business(), "post-apex-swe", "closed");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/candidate/);
  });

  it("refuses an employer publishing their own posting", async () => {
    pendingPosting();

    const result = await transitionPosting(business(), "post-apex-swe", "published");
    expect(result.ok).toBe(false);
  });
});

describe("vetting an organization", () => {
  it("moves through review to approved and tells them", async () => {
    force(seed.organizations, "org-apex", { status: "under_review" });

    const result = await transitionOrganization(admin(), "org-apex", "approved");

    expect(result.ok).toBe(true);
    expect(
      pendingNotifications.filter((n) => n.kind === "organization.approved"),
    ).toHaveLength(1);
  });

  it("unblocks posting, which was refused a moment earlier", async () => {
    force(seed.organizations, "org-apex", { status: "under_review" });
    const { createPosting } = await import("./creation");
    const fields = {
      track: "micro" as const,
      title: "Vetting gate check",
      description: "A scoped project.",
      county: "Crawford",
      skillsRequired: ["Excel"],
      skillsPreferred: [],
      openings: 1,
      projectFee: 800,
      estimatedHours: 20,
      deliverable: "A report.",
      dueWithinDays: 14,
    };

    expect((await createPosting(business(), fields)).ok).toBe(false);

    await transitionOrganization(admin(), "org-apex", "approved");

    const after = await createPosting(business(), fields);
    expect(after.ok).toBe(true);
    if (after.ok) {
      const i = seed.postings.findIndex((p) => p.id === after.created.id);
      seed.postings.splice(i, 1);
    }
  });

  it("says nothing when an administrator merely opens the file", async () => {
    force(seed.organizations, "org-apex", { status: "applied" });

    await transitionOrganization(admin(), "org-apex", "under_review");

    expect(pendingNotifications).toEqual([]);
  });

  it("tells a suspended organization, rather than letting them discover it", async () => {
    // An organization that finds out by noticing its buttons are gone has
    // been told badly.
    force(seed.organizations, "org-apex", { status: "active" });

    await transitionOrganization(
      admin(),
      "org-apex",
      "suspended",
      "Insurance certificate lapsed.",
    );

    const sent = pendingNotifications.find((n) => n.kind === "organization.suspended");
    expect(sent).toBeTruthy();
    expect(sent?.payload.reason).toContain("Insurance");
  });

  it("is refused to every role but admin", async () => {
    force(seed.organizations, "org-apex", { status: "under_review" });

    for (const actor of [college(), business(), student()]) {
      const result = await transitionOrganization(actor, "org-apex", "approved");
      expect(result.ok, actor.membership.role).toBe(false);
    }
  });

  it("records the override flag when an administrator forces one", async () => {
    force(seed.organizations, "org-apex", {
      status: "under_review",
      contactEmail: "",
    });

    const result = await transitionOrganization(
      admin(),
      "org-apex",
      "approved",
      "Contact confirmed by phone; email to follow.",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.viaOverride).toBe(true);
    expect(seed.auditEvents[0].viaOverride).toBe(true);
  });
});

function publishedPostingId(): string {
  const applied = new Set(
    seed.applications.filter((a) => a.studentId === "stu-omar").map((a) => a.postingId),
  );
  const posting = seed.postings.find(
    (p) => p.status === "published" && !applied.has(p.id),
  );
  if (!posting) throw new Error("no open posting in the seed");
  return posting.id;
}
