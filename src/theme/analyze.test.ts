import { describe, it, expect } from "vitest";
import { analyzeTheme, angularDistance } from "./analyze";

/**
 * These pin the advice, not the palette — the guarantees are `ramp.test.ts`'s
 * job. What matters here is that a partner is *told* the right thing, because
 * enforcement without explanation reads as a product that ignored you.
 */

const titles = (report: ReturnType<typeof analyzeTheme>) =>
  report.findings.map((f) => f.title);

describe("a colour that works", () => {
  it("says nothing unnecessary about a solid dark primary", () => {
    // A deep navy needs no adjustment and collides with nothing.
    const report = analyzeTheme("#1e3a8a");
    expect(report.findings.filter((f) => f.severity === "warning")).toEqual([]);
  });
});

describe("a colour that has to be adjusted", () => {
  it("says so, rather than silently rendering something else", () => {
    // A mid-tone that cannot carry text at 4.5:1 without being deepened.
    const report = analyzeTheme("#4da3ff");
    const adjusted = report.findings.find((f) => f.severity === "adjusted");

    expect(adjusted).toBeTruthy();
    expect(adjusted?.detail).toContain("#4da3ff");
    // The rendered value is named, so the difference is checkable rather than
    // something the partner has to notice.
    expect(adjusted?.detail).toContain(report.ramp[700]);
  });

  it("points a too-light colour at the role it actually suits", () => {
    // The gold case. Told to be a primary, it would be darkened into a brown.
    const report = analyzeTheme("#c9a227");
    const finding = report.findings.find((f) =>
      f.title.includes("second colour, not a primary"),
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.suggestion).toContain("accent");
  });
});

describe("collisions with colours that already mean something", () => {
  it("flags a primary sitting on the warning hue", () => {
    const report = analyzeTheme("#d97706");
    expect(titles(report).some((t) => t.includes("used for warning"))).toBe(true);
  });

  it("flags a crimson against the critical hue", () => {
    // A real institutional colour, and a real problem: crimson is where this
    // product puts errors and destructive actions.
    const report = analyzeTheme("#a6192e");
    const finding = report.findings.find((f) => f.title.includes("critical"));

    expect(finding).toBeTruthy();
    expect(finding?.detail).toContain("destructive");
  });

  it("flags the seeded gold accent against the warning amber", () => {
    // Not a contrived case — this is the demo's own seed. Gold at 43° sits
    // eleven degrees from the amber used for stalled work.
    const report = analyzeTheme("#1b5e3f", "#c9a227");
    expect(
      titles(report).some((t) => t.includes("accent is close") && t.includes("warning")),
    ).toBe(true);
  });

  it("does not flag colours that are safely clear of a reserved hue", () => {
    // Navy at ~224° and olive at ~86°: clear of all four reserved hues, and
    // far enough apart to read as a pair.
    const report = analyzeTheme("#1e3a8a", "#4d7c0f");
    expect(titles(report).some((t) => t.includes("close to the colour"))).toBe(false);
  });

  it("reports both collisions for the demo's own seeded college", () => {
    // Verdigris State is green and gold, which is an extremely common
    // institutional pairing — and it collides twice: the green sits nine
    // degrees from the success colour, the gold eleven from the warning amber.
    //
    // Kept in the seed rather than swapped for something that reports clean.
    // A checker that only ever produces good news on the data it ships with
    // has not been tested against anything.
    const report = analyzeTheme("#1b5e3f", "#c9a227");
    const collisions = titles(report).filter((t) => t.includes("close to the colour"));

    expect(collisions).toHaveLength(2);
    expect(collisions.some((t) => t.includes("success"))).toBe(true);
    expect(collisions.some((t) => t.includes("warning"))).toBe(true);
  });
});

describe("the pair", () => {
  it("flags two colours that will not read as two", () => {
    const report = analyzeTheme("#1e3a8a", "#2563eb");
    expect(titles(report).some((t) => t.includes("nearly the same hue"))).toBe(true);
  });

  it("accepts a genuine crimson-and-gold pairing as a pair", () => {
    const report = analyzeTheme("#8c1d40", "#ffc627");
    expect(titles(report).some((t) => t.includes("nearly the same hue"))).toBe(false);
  });

  it("states which ink lands on the accent", () => {
    // It changes how the colour looks, and it is decided rather than set.
    const gold = analyzeTheme("#1b5e3f", "#c9a227");
    expect(titles(gold).some((t) => t.includes("dark text"))).toBe(true);

    const navy = analyzeTheme("#7c2d92", "#1e3a8a");
    expect(titles(navy).some((t) => t.includes("white text"))).toBe(true);
  });
});

describe("input that carries no hue", () => {
  it("warns on a grey, which would theme to nothing recognisable", () => {
    const report = analyzeTheme("#6b7280");
    expect(titles(report).some((t) => t.includes("no hue"))).toBe(true);
  });

  it("still returns a usable ramp rather than failing", () => {
    // Advice never blocks. The guarantees hold regardless of what is said.
    const report = analyzeTheme("#000000");
    expect(report.ramp[700]).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("angular distance", () => {
  it.each([
    [0, 10, 10],
    [350, 10, 20],
    [10, 350, 20],
    [0, 180, 180],
    [90, 270, 180],
  ])("between %i and %i is %i", (a, b, expected) => {
    expect(angularDistance(a, b)).toBe(expected);
  });
});
