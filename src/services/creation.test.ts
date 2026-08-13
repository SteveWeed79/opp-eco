import { describe, it, expect, beforeEach } from "vitest";
import { submitApplication, createPosting } from "./creation";
import { contextFor } from "@/data/session";
import * as seed from "@/data/seed";
import { pendingNotifications } from "@/data/memory-store";

/**
 * The creation path.
 *
 * These write to the shared seed arrays, so each test records what it added
 * and removes it again — otherwise the counts every other suite asserts on
 * drift depending on what ran first.
 */
const added: { applications: string[]; postings: string[] } = {
  applications: [],
  postings: [],
};

/** Generic so the discriminated union survives — `result.ok` must still narrow. */
function track<T extends { ok: boolean; created?: { id: string } }>(
  result: T,
  kind: "applications" | "postings",
): T {
  if (result.created) added[kind].push(result.created.id);
  return result;
}

beforeEach(() => {
  for (const id of added.applications) {
    const i = seed.applications.findIndex((a) => a.id === id);
    if (i !== -1) seed.applications.splice(i, 1);
  }
  for (const id of added.postings) {
    const i = seed.postings.findIndex((p) => p.id === id);
    if (i !== -1) seed.postings.splice(i, 1);
  }
  added.applications = [];
  added.postings = [];
  pendingNotifications.length = 0;
});

const student = () => contextFor("student");
const business = () => contextFor("business");

/** A published posting the demo student has not already applied to. */
function openPostingId(): string {
  const applied = new Set(
    seed.applications
      .filter((a) => a.studentId === "stu-omar")
      .map((a) => a.postingId),
  );
  const posting = seed.postings.find(
    (p) => p.status === "published" && !applied.has(p.id),
  );
  if (!posting) throw new Error("no open posting in the seed");
  return posting.id;
}

describe("the gates that were claimed but never enforced", () => {
  // Both of these were asserted in the interface and checked nowhere. The
  // seeded demo satisfies them, which is exactly why they went unnoticed —
  // so these drive the refusal path directly rather than trusting a green
  // run over data that could never have failed.

  it("refuses an application from a student the college has not verified", async () => {
    const student = seed.students.find((s) => s.id === "stu-omar")!;
    const original = student.status;
    student.status = "pending_verification";

    try {
      const result = await submitApplication(contextFor("student"), openPostingId());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("forbidden");
      expect(result.error).toContain("has not verified your enrollment");
    } finally {
      student.status = original;
    }
  });

  it("refuses an application to an employer still in vetting", async () => {
    const postingId = openPostingId();
    const posting = seed.postings.find((p) => p.id === postingId)!;
    const employer = seed.organizations.find((o) => o.id === posting.businessId)!;
    const original = employer.status;
    employer.status = "under_review";

    try {
      const result = await submitApplication(contextFor("student"), postingId);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("not currently able to take applications");
    } finally {
      employer.status = original;
    }
  });

  it("refuses a posting from an employer still in vetting", async () => {
    const employer = seed.organizations.find((o) => o.id === "org-apex")!;
    const original = employer.status;
    employer.status = "applied";

    try {
      const result = await createPosting(contextFor("business"), validPosting);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("still being vetted");
    } finally {
      employer.status = original;
    }
  });

  it("tells a suspended employer something other than 'not approved'", async () => {
    // Telling them they are unapproved invites them to apply again, which is
    // not the remedy.
    const employer = seed.organizations.find((o) => o.id === "org-apex")!;
    const original = employer.status;
    employer.status = "suspended";

    try {
      const result = await createPosting(contextFor("business"), validPosting);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("suspended");
      expect(result.error).not.toContain("still being vetted");
    } finally {
      employer.status = original;
    }
  });
});

describe("submitting an application", () => {
  it("creates one, at submitted", async () => {
    const result = track(await submitApplication(student(), openPostingId()), "applications");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created.status).toBe("submitted");
      expect(result.created.version).toBe(1);
    }
  });

  it("computes the match score rather than accepting one", async () => {
    // A caller who could send their own score would sort themselves to the top
    // of every employer's queue.
    const result = track(await submitApplication(student(), openPostingId()), "applications");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created.matchScore.score).toBeGreaterThanOrEqual(0);
      expect(result.created.matchScore.algorithmVersion).toBeTruthy();
    }
  });

  it("refuses a second application to the same posting", async () => {
    const postingId = openPostingId();
    track(await submitApplication(student(), postingId), "applications");

    const again = await submitApplication(student(), postingId);

    // Applying twice is a mistake, not a second candidacy, and it would
    // double-count in every funnel.
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("duplicate");
  });

  it("refuses a non-student", async () => {
    const result = await submitApplication(business(), openPostingId());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("refuses a posting that is not published", async () => {
    const draft = seed.postings.find((p) => p.status !== "published");
    if (!draft) return;

    const result = await submitApplication(student(), draft.id);
    expect(result.ok).toBe(false);
  });

  it("tells the employer, in the same transaction", async () => {
    track(await submitApplication(student(), openPostingId()), "applications");
    expect(pendingNotifications.some((n) => n.kind === "application.submitted")).toBe(true);
  });
});

const validPosting = {
  title: "Data pipeline intern",
  description: "Build and monitor ingestion jobs for the county water system.",
  county: "Crawford",
  skillsRequired: ["Python"],
  skillsPreferred: ["SQL"],
  openings: 1,
  track: "standard" as const,
  wagePerHour: 20,
  hoursPerWeek: 15,
  weeks: 16,
  creditHours: 3,
  supervisorName: "Dana Reyes",
};

describe("creating a posting", () => {
  it("starts at pending_review, never published", async () => {
    const result = track(await createPosting(business(), validPosting), "postings");

    expect(result.ok).toBe(true);
    // The college is the local operator. An employer who could publish
    // directly would bypass the review that makes a posting credit-bearing.
    if (result.ok) expect(result.created.status).toBe("pending_review");
  });

  it("takes the owner from the membership, not the request", async () => {
    const result = track(
      await createPosting(business(), {
        ...validPosting,
        // Even if a caller smuggles these in, they are overwritten.
        ...({ businessId: "org-cherokee", marketId: "mkt-elsewhere" } as object),
      }),
      "postings",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created.businessId).toBe("org-apex");
      expect(result.created.marketId).toBe("mkt-pittsburg");
    }
  });

  it("refuses a non-employer", async () => {
    const result = await createPosting(student(), validPosting);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("enqueues notifications inside the transaction it was given", async () => {
    track(
      await createPosting(business(), validPosting, (posting) => [
        {
          marketId: posting.marketId,
          recipientUserId: "u-ellen",
          kind: "posting.submitted",
          payload: { postingTitle: posting.title },
        },
      ]),
      "postings",
    );

    expect(pendingNotifications).toHaveLength(1);
  });
});
