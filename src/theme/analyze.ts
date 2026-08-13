/**
 * Checking a partner's colours, and saying what will happen to them.
 *
 * The theme layer already guarantees a readable result — it extracts a hue and
 * computes a ramp that meets every contrast target. What it does not do is
 * *tell anyone*. A college pastes their crimson, gets something a shade
 * darker, and has no way to learn that it was deliberate rather than a bug.
 *
 * That silence is the problem this fixes. Enforcement without explanation
 * reads as a product that ignored you.
 *
 * Two kinds of finding, and the distinction matters:
 *
 * - **adjusted** — we changed something and it still works. Informational, but
 *   it must be said, because the difference is visible.
 * - **warning** — it will render, and you probably do not want it. A gold used
 *   as the primary, or an accent the same hue as the colour this product uses
 *   for errors. Never blocked: a school knows its own brand, and a platform
 *   that refuses a legitimate institutional colour is worse than one that
 *   explains the trade-off.
 *
 * Nothing here rejects. The guarantees live in `ramp.ts` and hold regardless;
 * this only decides what to say.
 */

import type { Accent, Ramp } from "./ramp";
import { accentFromHue, contrastRatio, hueOf, rampFromHue } from "./ramp";

export type Severity = "ok" | "adjusted" | "warning";

export interface Finding {
  severity: Severity;
  title: string;
  detail: string;
  /** What to do instead. Present when there is a better option. */
  suggestion?: string;
}

export interface ThemeReport {
  /** What will actually render. */
  ramp: Ramp;
  accent?: Accent;
  findings: Finding[];
  /** True when nothing needs saying. */
  clean: boolean;
}

/**
 * The hues this product has already spent on meaning.
 *
 * A brand colour landing on one of these is not a contrast problem — it is a
 * semantic one. An accent eleven degrees from the amber used for "this has
 * been waiting nineteen days" competes with a signal the administrator needs
 * to read at a glance.
 */
const RESERVED_HUES: { hue: number; name: string; means: string }[] = [
  { hue: 0, name: "critical", means: "errors and destructive actions" },
  { hue: 32, name: "warning", means: "stalled work and things needing attention" },
  { hue: 161, name: "success", means: "funded, cleared, and granted" },
  { hue: 262, name: "micro-internship", means: "the micro track" },
];

/** Degrees within which two hues stop reading as different colours. */
const HUE_COLLISION = 18;
const PAIR_COLLISION = 25;

export function analyzeTheme(
  brandColor: string,
  accentColor?: string,
): ThemeReport {
  const findings: Finding[] = [];

  const brandHue = hueOf(brandColor);
  const ramp = rampFromHue(brandHue);
  const accent = accentColor ? accentFromHue(hueOf(accentColor)) : undefined;

  if (isGreyscale(brandColor)) {
    findings.push({
      severity: "warning",
      title: "That colour has no hue to work from",
      detail:
        "Greys and near-greys carry no hue, so the generated palette will be a neutral blue-grey rather than anything recognisable as your brand.",
      suggestion:
        "Use your institution's colour rather than a black, white, or grey from the logo.",
    });
  }

  // How far the rendered primary sits from what was submitted.
  const drift = contrastRatio(ramp[700], brandColor);
  if (drift > 1.6) {
    findings.push({
      severity: "adjusted",
      title: "Your primary renders darker than the colour you gave",
      detail:
        `Text and buttons will use ${ramp[700]} rather than ${brandColor}. ` +
        "The colour you chose does not meet the 4.5:1 contrast this product holds itself to when used as text, so the hue is kept and the depth is adjusted until it does.",
      suggestion:
        "Your exact shade can still appear as your second colour, which is used as a fill rather than as text.",
    });
  }

  // A colour too light to be a text colour is almost always the school's
  // *second* colour — a gold, a vegas gold, a light blue.
  if (contrastRatio(brandColor, "#ffffff") < 2.5) {
    findings.push({
      severity: "warning",
      title: "This looks like a second colour, not a primary",
      detail:
        "It is much too light to carry text, so it will be darkened considerably before anything is rendered in it — far enough that it may no longer look like the colour you picked.",
      suggestion:
        "If your institution has a darker colour, use that as the primary and set this one as the accent. Accents are used as fills, where a light colour works properly.",
    });
  }

  for (const finding of reservedHueFindings(brandHue, "primary")) {
    findings.push(finding);
  }

  if (accentColor) {
    const accentHue = hueOf(accentColor);

    if (angularDistance(brandHue, accentHue) < PAIR_COLLISION) {
      findings.push({
        severity: "warning",
        title: "Your two colours are nearly the same hue",
        detail:
          "Side by side they will read as one colour used twice rather than as a pair, which loses the effect of having two.",
        suggestion:
          "Institutions usually pair colours far apart on the wheel — a crimson with a gold, a navy with an amber.",
      });
    }

    for (const finding of reservedHueFindings(accentHue, "accent")) {
      findings.push(finding);
    }

    if (accent) {
      findings.push({
        severity: "ok",
        title:
          accent.on === "#ffffff"
            ? "Your accent takes white text"
            : "Your accent takes dark text",
        detail:
          `Anything placed on ${accent.fill} will use ` +
          `${accent.on === "#ffffff" ? "white" : "near-black"} so it stays readable. ` +
          "This is chosen from the colour rather than configured, so it cannot be set wrongly.",
      });
    }
  }

  return {
    ramp,
    accent,
    findings,
    clean: findings.every((f) => f.severity === "ok"),
  };
}

function reservedHueFindings(hue: number, role: "primary" | "accent"): Finding[] {
  const collision = RESERVED_HUES.find(
    (reserved) => angularDistance(hue, reserved.hue) < HUE_COLLISION,
  );
  if (!collision) return [];

  return [
    {
      severity: "warning",
      title: `Your ${role} is close to the colour used for ${collision.name}`,
      detail:
        `This product uses that hue for ${collision.means}. A ${role} in the same range ` +
        "competes with a signal people are meant to read at a glance, and on a busy screen the two become hard to separate.",
      suggestion:
        role === "accent"
          ? "Consider your institution's other colour for the accent, or accept that the two will sit close."
          : "Nothing is broken by this, but expect brand and status colours to blend on dense screens.",
    },
  ];
}

/** Shortest distance between two hues on the wheel, in degrees. */
export function angularDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Whether a colour carries enough hue to theme from.
 *
 * Measured as chroma relative to the brightest channel rather than as a raw
 * channel spread: slate greys sit around 16% and vivid institutional colours
 * around 70%, but in absolute terms a dark grey and a dark green can differ by
 * the same number of levels. An absolute threshold called `#6b7280` a colour.
 */
function isGreyscale(hex: string): boolean {
  const clean = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  const max = Math.max(r, g, b);
  if (max === 0) return true;
  return (max - Math.min(r, g, b)) / max < 0.22;
}
