import { describe, it, expect } from "vitest";
import type { RegionDefinition } from "./types";
import {
  currentRegion,
  normaliseCounties,
  redefineBlockReason,
  regionHistory,
  regionInForce,
  sameBoundary,
} from "./region";

function definition(overrides: Partial<RegionDefinition> = {}): RegionDefinition {
  return {
    id: "region-1",
    marketId: "mkt-1",
    state: "KS",
    counties: ["Crawford", "Cherokee"],
    effectiveFrom: "2000-01-01T00:00:00.000Z",
    recordedByUserId: null,
    recordedOn: "2000-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A market that was redesignated once, gaining a county in 2027. */
const REDESIGNATED = [
  definition({ id: "region-1", effectiveFrom: "2000-01-01T00:00:00.000Z" }),
  definition({
    id: "region-2",
    effectiveFrom: "2027-07-01T00:00:00.000Z",
    counties: ["Crawford", "Cherokee", "Labette"],
    recordedByUserId: "u-admin",
    source: "2027 local area redesignation",
  }),
];

describe("which boundary was in force", () => {
  it("takes the latest definition at or before the moment", () => {
    expect(regionInForce(REDESIGNATED, "mkt-1", "2026-08-15T00:00:00.000Z")?.id)
      .toBe("region-1");
    expect(regionInForce(REDESIGNATED, "mkt-1", "2028-02-01T00:00:00.000Z")?.id)
      .toBe("region-2");
  });

  it("does not let a later boundary reach backwards", () => {
    // The whole reason this is a dated row rather than a column. An outcome
    // observed in 2026 is judged against the 2026 map, whatever the map says
    // in 2029 — otherwise a redesignation silently rewrites a figure that has
    // already been reported and nothing says so.
    const before = regionInForce(REDESIGNATED, "mkt-1", "2026-08-15T00:00:00.000Z");
    expect(before?.counties).not.toContain("Labette");
  });

  it("is inclusive of the instant a definition takes effect", () => {
    expect(regionInForce(REDESIGNATED, "mkt-1", "2027-07-01T00:00:00.000Z")?.id)
      .toBe("region-2");
  });

  it("is null before any definition exists", () => {
    // A real answer rather than a failure. An observation with no boundary to
    // be judged against lands in `placeUnknown` — counted apart — rather than
    // being scored as having left.
    const late = [definition({ effectiveFrom: "2030-01-01T00:00:00.000Z" })];
    expect(regionInForce(late, "mkt-1", "2026-01-01T00:00:00.000Z")).toBeNull();
  });

  it("never reads another market's boundary", () => {
    const other = [definition({ id: "region-x", marketId: "mkt-2" })];
    expect(regionInForce(other, "mkt-1", "2026-01-01T00:00:00.000Z")).toBeNull();
  });

  it("resolves today's for a screen", () => {
    expect(currentRegion(REDESIGNATED, "mkt-1", new Date("2029-01-01T00:00:00.000Z"))?.id)
      .toBe("region-2");
  });

  it("lists the history newest first", () => {
    // Worth surfacing rather than hiding: an administrator looking at a figure
    // that moved between two years wants to know whether the programme changed
    // or the map did, and this is the only thing that can tell them.
    expect(regionHistory(REDESIGNATED, "mkt-1").map((d) => d.id))
      .toEqual(["region-2", "region-1"]);
  });
});

describe("what a redefinition refuses", () => {
  it("refuses one that takes effect before the boundary it replaces", () => {
    // An earlier definition is a rewrite of history wearing an append's
    // clothing, which is the single thing this model exists to prevent.
    expect(redefineBlockReason(REDESIGNATED, "mkt-1", "2026-01-01T00:00:00.000Z"))
      .toMatch(/after the one it replaces/);
  });

  it("refuses one that takes effect at the same instant", () => {
    // Two rows sharing a date makes "in force" a coin toss, and the two data
    // layers would each pick a different winner while both looked correct.
    expect(redefineBlockReason(REDESIGNATED, "mkt-1", "2027-07-01T00:00:00.000Z"))
      .toBeTruthy();
  });

  it("allows one that takes effect afterwards", () => {
    expect(redefineBlockReason(REDESIGNATED, "mkt-1", "2029-01-01T00:00:00.000Z"))
      .toBeNull();
  });

  it("allows the first definition a market has ever had", () => {
    expect(redefineBlockReason([], "mkt-1", "2026-01-01T00:00:00.000Z")).toBeNull();
  });
});

describe("comparing boundaries", () => {
  it("normalises a county list without losing which spelling was given", () => {
    // Trimmed, deduplicated case-insensitively, first spelling wins, and
    // ordered by the folded key rather than by `localeCompare` — which is
    // locale-dependent, and this list is compared across two data layers.
    expect(normaliseCounties([" cherokee ", "Crawford", "CHEROKEE", "  "]))
      .toEqual(["cherokee", "Crawford"]);
  });

  it("calls two the same regardless of order or case", () => {
    expect(
      sameBoundary(
        { state: "KS", counties: ["Crawford", "Cherokee"] },
        { state: "ks", counties: [" cherokee", "crawford "] },
      ),
    ).toBe(true);
  });

  it("calls two different when the state differs", () => {
    // Kansas and Missouri both have a Jackson County, which is the whole
    // reason the state is stored beside the counties.
    expect(
      sameBoundary(
        { state: "KS", counties: ["Jackson"] },
        { state: "MO", counties: ["Jackson"] },
      ),
    ).toBe(false);
  });

  it("calls two different when one has a county the other lacks", () => {
    expect(
      sameBoundary(
        { state: "KS", counties: ["Crawford"] },
        { state: "KS", counties: ["Crawford", "Cherokee"] },
      ),
    ).toBe(false);
  });
});
