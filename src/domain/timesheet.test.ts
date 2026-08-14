import { describe, it, expect } from "vitest";
import type { Application, TimeEntry } from "./types";
import {
  OPEN_WEEK_WINDOW,
  byWeekDescending,
  claimedWeeks,
  openWeeksFor,
  reimbursementFor,
  timesheetTotals,
  weekStartingFor,
} from "./timesheet";

function entry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "te-1",
    marketId: "mkt-1",
    applicationId: "app-1",
    studentId: "stu-1",
    businessId: "org-1",
    weekStarting: "2026-03-02",
    hours: 20,
    summary: "Wired the intake form",
    status: "submitted",
    submittedOn: "2026-03-09T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: "app-1",
    marketId: "mkt-1",
    postingId: "post-1",
    studentId: "stu-1",
    track: "standard",
    status: "placement_active",
    submittedOn: "2026-01-05T12:00:00.000Z",
    statusSince: "2026-02-01T12:00:00.000Z",
    matchScore: { score: 80, algorithmVersion: "v1", factors: [] },
    version: 1,
    ...overrides,
  };
}

describe("what a placement's hours add up to", () => {
  it("separates what was claimed from what was signed off", () => {
    // The distinction the whole feature exists for. Conflating them is how a
    // platform tells a board money is owed on hours nobody verified.
    const totals = timesheetTotals([
      entry({ id: "a", status: "approved", hours: 32 }),
      entry({ id: "b", status: "submitted", hours: 18 }),
    ]);

    expect(totals.approved).toBe(32);
    expect(totals.awaitingReview).toBe(18);
    expect(totals.logged).toBe(50);
  });

  it("does not count a rejected week as logged", () => {
    // Otherwise a student inflates their apparent contribution by submitting
    // weeks that were sent back.
    const totals = timesheetTotals([
      entry({ id: "a", status: "approved", hours: 30 }),
      entry({ id: "b", status: "rejected", hours: 40 }),
    ]);

    expect(totals.logged).toBe(30);
    expect(totals.rejected).toBe(40);
  });

  it("counts the weeks still sitting with the employer", () => {
    const totals = timesheetTotals([
      entry({ id: "a", status: "submitted", weekStarting: "2026-03-02" }),
      entry({ id: "b", status: "submitted", weekStarting: "2026-03-09" }),
      entry({ id: "c", status: "approved", weekStarting: "2026-02-23" }),
    ]);

    expect(totals.unreviewedWeeks).toBe(2);
  });

  it("is all zeroes for a placement with no timesheet yet", () => {
    expect(timesheetTotals([])).toEqual({
      logged: 0,
      approved: 0,
      awaitingReview: 0,
      rejected: 0,
      unreviewedWeeks: 0,
    });
  });
});

describe("what the board owes", () => {
  const funded = application({
    fundingAuthorizedHours: 200,
    fundingAuthorizedRate: 20,
  });

  it("pays the rate on approved hours inside the cap", () => {
    const result = reimbursementFor(funded, 150);

    expect(result.reimbursableHours).toBe(150);
    expect(result.amount).toBe(3000);
    expect(result.overCap).toBe(false);
  });

  it("pays only to the cap, and names who carries the rest", () => {
    // The case this calculation exists for. A supervisor approving a genuine
    // week does not know what the board committed three months ago, so the
    // overage is real and someone eats it — the employer.
    const result = reimbursementFor(funded, 230);

    expect(result.reimbursableHours).toBe(200);
    expect(result.unreimbursedHours).toBe(30);
    expect(result.amount).toBe(4000);
    expect(result.overCap).toBe(true);
  });

  it("never reports more than the cap consumed", () => {
    // The progress read would otherwise render past the end of its own bar.
    expect(reimbursementFor(funded, 400).capUsed).toBe(1);
  });

  it("owes nothing on an unsubsidized placement, and does not divide by zero", () => {
    // `unsubsidized` is a real terminal branch of the funding decision — the
    // placement goes ahead without board money.
    const result = reimbursementFor(application(), 120);

    expect(result.amount).toBe(0);
    expect(result.reimbursableHours).toBe(0);
    expect(result.unreimbursedHours).toBe(120);
    expect(result.capUsed).toBe(0);
  });
});

describe("which week a submission belongs to", () => {
  it.each([
    ["2026-03-02T09:00:00Z", "2026-03-02", "a Monday is its own week"],
    ["2026-03-04T09:00:00Z", "2026-03-02", "a Wednesday"],
    ["2026-03-08T23:00:00Z", "2026-03-02", "a Sunday closes the week it ends"],
    ["2026-03-09T00:30:00Z", "2026-03-09", "the following Monday opens a new one"],
  ])("%s is the week of %s (%s)", (input, expected) => {
    expect(weekStartingFor(new Date(input))).toBe(expected);
  });

  it("crosses a month boundary without losing the week", () => {
    expect(weekStartingFor(new Date("2026-04-01T12:00:00Z"))).toBe("2026-03-30");
  });
});

