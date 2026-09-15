import { describe, it, expect } from "vitest";
import type {
  ActorContext,
  ActorRole,
  Application,
  FundingCommitment,
  FundingSource,
} from "./types";
import {
  FUND_PURPOSES,
  adjustBlockReason,
  balanceOf,
  byFundOrder,
  canSpendFrom,
  commitBlockReason,
  isHourly,
  settlementFor,
  spendBlockReason,
  wageSubsidyRate,
  wageSubsidySource,
} from "./funding";

const MARKET = "mkt-1";
const BOARD = "org-board";

function actor(role: ActorRole, organizationId: string | null = BOARD): ActorContext {
  return {
    user: { id: "u-1", name: "Test", email: "t@example.test" },
    membership: {
      id: "mem-1",
      userId: "u-1",
      organizationId,
      marketId: role === "admin" ? null : MARKET,
      role,
    },
  } as ActorContext;
}

function source(overrides: Partial<FundingSource> = {}): FundingSource {
  return {
    id: "fund-1",
    marketId: MARKET,
    sponsorOrgId: BOARD,
    kind: "workforce",
    purpose: "wage_subsidy",
    programYear: "PY2026",
    name: "PY2026 WIOA wage reimbursement",
    allocated: 100_000,
    ratePerHour: 20,
    status: "active",
    openedOn: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function commitment(overrides: Partial<FundingCommitment> = {}): FundingCommitment {
  return {
    id: "commit-1",
    marketId: MARKET,
    fundingSourceId: "fund-1",
    studentId: "stu-1",
    applicationId: "app-1",
    amount: 4_200,
    status: "authorized",
    authorizedOn: "2026-02-01T00:00:00.000Z",
    authorizedByUserId: "u-1",
    version: 1,
    ...overrides,
  };
}

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: "app-1",
    marketId: MARKET,
    postingId: "post-1",
    studentId: "stu-1",
    track: "standard",
    status: "placement_active",
    furthestStatus: "placement_active",
    submittedOn: "2026-01-01T00:00:00.000Z",
    statusSince: "2026-02-01T00:00:00.000Z",
    matchScore: { score: 80, algorithmVersion: "v1", factors: [] },
    version: 1,
    ...overrides,
  };
}

describe("balances", () => {
  it("counts authorized and disbursed, and not released", () => {
    // A released row is kept rather than deleted — "what did we commit and not
    // spend" is a question a board asks — so the sum has to skip it explicitly.
    const balance = balanceOf(source(), [
      commitment({ id: "c1", amount: 10_000, status: "authorized" }),
      commitment({ id: "c2", amount: 5_000, status: "disbursed" }),
      commitment({ id: "c3", amount: 90_000, status: "released" }),
    ]);
    expect(balance.committed).toBe(15_000);
    expect(balance.disbursed).toBe(5_000);
    expect(balance.remaining).toBe(85_000);
    expect(balance.liveCommitments).toBe(2);
  });

  it("ignores commitments belonging to another fund", () => {
    const balance = balanceOf(source(), [
      commitment({ id: "c1", amount: 10_000 }),
      commitment({ id: "c2", amount: 50_000, fundingSourceId: "fund-other" }),
    ]);
    expect(balance.committed).toBe(10_000);
  });

  it("reports a negative remainder rather than clamping it", () => {
    // An allocation cut below what was already committed is a real situation,
    // and the same argument as approved hours over an authorized cap: naming it
    // is the only honest option. Clamping to zero would hide a shortfall the
    // board is already carrying.
    const balance = balanceOf(source({ allocated: 10_000 }), [
      commitment({ amount: 15_000 }),
    ]);
    expect(balance.remaining).toBe(-5_000);
    expect(balance.overcommitted).toBe(true);
  });

  it("does not divide by zero on a fund with nothing in it", () => {
    const empty = balanceOf(source({ allocated: 0 }), []);
    expect(empty.burn).toBe(0);
    expect(empty.overcommitted).toBe(false);
  });
});

describe("finding the wage fund", () => {
  it("picks the wage-subsidy fund and its rate", () => {
    const funds = [
      source({ id: "f-grant", purpose: "credit_cost", kind: "philanthropic", ratePerHour: undefined }),
      source({ id: "f-wage" }),
    ];
    expect(wageSubsidySource(funds)?.id).toBe("f-wage");
    expect(wageSubsidyRate(funds)).toBe(20);
  });

  it("returns null for a market with no fund, rather than throwing", () => {
    // A market whose board is still in conversation has nobody to sponsor one.
    // Being unfunded is a stage, not an error, and every screen that divides by
    // an allocation has to survive it.
    expect(wageSubsidySource([])).toBeNull();
    expect(wageSubsidyRate([])).toBe(0);
  });

  it("ignores a closed fund", () => {
    expect(wageSubsidySource([source({ status: "closed" })])).toBeNull();
  });

  it("orders wage subsidy ahead of everything else", () => {
    // Purpose order matches the declaration order of the SQL enum, which is
    // what makes the two data layers agree without a CASE expression.
    const funds = [
      source({ id: "f-transport", purpose: "transportation", ratePerHour: undefined }),
      source({ id: "f-wage" }),
      source({ id: "f-credit", purpose: "credit_cost", ratePerHour: undefined }),
    ].sort(byFundOrder);
    expect(funds.map((f) => f.id)).toEqual(["f-wage", "f-credit", "f-transport"]);
  });

  it("knows which purposes are paid by the hour", () => {
    expect(isHourly(source())).toBe(true);
    expect(isHourly(source({ purpose: "credit_cost" }))).toBe(false);
  });
});

