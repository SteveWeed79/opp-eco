/**
 * Generating a brand ramp from a single hue, with contrast guaranteed.
 *
 * An education partner picks **one colour**. They do not pick seven, and they
 * do not pick the text colour that sits on it — because that is how a
 * white-label feature quietly ships an accessibility violation with your name
 * on it.
 *
 * This project spent real effort reaching WCAG 2.1 AA: eleven contrast
 * failures fixed, and `brand-500` rejected outright at 2.77:1 against white in
 * favour of `brand-700` at 5.74:1. A colour picker with a warning label would
 * hand that back. So the input is a hue, and every step of the ramp is
 * *computed* to meet the target its role requires. A partner cannot produce an
 * unusable combination, because the unusable combinations are not reachable.
 *
 * Each step has a job, and the job sets the target:
 *
 * | Step | Used for | Must satisfy |
 * |------|----------|--------------|
 * | 50   | tinted card grounds, badge fills | dark ink readable on it, **and 700 readable on it** |
 * | 100  | borders on tinted cards | — (decorative) |
 * | 200  | selection, emphasis borders | — (decorative) |
 * | 400  | icons on dark ground | ≥ 4.5:1 on ink-950 |
 * | 500  | decorative fills only | — (never carries text) |
 * | 600  | secondary text on white | ≥ 4.5:1 on white |
 * | 700  | buttons, links, headings | ≥ 4.5:1 on **every** light ground, and under white text |
 *
 * The 700 step is the demanding one: it carries white text *and* sits as text
 * on white, so it is pinned from both sides.
 */

export interface Ramp {
  50: string;
  100: string;
  200: string;
  400: string;
  500: string;
  600: string;
  700: string;
}

const WHITE = "#ffffff";
const INK_950 = "#020617";

/**
 * Every light surface brand-coloured text can land on.
 *
 * `brand-700` is the interactive tone — links, the `quiet` button, headings —
 * and it does not only sit on white. The booking panel is `warn-50`, tinted
 * cards are `good-50` or `micro-50`, page grounds are `ink-50`. Solving 700
 * against white alone passed axe on the untinted pages and failed on the one
 * that mattered most: the panel that closes the pause.
 *
 * So 700 is solved against the **darkest** of these, which subsumes the rest.
 * These are the product's own state colours and a partner never recolours
 * them — a school rebranding "this failed" is not branding.
 */
const LIGHT_GROUNDS = [
  WHITE,
  "#f8fafc", // ink-50
  "#ecfdf5", // good-50
  "#fffbeb", // warn-50
  "#fef2f2", // crit-50
  "#f5f3ff", // micro-50
];

/** WCAG AA for normal text. The bar this product already claims to meet. */
const AA = 4.5;

/**
 * Build a full ramp from a hue.
 *
 * `hue` is degrees, 0–360. `chroma` scales saturation for partners whose brand
 * is muted; it never affects whether a step passes, because lightness is
 * solved after saturation is fixed.
 */
export function rampFromHue(hue: number, chroma = 1): Ramp {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(96 * chroma, 0, 100);

  // Solved in *lightness*, not in hex, so the ordering constraint below is
  // arithmetic rather than a hope.
  //
  // Saturation is held constant across the solved steps for the same reason:
  // varying it per step made contrast-against-white non-monotonic, which is
  // how the first version of this shipped a ramp where 500 came out darker
  // than 600 for blue-violet hues and every surface built on it inverted.
  const l400 = solveL(h, s, INK_950, AA, "lighten");
  const l600 = solveL(h, s, WHITE, AA, "darken");
  const l700 = solveBothWaysL(h, s);

  // Decorative fill only — the progress bar, which never carries text. Placed
  // between its neighbours by construction so the ramp cannot invert, whatever
  // the hue.
  const l500 = Math.round((l400 + l600) / 2);

  // The tinted-badge pairing: `bg-brand-50` with `text-brand-700`, used by the
  // brand badge, the combobox chip and its highlighted row, and two icon
  // tiles. It is the one place brand text sits on a brand ground, and the
  // first version of this ramp had no target for it — the sky palette passed
  // by luck and a saturated green failed axe on the themed portals.
  //
  // 700 is already pinned from both sides against white, so 50 is the free
  // variable. Lightening always converges: as 50 approaches white it inherits
  // the guarantee 700 already carries.
  const c700 = hsl(h, s, l700);
  const l50 = solveGroundFor(h, s, c700, AA);

  return {
    // Light grounds. Dark ink on these has to work — it does at these
    // lightnesses for every hue — and 50 additionally carries 700 as text.
    50: hsl(h, s, l50),
    100: hsl(h, s, 93),
    200: hsl(h, s, 87),

    400: hsl(h, s, l400),
    500: hsl(h, s, l500),
    600: hsl(h, s, l600),
    700: hsl(h, s, l700),
  };
}

