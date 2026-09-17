import { describe, it, expect } from "vitest";
import {
  exitedPlacements,
  followUpQueue,
  funnel,
  marketFunding,
  marketRemainingBudget,
  outcomeReport,
  stalledApplications,
} from "./queries";
import { contextFor } from "@/data/session";
import { repositories } from "@/data/backend";
import * as seed from "@/data/seed";

const admin = contextFor("admin");
const business = contextFor("business");
const college = contextFor("college");
const board = contextFor("board");

describe("funnel", () => {
  const stageCount = async (label: string) =>
    (await funnel(admin)).find((s) => s.label === label)!.count;

  it("never counts more at a later stage than an earlier one", async () => {
    const stages = await funnel(admin);
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].count, `${stages[i].label} vs ${stages[i - 1].label}`)
        .toBeLessThanOrEqual(stages[i - 1].count);
    }
  });

  it("still counts a closed application in every stage it reached", async () => {
    // app-26 is closed with furthestStatus credit_granted. Enumerating live
    // statuses per stage dropped it from all of them at once, so the funnel
    // appeared to shrink as work finished.
    const closed = seed.applications.find((a) => a.id === "app-26")!;
    expect(closed.status).toBe("closed");
    expect(closed.furthestStatus).toBe("credit_granted");

    const withoutClosed = seed.applications.filter((a) => a.status !== "closed").length;
    expect(await stageCount("Credit granted")).toBeGreaterThan(0);
    expect(await stageCount("Applied")).toBeGreaterThan(withoutClosed - 1);
  });

  it("counts a rejected application as applied but no further", async () => {
    expect(await stageCount("Applied")).toBe(
      (await repositories.applications.list(admin)).length,
    );
  });
});

describe("query scoping", () => {
  it("scopes stalled work to the calling actor, not to admin", async () => {
    const own = new Set(
      seed.postings
        .filter((p) => p.businessId === business.membership.organizationId)
        .map((p) => p.id),
    );
    const leaked = (await stalledApplications(business)).filter(
      (item) => !own.has(item.application.postingId),
    );
    expect(leaked).toHaveLength(0);
  });

  it("gives admin a wider view of stalled work than a single business", async () => {
    expect((await stalledApplications(admin)).length).toBeGreaterThan(
      (await stalledApplications(business)).length,
    );
  });
});

describe("budget", () => {
  it("never reports more remaining than the fund holds", async () => {
    for (const market of await repositories.markets.list(admin)) {
      const funding = await marketFunding(admin, market.id);
      const remaining = await marketRemainingBudget(admin, market);
      expect(remaining).toBeLessThanOrEqual(funding.wage?.source.allocated ?? 0);
    }
  });

  it("leaves the live market with allocation still uncommitted", async () => {
    const live = (await repositories.markets.list(admin)).find((m) => m.stage === "live")!;
    expect(await marketRemainingBudget(admin, live)).toBeGreaterThan(0);
  });

  it("reports zero rather than throwing for a market with no fund yet", async () => {
    // Beloit's board is still in conversation, so nobody sponsors a wage fund.
    // A market being unfunded is a stage, not an error, and every screen that
    // divides by an allocation has to survive it.
    const unfunded = (await repositories.markets.list(admin)).find(
      (m) => m.stage === "board_engaged",
    )!;
    const funding = await marketFunding(admin, unfunded.id);
    expect(funding.wage).toBeNull();
    expect(await marketRemainingBudget(admin, unfunded)).toBe(0);
  });

  it("derives the balance from the ledger rather than from the applications", async () => {
    // The old definition summed authorized hours × rate over non-terminal
    // applications. It is deliberately no longer the same number: a placement
    // that ran and finished has *spent* its commitment, where that test counted
    // it as freed. This pins the new one against the commitments themselves.
    const live = (await repositories.markets.list(admin)).find((m) => m.stage === "live")!;
    const funding = await marketFunding(admin, live.id);
    const commitments = await repositories.fundingCommitments.list(admin);

    const fromLedger = commitments
      .filter((c) => c.fundingSourceId === funding.wage!.source.id && c.status !== "released")
      .reduce((sum, c) => sum + c.amount, 0);

    expect(funding.wage!.committed).toBe(fromLedger);
    expect(funding.wage!.remaining).toBe(funding.wage!.source.allocated - fromLedger);
  });

  it("counts every fund in the market, not only the board's", async () => {
    const live = (await repositories.markets.list(admin)).find((m) => m.stage === "live")!;
    const funding = await marketFunding(admin, live.id);

    // The whole point of the change: money that is not the board's exists.
    expect(funding.balances.length).toBeGreaterThan(1);
    expect(funding.totalAllocated).toBeGreaterThan(funding.wage!.source.allocated);
    expect(
      funding.balances.some((b) => b.source.purpose === "credit_cost"),
    ).toBe(true);
  });

  it("puts the wage fund first, so the board's own money leads its list", async () => {
    const live = (await repositories.markets.list(admin)).find((m) => m.stage === "live")!;
    const funding = await marketFunding(admin, live.id);
    expect(funding.balances[0].source.purpose).toBe("wage_subsidy");
  });
});