describe("who may move money", () => {
  it("lets the sponsoring organization spend its own fund", () => {
    expect(canSpendFrom(actor("board", BOARD), source())).toBe(true);
  });

  it("refuses an organization that does not sponsor it", () => {
    // Not a role check: "the board may commit" stops being true the moment a
    // market has two boards, and "the college may commit" would let one college
    // draw on another institution's scholarship.
    expect(canSpendFrom(actor("college", "org-college"), source())).toBe(false);
    expect(spendBlockReason(actor("college", "org-college"), source())).toMatch(
      /another organization/i,
    );
  });

  it("lets an administrator spend any fund", () => {
    expect(canSpendFrom(actor("admin", null), source())).toBe(true);
  });

  it("refuses a sponsor in a different market", () => {
    expect(canSpendFrom(actor("board", BOARD), source({ marketId: "mkt-2" }))).toBe(false);
  });

  it("refuses spending from a closed fund even by its sponsor", () => {
    expect(spendBlockReason(actor("board", BOARD), source({ status: "closed" }))).toMatch(
      /closed/i,
    );
  });
});

describe("changing an allocation", () => {
  it("allows reducing it below what is already committed", () => {
    // The decision worth arguing. A rescission is a real thing that happens to
    // public money, and refusing the edit would leave the software showing a
    // number the board knows is wrong.
    expect(adjustBlockReason(source(), { allocated: 1 })).toBeNull();
  });

  it("refuses a negative allocation", () => {
    expect(adjustBlockReason(source(), { allocated: -1 })).toMatch(/negative/i);
  });

  it("refuses a rate on a fund that is not paid by the hour", () => {
    const grant = source({ purpose: "credit_cost", ratePerHour: undefined });
    expect(adjustBlockReason(grant, { ratePerHour: 20 })).toMatch(/not paid by the hour/i);
  });

  it("refuses a rate that is not a positive figure", () => {
    expect(adjustBlockReason(source(), { ratePerHour: 0 })).toMatch(/positive/i);
  });

  it("refuses a change to a closed fund", () => {
    expect(adjustBlockReason(source({ status: "closed" }), { allocated: 5 })).toMatch(
      /closed/i,
    );
  });

  it("refuses a change that changes nothing", () => {
    expect(adjustBlockReason(source(), {})).toMatch(/nothing to change/i);
  });
});

describe("drawing on a fund", () => {
  const balance = () => balanceOf(source({ allocated: 10_000 }), [commitment({ amount: 9_000 })]);

  it("allows a draw that fits", () => {
    expect(commitBlockReason(balance(), 1_000)).toBeNull();
  });

  it("refuses a draw the fund cannot cover", () => {
    // Unlike an adjustment. The difference is who is surprised: an allocation
    // moving is news arriving from outside, while a commitment is the
    // platform's own act — and promising money that will not arrive is how a
    // student is told they have a grant they do not have.
    expect(commitBlockReason(balance(), 5_000)).toMatch(/exceeds/i);
  });

  it("refuses a non-positive amount", () => {
    expect(commitBlockReason(balance(), 0)).toMatch(/positive/i);
  });
});

describe("settling a commitment when the placement ends", () => {
  it("disburses when the placement ran and finished", () => {
    // The money was spent. It does not come back into the fund.
    const finished = application({
      status: "credit_granted",
      furthestStatus: "credit_granted",
    });
    expect(settlementFor(finished, commitment())).toBe("disbursed");
  });

  it("releases when it ended before anyone started", () => {
    const withdrawn = application({ status: "withdrawn", furthestStatus: "shortlisted" });
    expect(settlementFor(withdrawn, commitment())).toBe("released");
  });

  it("leaves a running placement alone", () => {
    expect(settlementFor(application(), commitment())).toBeNull();
  });

  it("leaves an already-released commitment alone", () => {
    const withdrawn = application({ status: "withdrawn", furthestStatus: "shortlisted" });
    expect(settlementFor(withdrawn, commitment({ status: "released" }))).toBeNull();
  });

  it("does not re-disburse a commitment already disbursed", () => {
    const finished = application({ status: "credit_granted", furthestStatus: "credit_granted" });
    expect(settlementFor(finished, commitment({ status: "disbursed" }))).toBeNull();
  });

  it("distinguishes a finished placement from an abandoned one", () => {
    // The old model could not: `marketRemainingBudget` stopped counting any
    // terminal application, so a completed fully-reimbursed placement and one
    // withdrawn on day one were the same event. For a board reconciling a
    // program year they are opposites.
    const finished = application({ status: "closed", furthestStatus: "credit_granted" });
    const abandoned = application({ status: "closed", furthestStatus: "shortlisted" });
    expect(settlementFor(finished, commitment())).toBe("disbursed");
    expect(settlementFor(abandoned, commitment())).toBe("released");
  });
});

describe("the purpose vocabulary", () => {
  it("describes every purpose", () => {
    for (const purpose of FUND_PURPOSES) {
      expect(purpose.label.trim().length).toBeGreaterThan(0);
      expect(purpose.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("includes the barrier the student survey named first", () => {
    expect(FUND_PURPOSES.map((p) => p.value)).toContain("credit_cost");
  });
});
