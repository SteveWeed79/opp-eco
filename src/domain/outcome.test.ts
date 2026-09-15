import { describe, it, expect } from "vitest";
import type { Application, Outcome } from "./types";
import {
  OUTCOME_KINDS,
  OUTCOME_READERS,
  OUTCOME_RECORDERS,
  awaitsFollowUp,
  canReadOutcomes,
  canRecordOutcome,
  daysSinceExit,
  followUpBlockReason,
  hasExited,
  isEmployment,
  isRegionalEmployment,
  outcomeKindLabel,
  summarizeOutcomes,
} from "./outcome";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: "app-1",
    marketId: "mkt-1",
    postingId: "post-1",
    studentId: "stu-1",
    track: "standard",
    status: "placement_completed",
    furthestStatus: "placement_completed",
    submittedOn: "2026-01-01T00:00:00.000Z",
    statusSince: "2026-05-01T00:00:00.000Z",
    matchScore: { score: 80, algorithmVersion: "v1", factors: [] },
    version: 1,
    ...overrides,
  };
}

function outcome(overrides: Partial<Outcome> = {}): Outcome {
  return {
    id: "out-1",
    marketId: "mkt-1",
    studentId: "stu-1",
    applicationId: "app-1",
    kind: "employed_in_region",
    observedOn: "2026-05-15T00:00:00.000Z",
    recordedOn: "2026-05-15T00:00:00.000Z",
    recordedByUserId: "u-college",
    source: "college",
    ...overrides,
  };
}

