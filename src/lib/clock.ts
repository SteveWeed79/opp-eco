/**
 * What "now" means for the rows being read.
 *
 * Two different answers, and until this existed every caller used the first one
 * for both.
 *
 * **The demonstration is frozen on purpose.** `DEMO_NOW` is fixed at module
 * load and every fixture is dated relative to it, so "19 days waiting" reads 19
 * days however long the process has been up. The seed says why: a demo whose
 * numbers creep upward while nobody touches it is worse than one frozen.
 *
 * **A real programme is not.** A coordinator's dwell time measured against the
 * process's start is measured against whenever the host last cold-started —
 * hours or days ago, and invisibly so. Nothing crashes; a number in a workforce
 * report is just wrong.
 *
 * The worst of the call sites was `currentRegion(..., DEMO_NOW)`, which picks
 * which county boundary a retention figure is measured against. Boundaries are
 * dated records precisely so historical figures cannot move, and feeding that
 * lookup a stale clock is the one way left to make them move anyway.
 *
 * Which answer applies follows the same signal the banner does, because it is
 * the same question: are these rows the demonstration's?
 */

import { cache } from "react";
import { DEMO_NOW } from "@/data/seed";
import type { ActorContext } from "@/domain/types";
import { showsDemonstrationData } from "./demonstration";

/**
 * Memoized per request, like `getActor`, because a single console asks several
 * times over and the non-admin path costs a market lookup each time.
 */
export const asOf = cache(
  async (actor: ActorContext): Promise<Date> =>
    (await showsDemonstrationData(actor)) ? DEMO_NOW : new Date(),
);
