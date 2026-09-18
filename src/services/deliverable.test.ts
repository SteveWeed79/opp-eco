/**
 * The micro track's hand-in, and the employer's answer to it.
 *
 * These mutate the shared seed arrays, so each test puts back what it changed.
 *
 * The test worth reading first is the fixture-consistency one. Everything else
 * checks a write path; that one checks the invariant the whole design rests on
 * — that `Application.deliverableSubmitted` and `deliverableAccepted` agree
 * with the deliverable behind them. They are denormalised on purpose, because
 * the state machine and the credit calculation are pure functions of an
 * application, and a fixture set where they disagree would make the micro track
 * behave differently on the two backends with nothing to say why.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  acceptDeliverable,
  requestRevision,
  submitDeliverable,
} from "./deliverable";
import { contextFor } from "@/data/session";
import { repositories } from "@/data/backend";
import { workHoursFor } from "@/domain/credit";
import { availableTransitions } from "@/domain/workflow";
import * as seed from "@/data/seed";

const original = seed.deliverables.map((d) => ({ ...d }));
const applications = seed.applications.map((a) => ({ ...a }));

afterEach(() => {
  seed.deliverables.splice(0, seed.deliverables.length, ...original.map((d) => ({ ...d })));
  seed.applications.splice(0, seed.applications.length, ...applications.map((a) => ({ ...a })));
  for (const e of seed.auditEvents.filter((a) => a.entityType === "deliverable")) {
    seed.auditEvents.splice(seed.auditEvents.indexOf(e), 1);
  }
});

const student = () => contextFor("student");
const business = () => contextFor("business");
const college = () => contextFor("college");
const board = () => contextFor("board");

/** `stu-omar`'s running micro placement, sent back for revision by the seed. */
const REVISING = "app-15";
const LONG = "Ranked the coverage gaps by what each would cost us if it broke.";

describe("the fixtures agree with themselves", () => {
  it("keeps the two flags in step with the deliverable behind them", () => {
    for (const application of seed.applications) {
      if (application.track !== "micro") continue;
      const deliverable = seed.deliverables.find(
        (d) => d.applicationId === application.id,
      );
      // Submitted means a hand-in is waiting on the employer. A deliverable
      // that came back for revision is *not* submitted, which is exactly what
      // takes the employer's Accept button away again.
      expect(
        Boolean(application.deliverableSubmitted),
        `${application.id} deliverableSubmitted`,
      ).toBe(deliverable?.status === "submitted" || deliverable?.status === "accepted");
      expect(
        Boolean(application.deliverableAccepted),
        `${application.id} deliverableAccepted`,
      ).toBe(deliverable?.status === "accepted");
    }
  });
});

