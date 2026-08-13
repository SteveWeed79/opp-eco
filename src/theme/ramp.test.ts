import { describe, it, expect } from "vitest";
import { rampFromHue, accentFromHue, contrastRatio, hueOf, hsl } from "./ramp";

/**
 * The point of generating ramps instead of accepting colours is that the
 * guarantee holds for *every* colour a partner might pick — not for the three
 * we happened to try.
 *
 * So these sweep the hue circle. A spot check would have passed on the day and
 * failed the first time a college with an unusual brand signed up, which is
 * exactly when nobody is watching CI.
 */

const EVERY_HUE = Array.from({ length: 72 }, (_, i) => i * 5); // 0–355, 5° steps
const WHITE = "#ffffff";
const INK_950 = "#020617";
const AA = 4.5;

describe("every hue produces a usable ramp", () => {
  it.each(EVERY_HUE)("hue %i: 700 is readable as text on white", (hue) => {
    const ramp = rampFromHue(hue);
    expect(contrastRatio(ramp[700], WHITE)).toBeGreaterThanOrEqual(AA);
  });

  it.each(EVERY_HUE)("hue %i: white is readable on 700", (hue) => {
    // The demanding one. 700 carries white button text *and* is text on white,
    // so it is pinned from both sides.
    const ramp = rampFromHue(hue);
    expect(contrastRatio(WHITE, ramp[700])).toBeGreaterThanOrEqual(AA);
  });

  it.each(EVERY_HUE)("hue %i: 600 is readable as secondary text", (hue) => {
    const ramp = rampFromHue(hue);
    expect(contrastRatio(ramp[600], WHITE)).toBeGreaterThanOrEqual(AA);
  });

  it.each(EVERY_HUE)("hue %i: 400 is readable on the dark header", (hue) => {
    const ramp = rampFromHue(hue);
    expect(contrastRatio(ramp[400], INK_950)).toBeGreaterThanOrEqual(AA);
  });

  it.each(EVERY_HUE)("hue %i: dark ink is readable on the 50 ground", (hue) => {
    // Tinted cards use 50 as a background with ink-950 text on top.
    const ramp = rampFromHue(hue);
    expect(contrastRatio(INK_950, ramp[50])).toBeGreaterThanOrEqual(AA);
  });

  it.each(EVERY_HUE)("hue %i: 700 is readable on the 50 ground", (hue) => {
    // The tinted-badge pairing — `bg-brand-50` with `text-brand-700`. The only
    // place brand text sits on a brand ground, and the constraint the first
    // version of this ramp missed: the hand-picked sky palette passed by luck,
    // and a saturated green failed axe on the themed portals.
    const ramp = rampFromHue(hue);
    expect(contrastRatio(ramp[700], ramp[50])).toBeGreaterThanOrEqual(AA);
  });

  it.each(EVERY_HUE)("hue %i: 700 is readable on every light ground", (hue) => {
    // 700 is the interactive tone and does not only sit on white — the booking
    // panel is warn-50, tinted cards are good-50 or micro-50. Solving against
    // white alone passed the untinted pages and failed on the panel that
    // closes the pause, which is the one that matters most.
    const GROUNDS = ["#ffffff", "#f8fafc", "#ecfdf5", "#fffbeb", "#fef2f2", "#f5f3ff"];
    const ramp = rampFromHue(hue);
    for (const ground of GROUNDS) {
      expect(contrastRatio(ramp[700], ground)).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each(EVERY_HUE)("hue %i: the ramp runs light to dark", (hue) => {
    // Not an accessibility rule — a design one. A ramp that is not monotonic
    // makes 100 darker than 200 somewhere, and every surface built on it
    // stops making sense.
    const ramp = rampFromHue(hue);
    const steps = [ramp[50], ramp[100], ramp[200], ramp[500], ramp[600], ramp[700]];
    const contrasts = steps.map((c) => contrastRatio(c, WHITE));

    for (let i = 1; i < contrasts.length; i++) {
      expect(contrasts[i]).toBeGreaterThanOrEqual(contrasts[i - 1]);
    }
  });
});

describe("the default ramp is no worse than the palette it replaces", () => {
  // The hand-picked sky palette this project shipped with, as the benchmark.
  const SKY_HUE = 199;

  it("matches or beats the hand-tuned brand-700 on white", () => {
    const generated = rampFromHue(SKY_HUE)[700];
    const handTuned = "#0369a1"; // 5.74:1, chosen during the contrast fix

    expect(contrastRatio(generated, WHITE)).toBeGreaterThanOrEqual(
      Math.min(contrastRatio(handTuned, WHITE), AA),
    );
  });

  it("does not reproduce the failure that was fixed", () => {
    // brand-500 at 2.77:1 under white text was the original violation. The
    // generated 700 must not land anywhere near it.
    const generated = rampFromHue(SKY_HUE)[700];
    expect(contrastRatio(WHITE, generated)).toBeGreaterThan(2.77);
  });
});

describe("reading a hue out of a partner's colour", () => {
  it.each([
    ["#0369a1", 201],
    ["#b91c1c", 0],
    ["#15803d", 142],
    ["#7c3aed", 262],
  ])("%s is about %i degrees", (hex, expected) => {
    expect(Math.round(hueOf(hex))).toBeCloseTo(expected, -1);
  });

  it("survives a greyscale colour without dividing by zero", () => {
    expect(hueOf("#808080")).toBe(0);
    expect(() => rampFromHue(hueOf("#808080"))).not.toThrow();
  });

  it("round-trips a partner colour into a usable ramp", () => {
    // The bargain: bring your colour, we guarantee it stays readable. The
    // exact hex is not honoured — the hue is.
    const partnerBrand = "#c2410c"; // a burnt orange, plausibly a college's
    const ramp = rampFromHue(hueOf(partnerBrand));

    expect(contrastRatio(ramp[700], WHITE)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(WHITE, ramp[700])).toBeGreaterThanOrEqual(AA);
  });
});

describe("hsl conversion", () => {
  it.each([
    [0, 0, 100, "#ffffff"],
    [0, 0, 0, "#000000"],
    [0, 100, 50, "#ff0000"],
    [120, 100, 50, "#00ff00"],
    [240, 100, 50, "#0000ff"],
  ])("hsl(%i %i%% %i%%) is %s", (h, s, l, expected) => {
    expect(hsl(h, s, l)).toBe(expected);
  });
});

describe("the second colour", () => {
  it.each(EVERY_HUE)("hue %i: something readable sits on the accent", (hue) => {
    // The accent is a fill, not a text colour. What has to hold is that the
    // ink chosen for it actually reads — white on a navy, near-black on a gold.
    const accent = accentFromHue(hue);
    expect(contrastRatio(accent.on, accent.fill)).toBeGreaterThanOrEqual(AA);
  });

  it("keeps a gold golden rather than darkening it into a brown", () => {
    // The whole reason the accent has its own contract. Running gold through
    // the primary solver would push it dark enough to carry white text, at
    // which point it is not the school's colour any more.
    const gold = accentFromHue(45);
    const asIfPrimary = rampFromHue(45)[700];

    // Still light enough to be recognisably gold...
    expect(contrastRatio(gold.fill, "#ffffff")).toBeLessThan(4.5);
    // ...and it takes dark text, which is how gold is actually used.
    expect(gold.on).toBe("#020617");
    // The primary solver would have gone much darker.
    expect(contrastRatio(asIfPrimary, "#ffffff")).toBeGreaterThan(
      contrastRatio(gold.fill, "#ffffff"),
    );
  });

  it("puts white on a deep navy", () => {
    const navy = accentFromHue(220);
    expect(navy.on).toBe("#ffffff");
  });

  it("stays close to the vividness that was asked for", () => {
    // An accent solved too far from its natural lightness stops looking like
    // the colour the school picked.
    for (const hue of [0, 45, 120, 220, 300]) {
      const { fill } = accentFromHue(hue);
      expect(contrastRatio(fill, "#ffffff")).toBeLessThan(12);
    }
  });
});
