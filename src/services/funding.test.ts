/**
 * The funding write paths.
 *
 * These mutate the shared seed arrays, so each test records what it changed and
 * puts it back — otherwise the balances every other suite asserts on drift
 * depending on which file ran first.
 */

import { describe, it, expect, afterEach } from "vitest";
import { adjustFundingSource, commitFunds, releaseCommitment } from "./funding";
import { contextFor } from "@/data/session";
import { repositories } from "@/data/backend";
import { balanceOf } from "@/domain/funding";
import * as seed from "@/data/seed";

const WAGE = "fund-sek-wage";
const GRANT = "fund-ccln-credit";

const admin = () => contextFor("admin");
const board = () => contextFor("board");
const college = () => contextFor("college");

const originalSources = seed.fundingSources.map((s) => ({ ...s }));
const addedCommitments: string[] = [];
const touchedCommitments: import("@/domain/types").FundingCommitment[] = [];

afterEach(() => {
  seed.fundingSources.splice(
    0,
    seed.fundingSources.length,
    ...originalSources.map((s) => ({ ...s })),
  );
  for (const id of addedCommitments) {
    const i = seed.fundingCommitments.findIndex((c) => c.id === id);
    if (i !== -1) seed.fundingCommitments.splice(i, 1);
    const j = seed.auditEvents.findIndex((e) => e.entityId === id);
    if (j !== -1) seed.auditEvents.splice(j, 1);
  }
  for (const original of touchedCommitments) {
    const i = seed.fundingCommitments.findIndex((c) => c.id === original.id);
    if (i !== -1) seed.fundingCommitments[i] = { ...original };
  }
  addedCommitments.length = 0;
  touchedCommitments.length = 0;
  // Audit entries written against a fund rather than a commitment.
  for (const source of originalSources) {
    let i = seed.auditEvents.findIndex((e) => e.entityId === source.id);
    while (i !== -1) {
      seed.auditEvents.splice(i, 1);
      i = seed.auditEvents.findIndex((e) => e.entityId === source.id);
    }
  }
});

function trackCommitment(id: string) {
  addedCommitments.push(id);
}

function remember(id: string) {
  const row = seed.fundingCommitments.find((c) => c.id === id);
  if (row) touchedCommitments.push({ ...row });
}