describe("handing work in", () => {
  it("lets a learner hand in against their own running placement", async () => {
    const result = await submitDeliverable(student(), {
      applicationId: REVISING,
      summary: LONG,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updated.status).toBe("submitted");
    // A resubmission is the same row at a higher round, which is what makes
    // "the third version" a number rather than a join.
    expect(result.updated.round).toBe(2);
    expect(result.updated.response).toBeUndefined();
  });

  it("opens the employer's Accept, which was guarded shut", async () => {
    // The point of the whole feature: the transition has existed since the
    // first migration and nothing could satisfy its guard.
    const before = await repositories.applications.find(business(), REVISING);
    const shut = availableTransitions(business(), {
      application: before!,
      student: seed.students.find((s) => s.id === before!.studentId)!,
      remainingBudget: 100_000,
      postingOwnerId: "org-apex",
      unreviewedWeeks: 0,
    });
    expect(shut.some((t) => t.to === "placement_completed")).toBe(false);

    await submitDeliverable(student(), { applicationId: REVISING, summary: LONG });

    const after = await repositories.applications.find(business(), REVISING);
    const open = availableTransitions(business(), {
      application: after!,
      student: seed.students.find((s) => s.id === after!.studentId)!,
      remainingBudget: 100_000,
      postingOwnerId: "org-apex",
      unreviewedWeeks: 0,
    });
    expect(open.some((t) => t.to === "placement_completed")).toBe(true);
  });

  it("refuses somebody else's placement", async () => {
    const result = await submitDeliverable(student(), {
      applicationId: "app-14",
      summary: LONG,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a standard placement", async () => {
    // A standard placement is assessed on approved hours and an evaluation,
    // neither of which this record is.
    const result = await submitDeliverable(student(), {
      applicationId: "app-4",
      summary: LONG,
    });
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("refuses a second hand-in while the first is still with the employer", async () => {
    await submitDeliverable(student(), { applicationId: REVISING, summary: LONG });
    const again = await submitDeliverable(student(), {
      applicationId: REVISING,
      summary: "Another go at the same thing entirely.",
    });
    expect(again).toMatchObject({ ok: false, code: "conflict" });
  });

  it("refuses a description too short to be worth reading", async () => {
    const result = await submitDeliverable(student(), {
      applicationId: REVISING,
      summary: "done",
    });
    expect(result).toMatchObject({ ok: false, code: "conflict" });
  });
});

describe("the employer's answer", () => {
  const handIn = () =>
    submitDeliverable(student(), { applicationId: REVISING, summary: LONG });

  it("sends work back with an instruction, leaving the placement running", async () => {
    await handIn();
    const d = await repositories.deliverables.forApplication(business(), REVISING);
    const result = await requestRevision(
      business(),
      d!.id,
      "Rank them by cost rather than by module, and we are there.",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updated.status).toBe("revision_requested");

    const application = await repositories.applications.find(business(), REVISING);
    // Still running, and the Accept button is shut again.
    expect(application?.status).toBe("placement_active");
    expect(application?.deliverableSubmitted).toBe(false);
  });

  it("refuses a revision with nothing to act on", async () => {
    await handIn();
    const d = await repositories.deliverables.forApplication(business(), REVISING);
    expect(await requestRevision(business(), d!.id, "no")).toMatchObject({
      ok: false,
      code: "conflict",
    });
  });

  it("accepting completes the placement and makes the hours count", async () => {
    await handIn();
    const d = await repositories.deliverables.forApplication(business(), REVISING);

    const posting = await repositories.postings.find(business(), "post-apex-qa");
    const before = await repositories.applications.find(business(), REVISING);
    // Nothing counts toward a credit until the work is taken.
    expect(workHoursFor(before!, posting!)).toBe(0);

    const result = await acceptDeliverable(
      business(),
      d!.id,
      "Exactly what we needed — the ranking is what makes it usable.",
    );
    expect(result.ok).toBe(true);

    const after = await repositories.applications.find(business(), REVISING);
    expect(after?.status).toBe("placement_completed");
    expect(after?.deliverableAccepted).toBe(true);
    expect(workHoursFor(after!, posting!)).toBeGreaterThan(0);
  });

  it("refuses an acceptance with no evaluation in it", async () => {
    // Acceptance *is* the evaluation on this track, so an empty one is the
    // entire academic record of a credit-bearing placement.
    await handIn();
    const d = await repositories.deliverables.forApplication(business(), REVISING);
    expect(await acceptDeliverable(business(), d!.id, "   ")).toMatchObject({
      ok: false,
      code: "conflict",
    });
  });

  it("refuses anybody but the hosting employer", async () => {
    await handIn();
    const d = await repositories.deliverables.forApplication(college(), REVISING);
    expect(await acceptDeliverable(college(), d!.id, "Looks fine to me.")).toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });
});

describe("who can read one", () => {
  it("shows the learner their own and the employer theirs", async () => {
    expect(await repositories.deliverables.forApplication(student(), REVISING)).not.toBeNull();
    expect(await repositories.deliverables.forApplication(business(), REVISING)).not.toBeNull();
  });

  it("shows the college, which awards credit against the acceptance", async () => {
    // A deliverable the college cannot read is a credit decision made blind.
    expect(await repositories.deliverables.forApplication(college(), REVISING)).not.toBeNull();
  });

  it("shows the board nothing", async () => {
    // Micro-internships are unsubsidised, so no public money rides on one and
    // the board has no workflow reason to read a learner's work.
    expect(await repositories.deliverables.list(board())).toEqual([]);
    expect(await repositories.deliverables.forApplication(board(), REVISING)).toBeNull();
  });
});