/**
 * Darken (or lighten) until the contrast target against `against` is met.
 *
 * A scan rather than a binary search: lightness is an integer percentage, the
 * space is 100 wide, and contrast is not perfectly monotonic once rounding to
 * 8-bit channels is involved. Scanning is exact and costs nothing here.
 */
function solveL(
  h: number,
  s: number,
  against: string,
  target: number,
  direction: "darken" | "lighten",
): number {
  const range =
    direction === "darken"
      ? Array.from({ length: 96 }, (_, i) => 95 - i) // 95 → 0
      : Array.from({ length: 96 }, (_, i) => i + 5); // 5 → 100

  for (const l of range) {
    if (contrastRatio(hsl(h, s, l), against) >= target) return l;
  }
  // Unreachable for any hue at these saturations, but a ramp is not the place
  // to throw: fall back to the extreme, which trivially passes.
  return direction === "darken" ? 0 : 100;
}

/**
 * Lighten a tint until the given foreground is readable on it.
 *
 * Used for the one ground that carries brand-coloured text. Converges for
 * every hue because the limit is white, against which the foreground already
 * passes by construction.
 */
function solveGroundFor(
  h: number,
  s: number,
  foreground: string,
  target: number,
): number {
  for (let l = 93; l <= 100; l++) {
    if (contrastRatio(foreground, hsl(h, s, l)) >= target) return l;
  }
  return 100;
}

/**
 * The 700 step: readable as text on white, and readable *under* white text.
 *
 * Both constraints pull the same direction — darker satisfies each — so the
 * darker of the two solutions satisfies both. Solving them separately and
 * taking the stricter is clearer than reasoning about which dominates for a
 * given hue, and it stays correct if a target ever changes.
 */
function solveBothWaysL(h: number, s: number): number {
  for (let l = 95; l >= 0; l--) {
    const candidate = hsl(h, s, l);
    const readableOnEveryGround = LIGHT_GROUNDS.every(
      (ground) => contrastRatio(candidate, ground) >= AA,
    );
    if (readableOnEveryGround && contrastRatio(WHITE, candidate) >= AA) {
      return l;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

/** HSL to a hex string. Percentages in, `#rrggbb` out. */
export function hsl(h: number, s: number, l: number): string {
  const sN = clamp(s, 0, 100) / 100;
  const lN = clamp(l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));

  const [r, g, b] =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x];

  const m = lN - c / 2;
  return `#${[r, g, b].map((v) => channelHex(v + m)).join("")}`;
}

function channelHex(value: number): string {
  return Math.round(clamp(value, 0, 1) * 255)
    .toString(16)
    .padStart(2, "0");
}

/**
 * WCAG 2.x contrast ratio between two hex colours.
 *
 * The same formula the accessibility suite enforces, implemented here so a
 * theme can be rejected before it reaches a page rather than after axe finds
 * it in CI.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function toRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Read a hue out of a hex colour, so a partner can paste their brand colour
 * and get the nearest ramp that is actually usable.
 *
 * Their exact hex is deliberately not honoured. It is the starting point for a
 * ramp, not a value the product renders — which is the whole bargain: you
 * bring your colour, we guarantee it stays readable.
 */
export function hueOf(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;

  const h =
    max === r ? ((g - b) / delta) % 6
    : max === g ? (b - r) / delta + 2
    : (r - g) / delta + 4;

  return ((h * 60) % 360 + 360) % 360;
}
