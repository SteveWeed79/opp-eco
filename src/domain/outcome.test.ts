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
  exitDateOf,
  followUpWindowsFor,
  followUpBlockReason,
  hasExited,
  isEmployment,
  inRegion,
  placeInRegion,
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
    kind: "employed",
    employedByHost: false,
    employmentCounty: "Crawford",
    employmentState: "KS",
    assertedInRegion: null,
    observedOn: "2026-05-15T00:00:00.000Z",
    recordedOn: "2026-05-15T00:00:00.000Z",
    recordedByUserId: "u-college",
    source: "college",
    ...overrides,
  };
}

/** The market every outcome here is measured against. */
const MARKET = { counties: ["Crawford", "Cherokee"], state: "KS" };
const region = () => MARKET;

/** An outcome somewhere outside the region — a real job, and gone. */
function away(overrides: Partial<Outcome> = {}): Outcome {
  return outcome({ employmentCounty: "Wyandotte", employmentState: "KS", ...overrides });
}

/** Working, and nobody established where — the half-answer a phone call gives. */
function nowhere(overrides: Partial<Outcome> = {}): Outcome {
  return outcome({ employmentCounty: null, employmentState: null, ...overrides });
}

describe("the outcome vocabulary", () => {
  it("orders the strongest result first", () => {
    // The follow-up form is read top to bottom by someone who already knows the
    // answer, so the values are ordered by what they mean rather than
    // alphabetically.
    expect(OUTCOME_KINDS[0].value).toBe("employed");
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
  it("is derived from where they went, not from which value was picked", () => {
    // The whole point of the change. An officer names a county; whether it
    // counts as staying is decided here, against boundaries the market
    // declares — so two colleges cannot answer it differently.
    expect(inRegion(outcome(), MARKET)).toBe(true);
    expect(inRegion(away(), MARKET)).toBe(false);
  });

  it("counts a hire by the host employer as regional without needing a county", () => {
    // The host is an employer in this market, so a hire by them is a hire in
    // the region by construction.
    const hired = outcome({
      employedByHost: true,
      employmentCounty: null,
      employmentState: null,
    });
    expect(inRegion(hired, MARKET)).toBe(true);
  });

  it("does not let a county name cross a state line", () => {
    // Kansas and Missouri each have a Jackson County, and Pittsburg is twenty
    // miles from Joplin. Matching on the name alone would score a job in
    // Missouri as staying — which is the exact failure this change exists to
    // remove, arriving by a different door.
    const market = { counties: ["Jackson"], state: "KS" };
    expect(placeInRegion("Jackson", "KS", market)).toBe(true);
    expect(placeInRegion("Jackson", "MO", market)).toBe(false);
  });

  it("is case- and whitespace-insensitive about both parts", () => {
    // A retention figure that drops rows because somebody typed "ks" is a
    // retention figure that is quietly wrong.
    expect(placeInRegion("  crawford ", "ks", MARKET)).toBe(true);
  });

  it("answers null when employment carries no place at all", () => {
    // Not false. "We did not capture where they went" and "they left" are
    // different facts, and folding the first into the second understates
    // retention by the size of the gap in the follow-up process.
    const vague = outcome({ employmentCounty: null, employmentState: null });
    expect(inRegion(vague, MARKET)).toBeNull();
  });

  it("honours the judgement on rows recorded before the county existed", () => {
    // Those rows are real history. Their place is unknown and stays unknown,
    // but what the recorder claimed is not thrown away.
    const legacy = outcome({
      employmentCounty: null,
      employmentState: null,
      assertedInRegion: true,
    });
    expect(inRegion(legacy, MARKET)).toBe(true);
    expect(inRegion({ ...legacy, assertedInRegion: false }, MARKET)).toBe(false);
  });

  it("prefers a captured place over an inherited assertion", () => {
    // If both are somehow present, the place is the evidence and the assertion
    // is somebody's summary of it.
    const both = away({ assertedInRegion: true });
    expect(inRegion(both, MARKET)).toBe(false);
  });

  it("does not count education or training as employment", () => {
    for (const kind of ["continued_education", "entered_training", "still_seeking"] as const) {
      expect(isEmployment(kind)).toBe(false);
      expect(inRegion(outcome({ kind }), MARKET)).toBeNull();
    }
  });
});


describe("who may record one", () => {
  it("is the college, the administrator, and the learner", () => {
    expect(OUTCOME_RECORDERS).toEqual(["college", "admin", "student"]);
    expect(canRecordOutcome("college")).toBe(true);
    expect(canRecordOutcome("admin")).toBe(true);
    expect(canRecordOutcome("student")).toBe(true);
  });

  it("is not the board, which reimburses placements rather than measuring them", () => {
    expect(canRecordOutcome("board")).toBe(false);
  });

  it("is still not the employer, which answers a different question", () => {
    // Not an omission. An employer says what it decided about its own headcount
    // through `HostOffer`, and an accepted offer writes the outcome from there.
    // What it cannot do is file an outcome directly, because everything else an
    // outcome can say — continued education, still looking, a job somewhere
    // else — is hearsay from where it sits.
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
  // The fixture exits 1 May 2026 — Q2 — so its windows are Oct–Dec 2026 and
  // Apr–Jun 2027. Dates below are chosen against that rather than against the
  // day the suite happens to run.
  const beforeFirst = new Date("2026-08-01T00:00:00.000Z");
  const inFirst = new Date("2026-11-01T00:00:00.000Z");
  const betweenWindows = new Date("2027-02-01T00:00:00.000Z");
  const inSecond = new Date("2027-05-01T00:00:00.000Z");
  const answeredFirst = () => outcome({ observedOn: "2026-11-15T00:00:00.000Z" });

  it("lists an exited placement once its window opens", () => {
    expect(awaitsFollowUp(application(), [], inFirst)).toBe(true);
  });

  it("does not list one before the first window opens", () => {
    // The change from the old rule, and the point of having a clock: a
    // placement that finished last month is not yet a measurement anybody can
    // take, and listing it teaches an operator that the queue is noise.
    expect(awaitsFollowUp(application(), [], beforeFirst)).toBe(false);
  });

  it("clears once an outcome lands inside the open window", () => {
    expect(awaitsFollowUp(application(), [answeredFirst()], inFirst)).toBe(false);
  });

  it("is not cleared by an outcome recorded before the window opened", () => {
    // A follow-up taken in May says where somebody was in May. It is a real
    // record and it still counts in the summary; it is not a measurement of
    // Oct–Dec, and letting it pass as one is how a series stops being
    // comparable.
    expect(awaitsFollowUp(application(), [outcome()], inFirst)).toBe(true);
  });

  it("comes back when the next window opens", () => {
    // No longer one-shot. The old rule cleared a placement forever the first
    // time anybody asked, which is why a second observation was supported and
    // never prompted.
    const answered = [answeredFirst()];
    expect(awaitsFollowUp(application(), answered, betweenWindows)).toBe(false);
    expect(awaitsFollowUp(application(), answered, inSecond)).toBe(true);
  });

  it("stops asking about a window that closed unanswered", () => {
    // Reported as missed rather than queued. Nobody can be phoned in February
    // and asked where they were last November with any confidence.
    expect(awaitsFollowUp(application(), [], betweenWindows)).toBe(false);
    const missed = followUpWindowsFor(application(), [], betweenWindows);
    expect(missed[0].state).toBe("missed");
    expect(missed[1].state).toBe("waiting");
  });

  it("is not cleared by an outcome against a different placement", () => {
    const elsewhere = [answeredFirst()].map((o) => ({ ...o, applicationId: "app-2" }));
    expect(awaitsFollowUp(application(), elsewhere, inFirst)).toBe(true);
  });

  it("never lists a placement that is still running", () => {
    expect(awaitsFollowUp(application({ status: "placement_active" }), [], inFirst)).toBe(false);
    expect(followUpWindowsFor(application({ status: "placement_active" }), [], inFirst)).toEqual([]);
  });

  it("measures how long a learner has been waiting to be asked", () => {
    expect(daysSinceExit(application({ statusSince: "2026-05-01T00:00:00.000Z" }), NOW)).toBe(31);
  });

  it("measures from when the placement ended, not from when the row last moved", () => {
    // The whole reason `exitedOn` exists. A placement that finished in March,
    // had credit granted in May and was closed in May carries a `statusSince`
    // of May — and a clock running from that is two months out, which is enough
    // to file an observation in the wrong quarter.
    const moved = application({
      exitedOn: "2026-03-01T00:00:00.000Z",
      statusSince: "2026-05-01T00:00:00.000Z",
    });
    expect(daysSinceExit(moved, NOW)).toBe(92);
    expect(exitDateOf(moved)).toBe("2026-03-01T00:00:00.000Z");
  });

  it("falls back to the last move for a row that has no exit date", () => {
    // Rows written before the column existed and never backfilled. The old
    // approximation kept as a floor: a date a little late beats no date at all,
    // and migration 0016 makes this unreachable in practice.
    const old = application({ statusSince: "2026-05-01T00:00:00.000Z" });
    expect(exitDateOf(old)).toBe("2026-05-01T00:00:00.000Z");
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
        outcome({ id: "out-2", observedOn: "2026-05-01T00:00:00.000Z" }),
      ],
      0,
      region,
    );
    expect(summary.measured).toBe(1);
    expect(summary.regional).toBe(1);
  });

  it("takes the most recent observation, because the question is where they are now", () => {
    const summary = summarizeOutcomes(
      [
        outcome({ id: "out-1", observedOn: "2026-05-01T00:00:00.000Z" }),
        away({ id: "out-2", observedOn: "2026-03-01T00:00:00.000Z" }),
      ],
      0,
      region,
    );
    expect(summary.regional).toBe(1);
    expect(summary.regional).toBe(1);
    expect(summary.placeUnknown).toBe(0);
  });

  it("breaks a same-date tie by which was entered later", () => {
    const summary = summarizeOutcomes(
      [
        outcome({ id: "out-1", kind: "still_seeking", observedOn: "2026-05-01T00:00:00.000Z", recordedOn: "2026-05-02T00:00:00.000Z" }),
        outcome({ id: "out-2", employedByHost: true, observedOn: "2026-05-01T00:00:00.000Z", recordedOn: "2026-05-09T00:00:00.000Z" }),
      ],
      0,
      region,
    );
    expect(summary.byKind.find((k) => k.kind === "employed")?.count).toBe(1);
  });

  it("reports no rate at all when nothing has been measured", () => {
    // Zero would report a follow-up nobody has done as a bad result. The
    // unmeasured count is what says the queue is unworked.
    const summary = summarizeOutcomes([], 7, region);
    expect(summary.regionalRate).toBeNull();
    expect(summary.measured).toBe(0);
    expect(summary.unmeasured).toBe(7);
  });

  it("rates regional employment over measured learners, not over everyone who exited", () => {
    // Dividing by everyone who exited would make an unworked queue look like a
    // programme that does not place people.
    const summary = summarizeOutcomes(
      [
        outcome({ id: "out-1", studentId: "stu-1", employedByHost: true }),
        away({ id: "out-2", studentId: "stu-2" }),
      ],
      6,
      region,
    );
    expect(summary.measured).toBe(2);
    expect(summary.regionalRate).toBe(0.5);
    expect(summary.employed).toBe(2);
    expect(summary.regional).toBe(1);
  });

  it("counts employment whose place was never captured, separately", () => {
    // The figure this assertion exists for. A follow-up that established
    // somebody is working without establishing where is a different fact from
    // one that established they left, and the only place it can go without
    // lying is its own count.
    const summary = summarizeOutcomes([nowhere()], 0, region);
    expect(summary.employed).toBe(1);
    expect(summary.placeUnknown).toBe(1);
    expect(summary.regional).toBe(0);
  });

  it("does not let a missing place count as having left", () => {
    // Two learners, one of them stayed, one of them was never asked where. A
    // rate of 0.5 here would be reporting a gap in the asking as a departure.
    // It stays in the denominator because they were measured — what is unknown
    // is the place, not whether anybody called.
    const summary = summarizeOutcomes(
      [
        outcome({ id: "out-1", studentId: "stu-1" }),
        nowhere({ id: "out-2", studentId: "stu-2" }),
      ],
      0,
      region,
    );
    expect(summary.measured).toBe(2);
    expect(summary.regional).toBe(1);
    expect(summary.placeUnknown).toBe(1);
    expect(summary.regionalRate).toBe(0.5);
  });

  it("treats a market it cannot resolve as a place unknown, not as a departure", () => {
    // The administrator reads every market at once. A market that fails to
    // resolve has no counties to judge against, and scoring that as leaving
    // would turn a lookup miss into a retention failure.
    const summary = summarizeOutcomes([outcome()], 0, () => null);
    expect(summary.placeUnknown).toBe(1);
    expect(summary.regional).toBe(0);
  });

  it("never counts a non-employment outcome as a place unknown", () => {
    // `still_seeking` has no place because there is no job, which is not the
    // same gap and must not inflate the figure that measures the gap.
    const summary = summarizeOutcomes(
      [nowhere({ kind: "still_seeking" }), nowhere({ id: "out-2", studentId: "stu-2", kind: "continued_education" })],
      0,
      region,
    );
    expect(summary.placeUnknown).toBe(0);
  });

  it("judges each observation against the boundary that was real when it was made", () => {
    // The reason a region is a dated definition rather than a column, asserted
    // end to end. Labette joins this market in 2027. A learner working in
    // Labette in 2026 had left; the same learner in 2028 has not — and the 2026
    // figure must not change when the map does.
    const boundaries = [
      { from: "2000-01-01T00:00:00.000Z", counties: ["Crawford"], state: "KS" },
      { from: "2027-07-01T00:00:00.000Z", counties: ["Crawford", "Labette"], state: "KS" },
    ];
    const inForce = (_marketId: string, observedOn: string) =>
      boundaries.filter((b) => b.from <= observedOn).at(-1) ?? null;

    const inLabette = (id: string, studentId: string, observedOn: string) =>
      outcome({ id, studentId, observedOn, employmentCounty: "Labette" });

    expect(
      summarizeOutcomes([inLabette("out-1", "stu-1", "2026-08-01T00:00:00.000Z")], 0, inForce)
        .regional,
    ).toBe(0);
    expect(
      summarizeOutcomes([inLabette("out-2", "stu-2", "2028-02-01T00:00:00.000Z")], 0, inForce)
        .regional,
    ).toBe(1);
  });

  it("counts an observation with no boundary on record as a place unknown", () => {
    // Not as a departure. A lookup that resolves to nothing has no map to judge
    // against, and scoring that as having left would turn a gap in the
    // reference data into a retention failure.
    const summary = summarizeOutcomes([outcome()], 0, () => null);
    expect(summary.placeUnknown).toBe(1);
    expect(summary.regional).toBe(0);
  });

  it("reports every kind, including the ones nobody scored", () => {
    // A chart that omits empty categories silently changes shape between
    // markets, which is how two screenshots of the same report disagree.
    const summary = summarizeOutcomes([outcome()], 0, region);
    expect(summary.byKind).toHaveLength(OUTCOME_KINDS.length);
  });
});