describe("changing what a fund holds", () => {
  it("changes the allocation and bumps the version", async () => {
    const result = await adjustFundingSource(admin(), WAGE, {
      allocated: 260_000,
      reason: "Supplemental award for the second half of the program year.",
    });
    expect(result.ok).toBe(true);

    const after = await repositories.fundingSources.find(admin(), WAGE);
    expect(after!.allocated).toBe(260_000);
    expect(after!.version).toBe(2);
  });

  it("records both figures and the reason in the audit log", async () => {
    // "The number in the database is different now" is not an explanation, and
    // an allocation moving is the figure a funder will certainly ask about.
    await adjustFundingSource(admin(), WAGE, {
      allocated: 198_000,
      reason: "Rescission notified by the state.",
    });

    const event = seed.auditEvents.find((e) => e.entityId === WAGE)!;
    expect(event.entityType).toBe("funding_source");
    expect(event.from).toContain("240,000");
    expect(event.to).toContain("198,000");
    expect(event.reason).toMatch(/rescission/i);
  });

  it("refuses a change with no reason", async () => {
    const result = await adjustFundingSource(admin(), WAGE, {
      allocated: 1_000,
      reason: "   ",
    });
    expect(result.ok).toBe(false);
  });

  it("lets a board adjust its own fund", async () => {
    const result = await adjustFundingSource(board(), WAGE, {
      allocated: 250_000,
      reason: "Carry-in from the prior year confirmed.",
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a college adjusting the board's fund", async () => {
    // Ownership, not role. The college sponsors its own waiver fund and has no
    // business moving the board's allocation.
    const result = await adjustFundingSource(college(), WAGE, {
      allocated: 1_000,
      reason: "Trying it on.",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("allows cutting an allocation below what is already committed", async () => {
    // And the fund then reports itself overcommitted rather than the edit being
    // refused. A board whose award was cut is overcommitted in fact.
    const result = await adjustFundingSource(admin(), WAGE, {
      allocated: 1_000,
      reason: "Award reduced after a state-level reallocation.",
    });
    expect(result.ok).toBe(true);

    const source = (await repositories.fundingSources.find(admin(), WAGE))!;
    const commitments = await repositories.fundingCommitments.forSource(admin(), WAGE);
    const balance = balanceOf(source, commitments);
    expect(balance.overcommitted).toBe(true);
    expect(balance.remaining).toBeLessThan(0);
  });

  it("changes the hourly rate without touching what was already committed", async () => {
    // The commitments store their own rate, so a board moving next year's
    // cohort from $20 to $18 cannot retroactively rewrite what it promised.
    const before = await repositories.fundingCommitments.forSource(admin(), WAGE);
    const committedBefore = balanceOf(
      (await repositories.fundingSources.find(admin(), WAGE))!,
      before,
    ).committed;

    await adjustFundingSource(admin(), WAGE, {
      ratePerHour: 18,
      reason: "Rate set for the incoming cohort.",
    });

    const after = await repositories.fundingCommitments.forSource(admin(), WAGE);
    expect(after.every((c) => c.ratePerHour !== 18 || before.some((b) => b.id === c.id))).toBe(true);
    expect(
      balanceOf((await repositories.fundingSources.find(admin(), WAGE))!, after).committed,
    ).toBe(committedBefore);
  });

  it("refuses a rate on a fund that is not paid by the hour", async () => {
    const result = await adjustFundingSource(admin(), GRANT, {
      ratePerHour: 20,
      reason: "Should not work.",
    });
    expect(result.ok).toBe(false);
  });
});

describe("drawing on a fund", () => {
  it("commits money to a learner and moves the balance", async () => {
    const source = (await repositories.fundingSources.find(admin(), GRANT))!;
    const before = balanceOf(
      source,
      await repositories.fundingCommitments.forSource(admin(), GRANT),
    ).remaining;

    const result = await commitFunds(admin(), {
      sourceId: GRANT,
      studentId: "stu-nina",
      applicationId: null,
      amount: 900,
      note: "Credit cost for the spring term.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    trackCommitment(result.updated.id);

    const after = balanceOf(
      source,
      await repositories.fundingCommitments.forSource(admin(), GRANT),
    ).remaining;
    expect(after).toBe(before - 900);
  });

  it("audits the commitment in the same transaction", async () => {
    const result = await commitFunds(admin(), {
      sourceId: GRANT,
      studentId: "stu-nina",
      applicationId: null,
      amount: 500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    trackCommitment(result.updated.id);

    const event = seed.auditEvents.find((e) => e.entityId === result.updated.id)!;
    expect(event.entityType).toBe("funding_commitment");
    expect(event.to).toContain("500");
  });

  it("refuses a draw the fund cannot cover", async () => {
    const result = await commitFunds(admin(), {
      sourceId: GRANT,
      studentId: "stu-nina",
      applicationId: null,
      amount: 5_000_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/exceeds/i);
  });

  it("refuses a second live draw on the same fund for one placement", async () => {
    // A placement may draw on a wage subsidy AND a credit-cost grant — that is
    // the point of the change — but twice on the same fund is a double
    // commitment rather than a second kind of help.
    const existing = seed.fundingCommitments.find(
      (c) => c.fundingSourceId === GRANT && c.applicationId,
    )!;
    const result = await commitFunds(admin(), {
      sourceId: GRANT,
      studentId: existing.studentId,
      applicationId: existing.applicationId,
      amount: 100,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("conflict");
  });

  it("refuses a college drawing on the foundation's fund", async () => {
    const result = await commitFunds(college(), {
      sourceId: GRANT,
      studentId: "stu-nina",
      applicationId: null,
      amount: 100,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("refuses a placement belonging to a different learner", async () => {
    const application = seed.applications.find((a) => a.studentId !== "stu-nina")!;
    const result = await commitFunds(admin(), {
      sourceId: GRANT,
      studentId: "stu-nina",
      applicationId: application.id,
      amount: 100,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });
});

describe("giving money back", () => {
  it("releases an authorized commitment and returns the money", async () => {
    const live = seed.fundingCommitments.find(
      (c) => c.fundingSourceId === WAGE && c.status === "authorized",
    )!;
    remember(live.id);

    const source = (await repositories.fundingSources.find(admin(), WAGE))!;
    const before = balanceOf(
      source,
      await repositories.fundingCommitments.forSource(admin(), WAGE),
    ).remaining;

    const result = await releaseCommitment(admin(), live.id, "Placement never started.");
    expect(result.ok).toBe(true);

    const after = balanceOf(
      source,
      await repositories.fundingCommitments.forSource(admin(), WAGE),
    ).remaining;
    expect(after).toBe(before + live.amount);
  });

  it("keeps the row rather than deleting it", async () => {
    const live = seed.fundingCommitments.find(
      (c) => c.fundingSourceId === WAGE && c.status === "authorized",
    )!;
    remember(live.id);

    await releaseCommitment(admin(), live.id, "Placement never started.");
    const after = seed.fundingCommitments.find((c) => c.id === live.id);
    // "What did we commit and not spend" is a question a board asks at the end
    // of a program year, and a deleted row cannot answer it.
    expect(after).toBeDefined();
    expect(after!.status).toBe("released");
  });

  it("refuses to release money that has already been paid out", async () => {
    const disbursed = seed.fundingCommitments.find((c) => c.status === "disbursed")!;
    const result = await releaseCommitment(admin(), disbursed.id, "Trying it on.");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already been paid out/i);
  });

  it("refuses a release with no reason", async () => {
    const live = seed.fundingCommitments.find(
      (c) => c.fundingSourceId === WAGE && c.status === "authorized",
    )!;
    const result = await releaseCommitment(admin(), live.id, "  ");
    expect(result.ok).toBe(false);
  });
});

describe("the ledger and the application cache", () => {
  it("agrees with every funded placement's authorized hours and rate", async () => {
    // `fundingAuthorizedHours` and `fundingAuthorizedRate` stay on the
    // application because a transition guard takes an `Application` and no
    // repository. That makes them a cache over the ledger, and a cache that can
    // drift gets reported as "the board paid the wrong amount".
    const commitments = await repositories.fundingCommitments.forSource(admin(), WAGE);
    for (const commitment of commitments) {
      if (!commitment.applicationId) continue;
      const application = seed.applications.find((a) => a.id === commitment.applicationId)!;
      expect(commitment.hours).toBe(application.fundingAuthorizedHours);
      expect(commitment.ratePerHour).toBe(application.fundingAuthorizedRate);
      expect(commitment.amount).toBe(
        (application.fundingAuthorizedHours ?? 0) * (application.fundingAuthorizedRate ?? 0),
      );
    }
  });

  it("covers every funded placement in the seed", async () => {
    // A funded application with no ledger entry is money the board committed
    // that no balance counts.
    const funded = seed.applications.filter((a) => (a.fundingAuthorizedHours ?? 0) > 0);
    const commitments = await repositories.fundingCommitments.forSource(admin(), WAGE);
    const covered = new Set(commitments.map((c) => c.applicationId));
    expect(funded.every((a) => covered.has(a.id))).toBe(true);
  });
});
