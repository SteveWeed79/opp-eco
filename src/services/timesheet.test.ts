import { describe, it, expect, beforeEach } from "vitest";
import { logHours, reviewHours, reviewQueue } from "./timesheet";
import { contextFor } from "@/data/session";
import { repositories } from "@/data/memory";
import { timesheetTotals } from "@/domain/timesheet";
import * as seed from "@/data/seed";
import { pendingNotifications } from "@/data/memory-store";

/**
 * The write path for hours.
 *
 * These mutate the shared seed arrays, so each test undoes what it added and
 * restores the rows it changed — otherwise the totals every other suite
 * asserts on drift depending on what ran first.
 */

/** Omar's active placement, supervised by the seeded employer account. */
const PLACEMENT = "app-27";

const added: string[] = [];
let snapshot: {
  entries: typeof seed.timeEntries;
  applications: string[];
};

beforeEach(() => {
  for (const id of added) {
    const i = seed.timeEntries.findIndex((e) => e.id === id);
    if (i !== -1) seed.timeEntries.splice(i, 1);
  }
  added.length = 0;

  // Deep-restore every row this suite can touch, because approving an entry
  // mutates it in place and bumps its version.
  if (snapshot) {
    for (const saved of snapshot.entries) {
      const i = seed.timeEntries.findIndex((e) => e.id === saved.id);
      if (i !== -1) seed.timeEntries[i] = { ...saved };
    }
    for (const saved of snapshot.applications) {
      const parsed = JSON.parse(saved);
      const i = seed.applications.findIndex((a) => a.id === parsed.id);
      if (i !== -1) seed.applications[i] = parsed;
    }
  } else {
    snapshot = {
      entries: seed.timeEntries.map((e) => ({ ...e })),
      applications: seed.applications.map((a) => JSON.stringify(a)),
    };
  }

  pendingNotifications.length = 0;
});

const student = () => contextFor("student");
const business = () => contextFor("business");
const board = () => contextFor("board");
const college = () => contextFor("college");

/** A Monday nobody has claimed on the placement yet. */
function freeWeek(): string {
  const claimed = new Set(
    seed.timeEntries
      .filter((e) => e.applicationId === PLACEMENT)
      .map((e) => e.weekStarting),
  );
  for (let back = 1; back < 60; back++) {
    const d = new Date(Date.now() - back * 7 * 86_400_000);
    const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    utc.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() + 6) % 7));
    const week = utc.toISOString().slice(0, 10);
    if (!claimed.has(week)) return week;
  }
  throw new Error("no free week in the seed");
}

async function log(overrides: Partial<Parameters<typeof logHours>[1]> = {}) {
  const result = await logHours(student(), {
    applicationId: PLACEMENT,
    weekStarting: freeWeek(),
    hours: 16,
    summary: "Wrote the importer tests.",
    ...overrides,
  });
  if (result.ok) added.push(result.value.id);
  return result;
}