describe("the follow-up queue", () => {
  it("lists only finished experiences", async () => {
    const queue = await followUpQueue(college);
    expect(queue.length).toBeGreaterThan(0);
    for (const item of queue) {
      expect(item.application.status).not.toBe("placement_active");
      expect(["rejected", "withdrawn"]).not.toContain(item.application.status);
    }
  });

  it("leaves out placements that already have an outcome", async () => {
    const measured = new Set(seed.outcomes.map((o) => o.applicationId));
    const queue = await followUpQueue(college);
    for (const item of queue) {
      expect(measured.has(item.application.id)).toBe(false);
    }
  });

  it("puts the longest wait first", async () => {
    const days = (await followUpQueue(college)).map((i) => i.days);
    expect([...days].sort((a, b) => b - a)).toEqual(days);
  });

  it("is empty for an employer, which cannot read an outcome at all", async () => {
    // Not because it has no finished placements — it has several — but because
    // `awaitsFollowUp` reads a list the employer is refused, and a queue built
    // from an empty list must not look like work nobody has done.
    expect(await followUpQueue(business)).toEqual([]);
  });
});

describe("the outcome report", () => {
  it("counts a learner once however many times they were followed up", async () => {
    // Jordan carries two observations three weeks apart. Summing rows would
    // let a diligent officer inflate the denominator by doing their job.
    const report = await outcomeReport(admin);
    const learners = new Set(seed.outcomes.map((o) => o.studentId));
    expect(report.measured).toBe(learners.size);
  });

  it("takes the most recent observation about a learner", async () => {
    // Jordan was "still looking" in the first and employed out of region in the
    // second, so the count of still-seeking learners must not include him.
    const report = await outcomeReport(admin);
    const seeking = report.byKind.find((k) => k.kind === "still_seeking")!;
    expect(seeking.count).toBe(0);
    expect(report.byKind.find((k) => k.kind === "employed")!.count).toBeGreaterThan(0);
    // And he is not counted as having stayed: the second observation puts him
    // in Wyandotte, which is not one of this market's counties.
    expect(report.regional).toBeLessThan(report.employed);
  });

  it("reports the unworked queue beside the rate", async () => {
    // A rate with no denominator in sight is a figure a reader cannot weigh,
    // and the seed ships with follow-ups still outstanding on purpose.
    const report = await outcomeReport(admin);
    expect(report.unmeasured).toBeGreaterThan(0);
    expect(report.unmeasured).toBe((await followUpQueue(admin)).length);
  });

  it("never rates above one", async () => {
    const report = await outcomeReport(admin);
    expect(report.regionalRate).not.toBeNull();
    expect(report.regionalRate!).toBeGreaterThan(0);
    expect(report.regionalRate!).toBeLessThanOrEqual(1);
  });

  it("counts every measured learner somewhere", async () => {
    const report = await outcomeReport(admin);
    const total = report.byKind.reduce((sum, k) => sum + k.count, 0);
    expect(total).toBe(report.measured);
  });

  it("measures fewer learners than have finished a placement", async () => {
    // The whole reason the queue exists. If these were equal the fixtures would
    // be demonstrating a follow-up process nobody has ever had to run.
    const report = await outcomeReport(admin);
    expect(report.measured).toBeLessThan((await exitedPlacements(admin)).length);
  });

  it("gives a board the same counts as the college that recorded them", async () => {
    // The board's narrowing is a projection, not a filter: it loses the free
    // text and none of the rows, so the two must agree on every number.
    const fromBoard = await outcomeReport(board);
    const fromCollege = await outcomeReport(college);
    expect(fromBoard.measured).toBe(fromCollege.measured);
    expect(fromBoard.regional).toBe(fromCollege.regional);
    expect(fromBoard.byKind).toEqual(fromCollege.byKind);
  });
});
