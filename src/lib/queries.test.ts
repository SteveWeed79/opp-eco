import { describe, it, expect } from "vitest";
import { funnel, stalledApplications, marketRemainingBudget } from "./queries";
import { contextFor } from "@/data/session";
import { repositories } from "@/data/memory";
import * as seed from "@/data/seed";

const admin = contextFor("admin");
const business = contextFor("business");

describe("funnel", () => {
  const stages = funnel(admin);
  const stageCount = (label: string) => stages.find((s) => s.label === label)!.count;

  it("never counts more at a later stage than an earlier one", () => {
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].count, `${stages[i].label} vs ${stages[i - 1].label}`)
        .toBeLessThanOrEqual(stages[i - 1].count);
    }
  });

  it("still counts a closed application in every stage it reached", () => {
    // app-26 is closed with furthestStatus credit_granted. Enumerating live
    // statuses per stage dropped it from all of them at once, so the funnel
    // appeared to shrink as work finished.
    const closed = seed.applications.find((a) => a.id === "app-26")!;
    expect(closed.status).toBe("closed");
    expect(closed.furthestStatus).toBe("credit_granted");

    const withoutClosed = seed.applications.filter((a) => a.status !== "closed").length;
    expect(stageCount("Credit granted")).toBeGreaterThan(0);
    expect(stageCount("Applied")).toBeGreaterThan(withoutClosed - 1);
  });

  it("counts a rejected application as applied but no further", () => {
    expect(stageCount("Applied")).toBe(repositories.applications.list(admin).length);
  });
});

describe("query scoping", () => {
  it("scopes stalled work to the calling actor, not to admin", () => {
    const own = new Set(
      seed.postings
        .filter((p) => p.businessId === business.membership.organizationId)
        .map((p) => p.id),
    );
    const leaked = stalledApplications(business).filter(
      (item) => !own.has(item.application.postingId),
    );
    expect(leaked).toHaveLength(0);
  });

  it("gives admin a wider view of stalled work than a single business", () => {
    expect(stalledApplications(admin).length).toBeGreaterThan(
      stalledApplications(business).length,
    );
  });
});

describe("budget", () => {
  it("never reports more committed than the allocation", () => {
    for (const market of repositories.markets.list(admin)) {
      const remaining = marketRemainingBudget(admin, market);
      expect(remaining).toBeLessThanOrEqual(market.subsidyBudget);
    }
  });

  it("leaves the live market with allocation still uncommitted", () => {
    const live = repositories.markets.list(admin).find((m) => m.stage === "live")!;
    expect(marketRemainingBudget(admin, live)).toBeGreaterThan(0);
  });
});
