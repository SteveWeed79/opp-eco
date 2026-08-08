import { describe, it, expect } from "vitest";
import {
  creditProgress,
  isSelfSufficientForCredit,
  creditsFor,
  buildCreditAward,
  workHoursFor,
  DEFAULT_HOURS_PER_CREDIT,
} from "./credit";
import type { Application, Posting } from "./types";

function microPosting(hours: number, id = "post-m"): Posting {
  return {
    id,
    marketId: "mkt-1",
    businessId: "org-business",
    track: "micro",
    title: "Market research brief",
    description: "",
    county: "Crawford",
    skillsRequired: [],
    skillsPreferred: [],
    status: "published",
    openings: 1,
    createdOn: "2026-01-01T00:00:00Z",
    projectFee: 600,
    estimatedHours: hours,
    deliverable: "Written brief",
    dueWithinDays: 14,
  };
}

function standardPosting(hoursPerWeek: number, weeks: number): Posting {
  return {
    id: "post-s",
    marketId: "mkt-1",
    businessId: "org-business",
    track: "standard",
    title: "Software Engineering Intern",
    description: "",
    county: "Crawford",
    skillsRequired: [],
    skillsPreferred: [],
    status: "published",
    openings: 1,
    createdOn: "2026-01-01T00:00:00Z",
    wagePerHour: 20,
    hoursPerWeek,
    weeks,
    creditHours: 3,
    supervisorName: "Dana Reyes",
  };
}

function completedMicro(id: string, accepted = true): Application {
  return {
    id,
    marketId: "mkt-1",
    postingId: "post-m",
    studentId: "stu-1",
    track: "micro",
    status: "placement_completed",
    submittedOn: "2026-01-01T00:00:00Z",
    statusSince: "2026-02-01T00:00:00Z",
    matchScore: { score: 88, algorithmVersion: "match-v1", factors: [] },
    deliverableSubmitted: true,
    deliverableAccepted: accepted,
  };
}

describe("hours attribution", () => {
  it("uses approved timesheet hours on the standard track", () => {
    const app = { ...completedMicro("a"), track: "standard" as const, hoursApproved: 132 };
    expect(workHoursFor(app, standardPosting(12, 14))).toBe(132);
  });

  it("uses the agreed scope on the micro track, which has no timesheet", () => {
    expect(workHoursFor(completedMicro("a"), microPosting(20))).toBe(20);
  });

  it("credits no hours for a micro deliverable that was never accepted", () => {
    expect(workHoursFor(completedMicro("a", false), microPosting(20))).toBe(0);
  });
});

describe("a single micro-internship cannot carry a credit", () => {
  it("rejects a 40-hour project as self-sufficient, the top of the range", () => {
    expect(isSelfSufficientForCredit(microPosting(40))).toBe(false);
  });

  it("rejects a 5-hour project, the bottom of the range", () => {
    expect(isSelfSufficientForCredit(microPosting(5))).toBe(false);
  });

  it("accepts a full standard internship", () => {
    expect(isSelfSufficientForCredit(standardPosting(12, 14))).toBe(true);
  });

  it("awards a standard internship its full credit load", () => {
    expect(creditsFor(standardPosting(12, 14))).toBe(3);
  });

  it("awards a lone micro-internship nothing", () => {
    expect(creditsFor(microPosting(40))).toBe(0);
  });
});

describe("standard placements award what the posting declared", () => {
  function completedStandard(hoursApproved: number): Application {
    return {
      ...completedMicro("s"),
      id: "s",
      track: "standard",
      postingId: "post-s",
      hoursApproved,
      deliverableSubmitted: undefined,
      deliverableAccepted: undefined,
    };
  }

  it("never awards more than the posting's declared credit hours", () => {
    // 240 hours over 45 would be 5, but the posting is worth 3
    const progress = creditProgress([
      { application: completedStandard(240), posting: standardPosting(18, 14) },
    ]);
    expect(progress.standardCredits).toBe(3);
    expect(progress.creditsAvailable).toBe(3);
  });

  it("caps credit by hours actually worked when a placement ends early", () => {
    const progress = creditProgress([
      { application: completedStandard(50), posting: standardPosting(12, 14) },
    ]);
    expect(progress.standardCredits).toBe(1);
  });

  it("awards nothing for a placement that logged almost no hours", () => {
    const progress = creditProgress([
      { application: completedStandard(20), posting: standardPosting(12, 14) },
    ]);
    expect(progress.creditsAvailable).toBe(0);
  });

  it("does not pour standard hours into the micro bank", () => {
    const progress = creditProgress([
      { application: completedStandard(240), posting: standardPosting(18, 14) },
    ]);
    expect(progress.bankedHours).toBe(0);
  });
});

describe("micro-internships stack toward a credit", () => {
  it("banks hours across several completed projects", () => {
    const progress = creditProgress([
      { application: completedMicro("a"), posting: microPosting(15) },
      { application: completedMicro("b"), posting: microPosting(15) },
    ]);
    expect(progress.bankedHours).toBe(30);
    expect(progress.creditsAvailable).toBe(0);
    expect(progress.hoursToNextCredit).toBe(15);
  });

  it("earns a credit once the banked total clears the threshold", () => {
    const progress = creditProgress([
      { application: completedMicro("a"), posting: microPosting(15) },
      { application: completedMicro("b"), posting: microPosting(15) },
      { application: completedMicro("c"), posting: microPosting(15) },
    ]);
    expect(progress.bankedHours).toBe(DEFAULT_HOURS_PER_CREDIT);
    expect(progress.microCredits).toBe(1);
    expect(progress.creditsAvailable).toBe(1);
    expect(progress.contributingApplicationIds).toEqual(["a", "b", "c"]);
  });

  it("honours a college's own hours-per-credit policy", () => {
    const progress = creditProgress(
      [{ application: completedMicro("a"), posting: microPosting(30) }],
      30,
    );
    expect(progress.creditsAvailable).toBe(1);
  });

  it("excludes work already converted into an award", () => {
    const spent = { ...completedMicro("a"), creditAwardId: "credit-1" };
    const progress = creditProgress([
      { application: spent, posting: microPosting(45) },
      { application: completedMicro("b"), posting: microPosting(10) },
    ]);
    expect(progress.bankedHours).toBe(10);
    expect(progress.contributingApplicationIds).toEqual(["b"]);
  });
});

describe("building an award", () => {
  it("produces nothing below the threshold", () => {
    const progress = creditProgress([
      { application: completedMicro("a"), posting: microPosting(20) },
    ]);
    const award = buildCreditAward({
      id: "credit-1",
      marketId: "mkt-1",
      studentId: "stu-1",
      collegeId: "org-college",
      courseMapping: "BUS 390",
      progress,
    });
    expect(award).toBeNull();
  });

  it("references every micro-internship that contributed hours", () => {
    const progress = creditProgress([
      { application: completedMicro("a"), posting: microPosting(20) },
      { application: completedMicro("b"), posting: microPosting(25) },
    ]);
    const award = buildCreditAward({
      id: "credit-1",
      marketId: "mkt-1",
      studentId: "stu-1",
      collegeId: "org-college",
      courseMapping: "BUS 390",
      progress,
    });
    expect(award?.creditHours).toBe(1);
    expect(award?.totalWorkHours).toBe(45);
    expect(award?.applicationIds).toEqual(["a", "b"]);
    expect(award?.status).toBe("pending");
  });
});
