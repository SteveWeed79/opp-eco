/**
 * Redefining a boundary.
 *
 * Writes to the shared seed arrays, so every test records what it added and
 * takes it out again — a stray definition changes what "in region" means for
 * every reporting suite that runs after it.
 */

import { describe, it, expect, afterEach } from "vitest";
import { redefineRegion } from "./region";
import { regionInForce } from "@/domain/region";
import { contextFor } from "@/data/session";
import * as seed from "@/data/seed";

const SEEDED = new Set(seed.regionDefinitions.map((d) => d.id));

afterEach(() => {
  for (let i = seed.regionDefinitions.length - 1; i >= 0; i--) {
    if (!SEEDED.has(seed.regionDefinitions[i].id)) {
      seed.regionDefinitions.splice(i, 1);
    }
  }
  // `appendAuditEvent` unshifts, so anything a test added is at the head.
  while (seed.auditEvents.length > 5) seed.auditEvents.shift();
});

const admin = () => contextFor("admin");
const MARKET = "mkt-pittsburg";

/** A date comfortably after the boundary the fixtures ship with. */
const LATER = "2027-07-01T00:00:00.000Z";

function redefine(overrides: Partial<Parameters<typeof redefineRegion>[1]> = {}) {
  return redefineRegion(admin(), {
    marketId: MARKET,
    state: "KS",
    counties: ["Crawford", "Cherokee", "Labette", "Neosho", "Bourbon"],
    effectiveFrom: LATER,
    source: "2027 local area redesignation",
    ...overrides,
  });
}

describe("who may redefine one", () => {
  it("is the administrator", async () => {
    const result = await redefine();
    expect(result.ok).toBe(true);
  });

  it("is nobody else", async () => {
    // Unusual for something a board would hear about first, and deliberate: a
    // redesignation is the state's news rather than this market's, and it is
    // the only write here whose effect shows up in figures computed later.
    for (const role of ["college", "board", "business", "student"] as const) {
      const result = await redefineRegion(contextFor(role), {
        marketId: MARKET,
        state: "KS",
        counties: ["Crawford"],
        effectiveFrom: LATER,
        source: "Trying it on.",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("forbidden");
    }
  });
});

describe("what it appends", () => {
  it("adds a definition and leaves the one it replaces untouched", async () => {
    // The whole guarantee. An edit would rewrite every figure ever computed
    // against the old boundary, including ones already sent to a board.
    const before = seed.regionDefinitions
      .filter((d) => d.marketId === MARKET)
      .map((d) => ({ ...d }));

    const result = await redefine();
    expect(result.ok).toBe(true);

    for (const original of before) {
      const still = seed.regionDefinitions.find((d) => d.id === original.id);
      expect(still).toEqual(original);
    }
    expect(seed.regionDefinitions.filter((d) => d.marketId === MARKET))
      .toHaveLength(before.length + 1);
  });

  it("leaves an earlier observation judged by the earlier boundary", async () => {
    // The point of all of it, asserted through the lookup an outcome uses.
    // Bourbon joins this market in 2027; somebody working there in 2026 had
    // left, and that does not change when the map does.
    await redefine();
    const all = seed.regionDefinitions;

    expect(regionInForce(all, MARKET, "2026-08-01T00:00:00.000Z")?.counties)
      .not.toContain("Bourbon");
    expect(regionInForce(all, MARKET, "2028-01-01T00:00:00.000Z")?.counties)
      .toContain("Bourbon");
  });

  it("normalises the counties and the state", async () => {
    const result = await redefine({
      state: "ks",
      counties: [" bourbon ", "Crawford", "CRAWFORD"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created.state).toBe("KS");
    expect(result.created.counties).toEqual(["bourbon", "Crawford"]);
  });

  it("names the boundary it replaces in the audit entry", async () => {
    // "Why did this market's retention rate change in 2027" is a question
    // somebody will ask, and the answer has to be readable from the log rather
    // than reconstructed from two rows and a date.
    const result = await redefine();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const event = seed.auditEvents[0];
    expect(event?.entityType).toBe("region");
    expect(event?.entityId).toBe(result.created.id);
    expect(event?.from).toContain("Crawford");
    expect(event?.to).toContain("Bourbon");
    expect(event?.reason).toBe("2027 local area redesignation");
  });
});

describe("what it refuses", () => {
  it("refuses a boundary that takes effect before the one in force", async () => {
    // Backdating is a rewrite of history wearing an append's clothing.
    const result = await redefine({ effectiveFrom: "1999-01-01T00:00:00.000Z" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/after the one it replaces/);
  });

  it("refuses a second boundary at the same instant", async () => {
    await redefine();
    const again = await redefine({ counties: ["Crawford"] });
    expect(again.ok).toBe(false);
  });

  it("refuses one identical to the boundary already in force", async () => {
    // A form submitted twice, not a redesignation. Recording it would put a
    // row in the history that changes nothing and make the market look as
    // though its boundary moved on a date it did not.
    const current = seed.regionDefinitions.find((d) => d.marketId === MARKET)!;
    const result = await redefine({
      counties: [...current.counties].reverse(),
      state: current.state.toLowerCase(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("duplicate");
  });

  it("refuses a region with no counties", async () => {
    const result = await redefine({ counties: ["   "] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least one county/);
  });

  it("refuses a date it cannot read", async () => {
    const result = await redefine({ effectiveFrom: "next Tuesday" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid");
  });

  it("refuses a market that does not exist", async () => {
    const result = await redefine({ marketId: "mkt-nowhere" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
  });
});
