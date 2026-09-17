/**
 * Which boundary was real at a given moment.
 *
 * A market's counties used to be a field, which meant they were always
 * whatever they are now. That is fine until a boundary moves — local workforce
 * areas are redesignated and MSAs are redrawn after each census — and then a
 * single mutable list does something quietly catastrophic: it rewrites every
 * figure ever computed. The 2026 retention rate recomputed in 2029 comes back
 * different, measured against a boundary nobody had in 2026, and nothing on the
 * screen says so.
 *
 * This is the only piece of the report's snapshot design that is genuinely
 * cheap now and impossible later. The totals themselves stay recomputable —
 * the retention purge anonymises rather than deletes, so an outcome keeps its
 * kind and its county — but a boundary nobody wrote down is a boundary that
 * cannot be reconstructed from anything.
 *
 * **Definitions are never edited.** A change writes a new row with a later
 * `effectiveFrom`, and the old row stays exactly as it was. Everything here
 * reads; `redefineRegion` is the only writer, and it appends.
 */

import type { RegionDefinition } from "./types";

/**
 * Newest first, with the id breaking ties.
 *
 * The tiebreak matters more than it looks: two definitions sharing an
 * `effectiveFrom` is a data error, and without a stable order the two backends
 * would disagree about which one won while both looked correct.
 */
export function byEffectiveDescending(a: RegionDefinition, b: RegionDefinition): number {
  return b.effectiveFrom.localeCompare(a.effectiveFrom) || b.id.localeCompare(a.id);
}

/**
 * The definition in force for this market at that moment, or null.
 *
 * Null is a real answer rather than a failure: an observation predating every
 * definition on record has no boundary to be judged against, and saying so is
 * the honest result. It lands in `placeUnknown` — counted apart — rather than
 * being scored as having left, which is the same rule the rest of the outcome
 * model follows about things nobody established.
 */
export function regionInForce(
  definitions: RegionDefinition[],
  marketId: string,
  at: string,
): RegionDefinition | null {
  return (
    definitions
      .filter((d) => d.marketId === marketId && d.effectiveFrom <= at)
      .sort(byEffectiveDescending)[0] ?? null
  );
}

/** What the market's boundary is today, for a screen rather than a figure. */
export function currentRegion(
  definitions: RegionDefinition[],
  marketId: string,
  now: Date,
): RegionDefinition | null {
  return regionInForce(definitions, marketId, now.toISOString());
}

/**
 * Every definition this market has had, newest first.
 *
 * The history is worth surfacing rather than hiding. An administrator looking
 * at a figure that moved between two years wants to know whether the programme
 * changed or the map did, and this is the only thing that can tell them.
 */
export function regionHistory(
  definitions: RegionDefinition[],
  marketId: string,
): RegionDefinition[] {
  return definitions.filter((d) => d.marketId === marketId).sort(byEffectiveDescending);
}

/**
 * Why this definition cannot be added, or null.
 *
 * A new boundary may not take effect at or before the one it supersedes. Two
 * definitions with the same date is a coin toss about which is in force, and an
 * earlier one is a rewrite of history wearing an append's clothing — which is
 * the single thing this whole model exists to prevent.
 */
export function redefineBlockReason(
  definitions: RegionDefinition[],
  marketId: string,
  effectiveFrom: string,
): string | null {
  const latest = regionHistory(definitions, marketId)[0];
  if (!latest) return null;
  if (effectiveFrom <= latest.effectiveFrom) {
    return "A new boundary has to take effect after the one it replaces. Backdating one would rewrite figures that have already been reported.";
  }
  return null;
}

/**
 * The counties, trimmed, deduplicated case-insensitively, and ordered.
 *
 * Ordered by the lowercased name with a plain comparison rather than
 * `localeCompare`, which is locale-dependent: two processes in different
 * locales would produce different orders for the same boundary, and this list
 * is compared element by element across two data layers. The spelling somebody
 * actually typed is what is kept — only the sort key is folded.
 */
export function normaliseCounties(counties: string[]): string[] {
  const seen = new Map<string, string>();
  for (const county of counties) {
    const trimmed = county.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return [...seen.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, spelling]) => spelling);
}

/** Whether two definitions describe the same boundary, ignoring order and case. */
export function sameBoundary(
  a: Pick<RegionDefinition, "counties" | "state">,
  b: Pick<RegionDefinition, "counties" | "state">,
): boolean {
  if (a.state.trim().toUpperCase() !== b.state.trim().toUpperCase()) return false;
  const left = normaliseCounties(a.counties).map((c) => c.toLowerCase());
  const right = normaliseCounties(b.counties).map((c) => c.toLowerCase());
  return left.length === right.length && left.every((c, i) => c === right[i]);
}
