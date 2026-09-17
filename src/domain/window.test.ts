import { describe, it, expect } from "vitest";
import type { Outcome } from "./types";
import {
  FOLLOW_UP_QUARTERS,
  followUpWindows,
  missedWindows,
  windowAnsweredBy,
  windowDueNow,
  windowStatuses,
} from "./window";

/**
 * The day a placement ended, which is the only thing this module takes.
 *
 * Whether a placement *has* ended, and which field holds the date, is
 * `outcome.ts`'s question — see `followUpWindowsFor` and its tests there.
 */
const EXIT = "2026-02-20T00:00:00.000Z";

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
    observedOn: "2026-08-15T00:00:00.000Z",
    recordedOn: "2026-08-15T00:00:00.000Z",
    recordedByUserId: "u-college",
    source: "college",
    ...overrides,
  };
}

describe("which quarters are measured", () => {
  it("is the second and the fourth after exit", () => {
    expect(FOLLOW_UP_QUARTERS).toEqual([2, 4]);
  });

  it("counts from the quarter the placement ended in, not from the day", () => {
    // Exit 20 February is Q1 2026. The second quarter after it is Q3 — Jul–Sep
    // — and the fourth is Q1 2027.
    const windows = followUpWindows(EXIT);
    expect(windows).toHaveLength(2);
    expect(windows[0].opensOn).toBe("2026-07-01T00:00:00.000Z");
    expect(windows[0].closesOn).toBe("2026-10-01T00:00:00.000Z");
    expect(windows[1].opensOn).toBe("2027-01-01T00:00:00.000Z");
  });

  it("puts two placements in the same quarter on the same clock", () => {
    // Five weeks apart, both in Q1, both measured in Q3. This is the property
    // that makes two cohorts comparable: they are measured against the same
    // calendar rather than against their own end dates.
    const early = followUpWindows("2026-02-20T00:00:00.000Z");
    const late = followUpWindows("2026-03-28T00:00:00.000Z");
    expect(late[0].opensOn).toBe(early[0].opensOn);
  });

  it("puts one five days later into the next one", () => {
    // 28 March and 2 April are five days apart and a quarter apart in
    // measurement. That is the calendar working rather than a bug — and the
    // reason the screens show the window rather than a countdown.
    const march = followUpWindows("2026-03-28T00:00:00.000Z");
    const april = followUpWindows("2026-04-02T00:00:00.000Z");
    expect(march[0].opensOn).toBe("2026-07-01T00:00:00.000Z");
    expect(april[0].opensOn).toBe("2026-10-01T00:00:00.000Z");
  });

  it("labels a window in months a person reads, never in arithmetic", () => {
    const windows = followUpWindows(EXIT);
    expect(windows[0].label).toBe("Jul–Sep 2026");
    expect(windows[1].label).toBe("Jan–Mar 2027");
  });

  it("crosses a year end without drifting", () => {
    const windows = followUpWindows("2026-11-15T00:00:00.000Z");
    expect(windows[0].label).toBe("Apr–Jun 2027");
    expect(windows[1].label).toBe("Oct–Dec 2027");
  });

  it("treats the last instant of a quarter as that quarter", () => {
    // An off-by-one here would file a whole cohort a quarter late.
    const windows = followUpWindows("2026-03-31T23:59:59.999Z");
    expect(windows[0].opensOn).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("what answers a window", () => {
  it("takes an observation inside it", () => {
    expect(windowAnsweredBy(outcome(), followUpWindows(EXIT))).toMatchObject({
      quartersAfterExit: 2,
    });
  });

  it("answers by when it was true, not when it was typed", () => {
    // A follow-up written up a fortnight after the call still describes the day
    // of the call. That distinction is why the two fields are separate.
    const late = outcome({
      observedOn: "2026-09-28T00:00:00.000Z",
      recordedOn: "2026-10-20T00:00:00.000Z",
    });
    expect(windowAnsweredBy(late, followUpWindows(EXIT))).toMatchObject({
      quartersAfterExit: 2,
    });
  });

  it("answers nothing when it predates the first window", () => {
    // Not discarded — it is a real record of where somebody was, and it still
    // counts in the summary. It just cannot stand in for a measurement of a
    // quarter that had not happened yet.
    const early = outcome({ observedOn: "2026-03-01T00:00:00.000Z" });
    expect(windowAnsweredBy(early, followUpWindows(EXIT))).toBeNull();
  });

  it("closes a window exclusively", () => {
    // An observation at exactly 1 October is in Q4, and Q3 has ended. Inclusive
    // on both ends would let one answer settle two windows.
    const boundary = outcome({ observedOn: "2026-10-01T00:00:00.000Z" });
    expect(windowAnsweredBy(boundary, followUpWindows(EXIT))).toBeNull();
  });

  it("opens a window inclusively", () => {
    const boundary = outcome({ observedOn: "2026-07-01T00:00:00.000Z" });
    expect(windowAnsweredBy(boundary, followUpWindows(EXIT))).toMatchObject({
      quartersAfterExit: 2,
    });
  });
});

describe("where each window stands", () => {
  it("is waiting before it opens", () => {
    const states = windowStatuses(EXIT, [], new Date("2026-05-01T00:00:00.000Z"));
    expect(states.map((w) => w.state)).toEqual(["waiting", "waiting"]);
  });

  it("is due while it is open and unanswered", () => {
    const states = windowStatuses(EXIT, [], new Date("2026-08-01T00:00:00.000Z"));
    expect(states[0].state).toBe("due");
    expect(states[1].state).toBe("waiting");
  });

  it("is answered once something inside it exists", () => {
    const states = windowStatuses(EXIT, [outcome()], new Date("2026-09-01T00:00:00.000Z"));
    expect(states[0].state).toBe("answered");
  });

  it("is missed once it closes with nothing in it", () => {
    // The running cost of having had no clock. Nobody can be phoned in
    // February and asked where they were last August with any confidence, so
    // this is reported rather than queued — a queue that keeps offering
    // impossible work teaches its operator to ignore the queue.
    const states = windowStatuses(EXIT, [], new Date("2026-11-01T00:00:00.000Z"));
    expect(states[0].state).toBe("missed");
    expect(states[1].state).toBe("waiting");
  });

  it("stays answered after it closes", () => {
    const states = windowStatuses(EXIT, [outcome()], new Date("2027-06-01T00:00:00.000Z"));
    expect(states[0].state).toBe("answered");
    expect(states[1].state).toBe("missed");
  });

  it("does not let one window's answer settle another", () => {
    // The change from the old one-shot rule. Any outcome at all used to clear a
    // placement from the queue forever; now a Q2 answer settles Q2 and leaves
    // Q4 to be asked.
    const states = windowStatuses(EXIT, [outcome()], new Date("2027-02-01T00:00:00.000Z"));
    expect(states.map((w) => w.state)).toEqual(["answered", "due"]);
  });
});

describe("what the queue asks for", () => {
  it("offers the open window and nothing else", () => {
    const due = windowDueNow(EXIT, [], new Date("2026-08-01T00:00:00.000Z"));
    expect(due?.quartersAfterExit).toBe(2);
    expect(due?.label).toBe("Jul–Sep 2026");
  });

  it("offers nothing while every window is waiting", () => {
    expect(windowDueNow(EXIT, [], new Date("2026-05-01T00:00:00.000Z"))).toBeNull();
  });

  it("offers nothing for a window that has been missed", () => {
    expect(windowDueNow(EXIT, [], new Date("2026-11-01T00:00:00.000Z"))).toBeNull();
  });

  it("counts a missed window as a gap that can be reported", () => {
    const missed = missedWindows(EXIT, [], new Date("2026-11-01T00:00:00.000Z"));
    expect(missed).toHaveLength(1);
    expect(missed[0].label).toBe("Jul–Sep 2026");
  });

  it("has nothing missed while the clock is still running", () => {
    expect(missedWindows(EXIT, [], new Date("2026-08-01T00:00:00.000Z"))).toEqual([]);
  });
});