describe("the outcome vocabulary", () => {
  it("orders the strongest result first", () => {
    // The follow-up form is read top to bottom by someone who already knows the
    // answer, so the values are ordered by what they mean rather than
    // alphabetically.
    expect(OUTCOME_KINDS[0].value).toBe("employed_by_host");
    expect(OUTCOME_KINDS[OUTCOME_KINDS.length - 1].value).toBe("still_seeking");
  });

  it("says what every value means in a report", () => {
    // The hazard of an outcome taxonomy is a well-meant officer filing a job in
    // the next state under whichever value reads best, so each one states how it
    // will be counted.
    for (const kind of OUTCOME_KINDS) {
      expect(kind.meta.trim().length).toBeGreaterThan(0);
      expect(kind.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("has no value meaning 'nobody asked'", () => {
    // Absence is absence and has no row. A kind for it would let an unworked
    // follow-up queue be reported as a result.
    expect(OUTCOME_KINDS.map((k) => k.value)).not.toContain("no_outcome_recorded");
  });

  it("labels every value", () => {
    for (const kind of OUTCOME_KINDS) {
      expect(outcomeKindLabel(kind.value)).toBe(kind.label);
    }
  });
});

describe("what counts as the venture's own measure", () => {
  it("counts a hire by the host employer as regional", () => {
    // The host is an employer in this market, so a hire by them is a hire in
    // the region. Two reports disagreeing about that is the bug this pins.
    expect(isRegionalEmployment("employed_by_host")).toBe(true);
    expect(isRegionalEmployment("employed_in_region")).toBe(true);
  });

  it("does not count a job outside the region as regional", () => {
    expect(isRegionalEmployment("employed_elsewhere")).toBe(false);
    expect(isEmployment("employed_elsewhere")).toBe(true);
  });

  it("does not count education or training as employment", () => {
    for (const kind of ["continued_education", "entered_training", "still_seeking"] as const) {
      expect(isEmployment(kind)).toBe(false);
      expect(isRegionalEmployment(kind)).toBe(false);
    }
  });
});

describe("who may record one", () => {
  it("is the college and the administrator", () => {
    expect(OUTCOME_RECORDERS).toEqual(["college", "admin"]);
    expect(canRecordOutcome("college")).toBe(true);
    expect(canRecordOutcome("admin")).toBe(true);
  });

  it("is not the board, which reimburses placements rather than measuring them", () => {
    expect(canRecordOutcome("board")).toBe(false);
  });

  it("is not yet the learner or the employer — Q23", () => {
    // Both are better evidence than a college's note for the outcomes they can
    // speak to, and both need a rule about what each may claim. The narrow
    // answer ships first; this test is the reminder that it is narrow.
    expect(canRecordOutcome("student")).toBe(false);
    expect(canRecordOutcome("business")).toBe(false);
  });
});

describe("who may read one", () => {
  it("refuses an employer, which is the case the derived views turn on", () => {
    // An employer reads the applications against its own postings and reads no
    // outcomes, so a queue built by subtracting one list from the other would
    // show every placement it hosted as never followed up.
    expect(canReadOutcomes("business")).toBe(false);
  });

  it("includes the board, whose narrowing is a projection rather than a refusal", () => {
    // Unlike an introduction, which it may not read at all. It loses the free
    // text and none of the rows, so its counts match the college's exactly.
    expect(canReadOutcomes("board")).toBe(true);
  });

  it("includes every role that can record one", () => {
    // A role able to write a record it cannot read back would see its own entry
    // vanish the moment it was saved.
    for (const role of OUTCOME_RECORDERS) {
      expect(canReadOutcomes(role)).toBe(true);
    }
  });

  it("lets a learner see what is held about them", () => {
    expect(OUTCOME_READERS).toContain("student");
  });
});

describe("when a follow-up is due", () => {
  it("is due once a placement has finished", () => {
    expect(hasExited(application({ status: "placement_completed" }))).toBe(true);
    expect(hasExited(application({ status: "credit_granted", furthestStatus: "credit_granted" }))).toBe(true);
  });

  it("is due for a placement that ended early", () => {
    // The learner whose placement ended early is the one whose next step matters
    // most. A follow-up process that drops them reports only its successes.
    expect(hasExited(application({ status: "terminated_early", furthestStatus: "terminated_early" }))).toBe(true);
  });

  it("is not due while the placement is still running", () => {
    const running = application({ status: "placement_active", furthestStatus: "placement_active" });
    expect(hasExited(running)).toBe(false);
    expect(followUpBlockReason(running)).toMatch(/still running/i);
  });

  it("is not due for an application that never reached a placement", () => {
    // Nothing happened, so there is nothing to measure — and putting these in
    // the queue would bury the placements that did happen.
    const rejected = application({ status: "rejected", furthestStatus: "under_review" });
    expect(hasExited(rejected)).toBe(false);
    expect(followUpBlockReason(rejected)).toMatch(/never reached a placement/i);
  });

  it("reads through `closed`, which erases how far an application got", () => {
    // Same reason the funnel counts by furthest status: a closed row says
    // nothing on its own about whether anyone was ever placed.
    expect(hasExited(application({ status: "closed", furthestStatus: "placement_completed" }))).toBe(true);
    expect(hasExited(application({ status: "closed", furthestStatus: "shortlisted" }))).toBe(false);
  });

  it("gives no reason when nothing is blocking", () => {
    expect(followUpBlockReason(application())).toBeNull();
  });
});

describe("the follow-up queue", () => {
  it("lists an exited placement nobody has asked about", () => {
    expect(awaitsFollowUp(application(), [])).toBe(true);
  });

  it("clears once one outcome is recorded against it", () => {
    expect(awaitsFollowUp(application(), [outcome()])).toBe(false);
  });

  it("is not cleared by an outcome against a different placement", () => {
    expect(awaitsFollowUp(application(), [outcome({ applicationId: "app-2" })])).toBe(true);
  });

  it("never lists a placement that is still running", () => {
    expect(awaitsFollowUp(application({ status: "placement_active" }), [])).toBe(false);
  });

  it("measures how long a learner has been waiting to be asked", () => {
    expect(daysSinceExit(application({ statusSince: "2026-05-01T00:00:00.000Z" }), NOW)).toBe(31);
  });

  it("never reports a negative wait", () => {
    // A fixture dated in the future is a seed problem, not a reason to render
    // "-4 days since this ended".
    expect(daysSinceExit(application({ statusSince: "2026-07-01T00:00:00.000Z" }), NOW)).toBe(0);
  });
});

describe("summarising outcomes", () => {
  it("counts one observation per learner, not one per row", () => {
    // A learner followed up twice is one learner. Summing rows would let a
    // diligent officer inflate the denominator by doing their job.
    const summary = summarizeOutcomes(
      [
        outcome({ id: "out-1", kind: "still_seeking", observedOn: "2026-03-01T00:00:00.000Z" }),
        outcome({ id: "out-2", kind: "employed_in_region", observedOn: "2026-05-01T00:00:00.000Z" }),
      ],
      0,
    );
    expect(summary.measured).toBe(1);
    expect(summary.regional).toBe(1);
  });

  it("takes the most recent observation, because the question is where they are now", () => {
    const summary = summarizeOutcomes(
      [
        outcome({ id: "out-1", kind: "employed_in_region", observedOn: "2026-05-01T00:00:00.000Z" }),
        outcome({ id: "out-2", kind: "employed_elsewhere", observedOn: "2026-03-01T00:00:00.000Z" }),
      ],
      0,
    );
    expect(summary.regional).toBe(1);
    expect(summary.byKind.find((k) => k.kind === "employed_elsewhere")?.count).toBe(0);
  });

  it("breaks a same-date tie by which was entered later", () => {
    const summary = summarizeOutcomes(
      [
        outcome({ id: "out-1", kind: "still_seeking", observedOn: "2026-05-01T00:00:00.000Z", recordedOn: "2026-05-02T00:00:00.000Z" }),
        outcome({ id: "out-2", kind: "employed_by_host", observedOn: "2026-05-01T00:00:00.000Z", recordedOn: "2026-05-09T00:00:00.000Z" }),
      ],
      0,
    );
    expect(summary.byKind.find((k) => k.kind === "employed_by_host")?.count).toBe(1);
  });

  it("reports no rate at all when nothing has been measured", () => {
    // Zero would report a follow-up nobody has done as a bad result. The
    // unmeasured count is what says the queue is unworked.
    const summary = summarizeOutcomes([], 7);
    expect(summary.regionalRate).toBeNull();
    expect(summary.measured).toBe(0);
    expect(summary.unmeasured).toBe(7);
  });

  it("rates regional employment over measured learners, not over everyone who exited", () => {
    // Dividing by everyone who exited would make an unworked queue look like a
    // programme that does not place people.
    const summary = summarizeOutcomes(
      [
        outcome({ id: "out-1", studentId: "stu-1", kind: "employed_by_host" }),
        outcome({ id: "out-2", studentId: "stu-2", kind: "employed_elsewhere" }),
      ],
      6,
    );
    expect(summary.measured).toBe(2);
    expect(summary.regionalRate).toBe(0.5);
    expect(summary.employed).toBe(2);
    expect(summary.regional).toBe(1);
  });

  it("reports every kind, including the ones nobody scored", () => {
    // A chart that omits empty categories silently changes shape between
    // markets, which is how two screenshots of the same report disagree.
    const summary = summarizeOutcomes([outcome()], 0);
    expect(summary.byKind).toHaveLength(OUTCOME_KINDS.length);
  });
});