describe("weeks already claimed", () => {
  it("blocks a week that is submitted or approved", () => {
    const claimed = claimedWeeks([
      entry({ id: "a", status: "approved", weekStarting: "2026-03-02" }),
      entry({ id: "b", status: "submitted", weekStarting: "2026-03-09" }),
    ]);

    expect(claimed.has("2026-03-02")).toBe(true);
    expect(claimed.has("2026-03-09")).toBe(true);
  });

  it("frees a rejected week to be corrected and resubmitted", () => {
    // Which is the entire point of rejecting rather than deleting. A student
    // told "you logged Tuesday twice" has to be able to fix it.
    const claimed = claimedWeeks([
      entry({ id: "a", status: "rejected", weekStarting: "2026-03-02" }),
    ]);

    expect(claimed.has("2026-03-02")).toBe(false);
  });
});

describe("the seeded data agrees with itself", () => {
  it("reconciles every placement's cached totals against its entries", async () => {
    // `hoursLogged` and `hoursApproved` are a cache over the time entries,
    // kept because the transition guards and the credit calculation take an
    // Application and no repository. A cache that can drift is a bug waiting
    // to be reported as "the board paid the wrong amount", so it is pinned
    // here for every seeded placement rather than trusted.
    const seed = await import("@/data/seed");

    const standard = seed.applications.filter(
      (a) => a.track === "standard" && (a.hoursLogged ?? 0) > 0,
    );
    expect(standard.length).toBeGreaterThan(0);

    for (const application of standard) {
      const totals = timesheetTotals(
        seed.timeEntries.filter((e) => e.applicationId === application.id),
      );

      expect(totals.logged, `${application.id} logged`).toBe(application.hoursLogged);
      expect(totals.approved, `${application.id} approved`).toBe(
        application.hoursApproved,
      );
    }
  });

  it("writes no timesheet for a fixed-fee micro project", async () => {
    // There is no hourly wage to reimburse and no supervisor watching the
    // clock. Billing one by the hour would misstate what was bought.
    const seed = await import("@/data/seed");
    const micro = new Set(
      seed.applications.filter((a) => a.track === "micro").map((a) => a.id),
    );

    expect(micro.size).toBeGreaterThan(0);
    expect(seed.timeEntries.filter((e) => micro.has(e.applicationId))).toEqual([]);
  });

  it("never claims one week twice on a placement", async () => {
    const seed = await import("@/data/seed");
    const byApplication = new Map<string, string[]>();

    for (const entry of seed.timeEntries) {
      if (entry.status === "rejected") continue;
      const weeks = byApplication.get(entry.applicationId) ?? [];
      weeks.push(entry.weekStarting);
      byApplication.set(entry.applicationId, weeks);
    }

    for (const [applicationId, weeks] of byApplication) {
      expect(new Set(weeks).size, `${applicationId} has a duplicate week`).toBe(
        weeks.length,
      );
    }
  });
});

describe("which weeks are still open to log", () => {
  const now = new Date("2026-03-11T12:00:00Z"); // a Wednesday
  const started = new Date("2026-02-16T12:00:00Z");

  it("offers the week in progress and the weeks behind it", () => {
    expect(openWeeksFor(started, now, [])).toEqual([
      "2026-03-09",
      "2026-03-02",
      "2026-02-23",
      "2026-02-16",
    ]);
  });

  it("never offers a week before the placement started", () => {
    // Logging hours against a placement that had not begun is not a correction
    // anyone needs to make.
    const weeks = openWeeksFor(started, now, []);
    expect(weeks.every((w) => w >= "2026-02-16")).toBe(true);
  });

  it("leaves out weeks already claimed", () => {
    const weeks = openWeeksFor(started, now, [
      entry({ id: "a", weekStarting: "2026-03-02", status: "approved" }),
    ]);
    expect(weeks).not.toContain("2026-03-02");
  });

  it("offers a sent-back week again", () => {
    const weeks = openWeeksFor(started, now, [
      entry({ id: "a", weekStarting: "2026-03-02", status: "rejected" }),
    ]);
    expect(weeks).toContain("2026-03-02");
  });

  it("is empty once every week is accounted for", () => {
    const weeks = openWeeksFor(started, now, []).map((weekStarting, i) =>
      entry({ id: `e${i}`, weekStarting, status: "approved" }),
    );
    expect(openWeeksFor(started, now, weeks)).toEqual([]);
  });

  it("does not offer thirty weeks on a placement that has run all year", () => {
    // A dropdown that long is one a student picks the wrong entry from.
    const longRunning = new Date("2025-06-01T12:00:00Z");
    expect(openWeeksFor(longRunning, now, []).length).toBe(OPEN_WEEK_WINDOW);
  });
});

describe("display order", () => {
  it("puts the most recent week first", () => {
    const weeks = [
      entry({ id: "a", weekStarting: "2026-02-23" }),
      entry({ id: "b", weekStarting: "2026-03-09" }),
      entry({ id: "c", weekStarting: "2026-03-02" }),
    ]
      .sort(byWeekDescending)
      .map((e) => e.weekStarting);

    expect(weeks).toEqual(["2026-03-09", "2026-03-02", "2026-02-23"]);
  });
});
