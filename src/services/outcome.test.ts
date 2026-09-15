/**
 * The follow-up write path.
 *
 * These write to the shared seed arrays, so every test records what it added
 * and removes it again — otherwise the counts the reporting suites assert on
 * drift depending on which file ran first.
 */

import { describe, it, expect, afterEach } from "vitest";
import { recordOutcome } from "./creation";
import { contextFor } from "@/data/session";
import * as seed from "@/data/seed";

const added: string[] = [];

afterEach(() => {
  for (const id of added) {
    const i = seed.outcomes.findIndex((o) => o.id === id);
    if (i !== -1) seed.outcomes.splice(i, 1);
    const j = seed.auditEvents.findIndex((e) => e.entityId === id);
    if (j !== -1) seed.auditEvents.splice(j, 1);
  }
  added.length = 0;
});

const college = () => contextFor("college");
const admin = () => contextFor("admin");
const board = () => contextFor("board");
const business = () => contextFor("business");
const student = () => contextFor("student");

function track<T extends { ok: boolean; created?: { id: string } }>(result: T): T {
  if (result.created) added.push(result.created.id);
  return result;
}

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString();

/** An exited placement with nothing recorded against it yet. */
function unmeasuredPlacement() {
  const measured = new Set(seed.outcomes.map((o) => o.applicationId));
  const application = seed.applications.find(
    (a) => a.status === "placement_completed" && !measured.has(a.id),
  );
  if (!application) throw new Error("no unmeasured placement in the seed");
  return application;
}

describe("who may record an outcome", () => {
  it("lets the college record one", async () => {
    const application = unmeasuredPlacement();
    const result = track(
      await recordOutcome(college(), {
        studentId: application.studentId,
        applicationId: application.id,
        kind: "employed_in_region",
        observedOn: yesterday(),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("lets an administrator record one", async () => {
    const application = unmeasuredPlacement();
    const result = track(
      await recordOutcome(admin(), {
        studentId: application.studentId,
        applicationId: application.id,
        kind: "continued_education",
        observedOn: yesterday(),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ["the board", board],
    ["an employer", business],
    ["a learner", student],
  ])("refuses %s", async (_label, actor) => {
    const application = unmeasuredPlacement();
    const result = await recordOutcome(actor(), {
      studentId: application.studentId,
      applicationId: application.id,
      kind: "employed_by_host",
      observedOn: yesterday(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });
});

describe("what it refuses", () => {
  it("refuses a placement that is still running", async () => {
    const running = seed.applications.find((a) => a.status === "placement_active")!;
    const result = await recordOutcome(college(), {
      studentId: running.studentId,
      applicationId: running.id,
      kind: "employed_by_host",
      observedOn: yesterday(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/still running/i);
  });

  it("refuses an application that never reached a placement", async () => {
    const rejected = seed.applications.find((a) => a.status === "rejected")!;
    const result = await recordOutcome(college(), {
      studentId: rejected.studentId,
      applicationId: rejected.id,
      kind: "still_seeking",
      observedOn: yesterday(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/never reached a placement/i);
  });

  it("refuses an outcome observed in the future", async () => {
    // Nothing is observed before it happens, and a row like this lands in a
    // quarter that has not happened either.
    const application = unmeasuredPlacement();
    const result = await recordOutcome(college(), {
      studentId: application.studentId,
      applicationId: application.id,
      kind: "employed_by_host",
      observedOn: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/future/i);
  });

  it("refuses a placement belonging to a different learner", async () => {
    const application = unmeasuredPlacement();
    const other = seed.students.find((s) => s.id !== application.studentId)!;
    const result = await recordOutcome(college(), {
      studentId: other.id,
      applicationId: application.id,
      kind: "employed_by_host",
      observedOn: yesterday(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("refuses the same observation twice", async () => {
    const application = unmeasuredPlacement();
    const observedOn = yesterday();
    const first = track(
      await recordOutcome(college(), {
        studentId: application.studentId,
        applicationId: application.id,
        kind: "employed_by_host",
        observedOn,
      }),
    );
    expect(first.ok).toBe(true);

    const second = await recordOutcome(college(), {
      studentId: application.studentId,
      applicationId: application.id,
      kind: "employed_by_host",
      observedOn,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("duplicate");
  });

  it("refuses a date that is not one", async () => {
    const application = unmeasuredPlacement();
    const result = await recordOutcome(college(), {
      studentId: application.studentId,
      applicationId: application.id,
      kind: "employed_by_host",
      observedOn: "not a date",
    });
    expect(result.ok).toBe(false);
  });
});

describe("what it writes", () => {
  it("freezes the source from the acting membership, never the caller", async () => {
    // A caller who could name the source could file their own guess as a
    // college's finding.
    const application = unmeasuredPlacement();
    const result = track(
      await recordOutcome(admin(), {
        studentId: application.studentId,
        applicationId: application.id,
        kind: "employed_in_region",
        observedOn: yesterday(),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created.source).toBe("admin");
      expect(result.created.recordedByUserId).toBe(admin().user.id);
    }
  });

  it("derives the market from the learner rather than the request", async () => {
    const application = unmeasuredPlacement();
    const learner = seed.students.find((s) => s.id === application.studentId)!;
    const result = track(
      await recordOutcome(college(), {
        studentId: application.studentId,
        applicationId: application.id,
        kind: "employed_by_host",
        observedOn: yesterday(),
      }),
    );
    if (result.ok) expect(result.created.marketId).toBe(learner.marketId);
  });

  it("audits the record in the same transaction", async () => {
    // The same rule as every other write here: a record with no audit entry is
    // unauditable, and the two must land together or not at all.
    const application = unmeasuredPlacement();
    const result = track(
      await recordOutcome(college(), {
        studentId: application.studentId,
        applicationId: application.id,
        kind: "employed_elsewhere",
        observedOn: yesterday(),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const event = seed.auditEvents.find((e) => e.entityId === result.created.id);
    expect(event).toBeDefined();
    expect(event!.entityType).toBe("outcome");
    expect(event!.to).toBe("employed_elsewhere");
    expect(event!.viaOverride).toBe(false);
  });

  it("drops blank detail rather than storing an empty string", async () => {
    // The column refuses a blank, and an empty string that renders as a stray
    // dash is the kind of thing nobody notices until a report ships.
    const application = unmeasuredPlacement();
    const result = track(
      await recordOutcome(college(), {
        studentId: application.studentId,
        applicationId: application.id,
        kind: "still_seeking",
        observedOn: yesterday(),
        detail: "   ",
      }),
    );
    if (result.ok) expect(result.created.detail).toBeUndefined();
  });

  it("accepts a learner with no placement at all", async () => {
    // A learner reached through mentorship alone has no application, and that
    // is a real case rather than missing data.
    const learner = seed.students.find((s) => s.status === "verified")!;
    const result = track(
      await recordOutcome(college(), {
        studentId: learner.id,
        applicationId: null,
        kind: "entered_training",
        observedOn: yesterday(),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.created.applicationId).toBeNull();
  });

  it("records a second observation about the same placement", async () => {
    // Two follow-ups are two facts, not a correction of the first. Nothing here
    // supersedes anything.
    const application = unmeasuredPlacement();
    const first = track(
      await recordOutcome(college(), {
        studentId: application.studentId,
        applicationId: application.id,
        kind: "still_seeking",
        observedOn: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      }),
    );
    const second = track(
      await recordOutcome(college(), {
        studentId: application.studentId,
        applicationId: application.id,
        kind: "employed_in_region",
        observedOn: yesterday(),
      }),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });
});