describe("a student logs a week", () => {
  it("records it as submitted, not approved", async () => {
    // The distinction the feature exists for. Self-reported hours nobody
    // countersigned are not something a board can reimburse against.
    const result = await log();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("submitted");
    expect(result.value.reviewedOn).toBeUndefined();
  });

  it("updates the placement's logged total but not its approved total", async () => {
    const before = seed.applications.find((a) => a.id === PLACEMENT)!;
    const approvedBefore = before.hoursApproved;
    const loggedBefore = before.hoursLogged ?? 0;

    await log({ hours: 16 });

    const after = seed.applications.find((a) => a.id === PLACEMENT)!;
    expect(after.hoursLogged).toBe(loggedBefore + 16);
    expect(after.hoursApproved).toBe(approvedBefore);
  });

  it("derives the student from the session, not from the request", async () => {
    const result = await log();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A caller supplying their own student id would supply their own timesheet.
    expect(result.value.studentId).toBe("stu-omar");
  });

  it("normalises a mid-week date to the Monday", async () => {
    // Otherwise weeks overlap and cannot be reconciled against each other.
    const monday = freeWeek();
    const wednesday = new Date(`${monday}T00:00:00Z`);
    wednesday.setUTCDate(wednesday.getUTCDate() + 2);

    const result = await log({ weekStarting: wednesday.toISOString() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.weekStarting).toBe(monday);
  });

  it("tells the supervising employer, not the whole market", async () => {
    await log();
    const sent = pendingNotifications.filter((n) => n.kind === "hours.submitted");

    expect(sent).toHaveLength(1);
    expect(sent[0].recipientOrganizationId).toBe("org-apex");
  });

  it("refuses the same week twice", async () => {
    const week = freeWeek();
    await log({ weekStarting: week });
    const second = await log({ weekStarting: week });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("duplicate");
  });

  it("refuses a week that has not happened yet", async () => {
    const nextWeek = new Date(Date.now() + 8 * 86_400_000).toISOString();
    const result = await log({ weekStarting: nextWeek });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("has not happened yet");
  });

  it("refuses a figure that is obviously a typo", async () => {
    // 400 is a fat-fingered 40. Catching it here is cheaper than catching it
    // in a reimbursement claim.
    const result = await log({ hours: 400 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid");
  });

  it.each([0, -8, Number.NaN])("refuses %s hours", async (hours) => {
    const result = await log({ hours });
    expect(result.ok).toBe(false);
  });

  it("refuses a week with no description of the work", async () => {
    // The supervisor approves against it, and the college reads it for credit.
    const result = await log({ summary: "   " });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Describe what you worked on");
  });

  it("refuses an employer trying to log hours on a student's behalf", async () => {
    const result = await logHours(business(), {
      applicationId: PLACEMENT,
      weekStarting: freeWeek(),
      hours: 10,
      summary: "On site all week.",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("forbidden");
  });

  it("refuses a placement that is not active", async () => {
    // app-24 is completed. Logging against it would reopen a closed claim.
    const result = await logHours(student(), {
      applicationId: "app-24",
      weekStarting: freeWeek(),
      hours: 10,
      summary: "Late entry.",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("forbidden");
  });

  it("refuses a micro-internship, which is bought as a deliverable", async () => {
    const micro = seed.applications.find(
      (a) => a.track === "micro" && a.studentId === "stu-omar",
    )!;
    const result = await logHours(student(), {
      applicationId: micro.id,
      weekStarting: freeWeek(),
      hours: 10,
      summary: "Worked on the project.",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not by the hour");
  });
});

describe("the supervisor reviews it", () => {
  it("approving moves the hours into the approved total", async () => {
    const logged = await log({ hours: 12 });
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;

    const before = seed.applications.find((a) => a.id === PLACEMENT)!.hoursApproved ?? 0;
    const result = await reviewHours(business(), {
      entryId: logged.value.id,
      decision: "approve",
    });

    expect(result.ok).toBe(true);
    const after = seed.applications.find((a) => a.id === PLACEMENT)!;
    expect(after.hoursApproved).toBe(before + 12);
  });

  it("rejecting takes the hours back out of the logged total", async () => {
    // A sent-back week is no longer a claim. Leaving it in would let a student
    // inflate their apparent contribution by submitting weeks that bounced.
    const logged = await log({ hours: 12 });
    if (!logged.ok) return;

    const before = seed.applications.find((a) => a.id === PLACEMENT)!.hoursLogged ?? 0;
    await reviewHours(business(), {
      entryId: logged.value.id,
      decision: "reject",
      note: "Those dates overlap with last week.",
    });

    const after = seed.applications.find((a) => a.id === PLACEMENT)!;
    expect(after.hoursLogged).toBe(before - 12);
  });

  it("will not reject without saying what to fix", async () => {
    const logged = await log();
    if (!logged.ok) return;

    const result = await reviewHours(business(), {
      entryId: logged.value.id,
      decision: "reject",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid");
  });

  it("frees a rejected week to be corrected and resubmitted", async () => {
    const week = freeWeek();
    const first = await log({ weekStarting: week, hours: 12 });
    if (!first.ok) return;

    await reviewHours(business(), {
      entryId: first.value.id,
      decision: "reject",
      note: "Wrong week.",
    });

    const second = await log({ weekStarting: week, hours: 8 });
    expect(second.ok).toBe(true);
  });

  it("refuses a college trying to approve hours it did not supervise", async () => {
    // The college awards credit for the work but was not there. Only the party
    // that can attest to attendance may sign off — that is the whole
    // evidentiary basis for reimbursing public money against these rows.
    const logged = await log();
    if (!logged.ok) return;

    const result = await reviewHours(college(), {
      entryId: logged.value.id,
      decision: "approve",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("forbidden");
  });

  it("refuses a second review of an already-reviewed week", async () => {
    const logged = await log();
    if (!logged.ok) return;

    await reviewHours(business(), { entryId: logged.value.id, decision: "approve" });
    const again = await reviewHours(business(), {
      entryId: logged.value.id,
      decision: "reject",
      note: "Changed my mind.",
    });

    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe("conflict");
  });

  it("tells the student either way", async () => {
    const logged = await log();
    if (!logged.ok) return;
    pendingNotifications.length = 0;

    await reviewHours(business(), { entryId: logged.value.id, decision: "approve" });

    const sent = pendingNotifications.filter((n) => n.kind === "hours.approved");
    expect(sent).toHaveLength(1);
    expect(sent[0].recipientUserId).toBe("u-omar");
  });
});

describe("the cache never drifts from the entries", () => {
  it("holds after a log and a review", async () => {
    // The invariant the transition guards and the credit calculation rest on.
    // They take an Application and no repository, so a wrong cache makes them
    // wrong silently.
    const logged = await log({ hours: 12 });
    if (!logged.ok) return;
    await reviewHours(business(), { entryId: logged.value.id, decision: "approve" });

    const application = seed.applications.find((a) => a.id === PLACEMENT)!;
    const totals = timesheetTotals(
      seed.timeEntries.filter((e) => e.applicationId === PLACEMENT),
    );

    expect(application.hoursLogged).toBe(totals.logged);
    expect(application.hoursApproved).toBe(totals.approved);
  });
});

describe("who can see what", () => {
  it("shows the employer only the placements they supervise", async () => {
    const mine = repositories.timeEntries.awaitingReview(business());
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((e) => e.businessId === "org-apex")).toBe(true);
  });

  it("shows a student only their own weeks", async () => {
    const mine = repositories.timeEntries.forStudent(student(), "stu-alex");
    // Alex has a seeded timesheet; Omar must not be able to read it.
    expect(mine).toEqual([]);
  });

  it("gives the college the work summaries, because it awards credit for them", () => {
    const entries = repositories.timeEntries.forApplication(college(), "app-1");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.summary.length > 0)).toBe(true);
  });

  it("gives the board the hours but not the summaries", () => {
    // The board validates a reimbursement claim against an hour cap. That
    // arithmetic does not take a description of what the student built, and
    // holding one invites retention and open-records questions it would
    // rather not answer.
    const entries = repositories.timeEntries.forApplication(board(), "app-1");

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.hours > 0)).toBe(true);
    expect(entries.every((e) => e.summary === "")).toBe(true);
    expect(entries.every((e) => e.reviewNote === undefined)).toBe(true);
  });

  it("withholds the summary from the board on a rejected week too", () => {
    // The review note is where a supervisor writes free text about a student's
    // conduct, which is the most sensitive field on the row.
    const rejected = repositories.timeEntries
      .forApplication(board(), "app-1")
      .filter((e) => e.status === "rejected");

    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.every((e) => e.reviewNote === undefined)).toBe(true);
  });
});

describe("the employer's queue", () => {
  it("joins each week to what it is against", () => {
    const queue = reviewQueue(business());

    expect(queue.length).toBeGreaterThan(0);
    for (const item of queue) {
      expect(item.entry.status).toBe("submitted");
      expect(item.posting.businessId).toBe("org-apex");
      expect(item.studentName.length).toBeGreaterThan(0);
    }
  });

  it("puts the week someone has waited longest on first", () => {
    const weeks = reviewQueue(business()).map((i) => i.entry.weekStarting);
    expect(weeks).toEqual([...weeks].sort());
  });
});
