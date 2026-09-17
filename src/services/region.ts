/**
 * Redefining a market's boundary, additively.
 *
 * Local workforce areas are redesignated and MSAs are redrawn after each
 * census. When that happens the counties a market is measured against change,
 * and the one thing that must not happen is the old boundary being edited —
 * that would silently rewrite every figure ever computed against it, including
 * ones already sent to a board.
 *
 * So there is no update. This appends a definition with a later effective date,
 * and `regionInForce` picks whichever was real at the moment each observation
 * was made. A figure reported in 2026 stays the figure it was.
 *
 * The administrator alone, which is unusual for something a board would know
 * first and deliberate: a redesignation is not this market's news, it is the
 * state's, and it reaches every market in the network at once. It is also the
 * only write in the product whose effect is retroactive in appearance — every
 * figure computed *after* it moves — so it belongs on the desk that answers for
 * the platform rather than on one that reports through it.
 */

import type { ActorContext, RegionDefinition } from "@/domain/types";
import {
  normaliseCounties,
  redefineBlockReason,
  regionHistory,
  sameBoundary,
} from "@/domain/region";
import { repositories, store } from "@/data/backend";
import type { Store } from "@/data/store";
import { logger } from "@/services/logging";

export type RegionResult =
  | { ok: true; created: RegionDefinition }
  | {
      ok: false;
      error: string;
      code: "forbidden" | "not_found" | "duplicate" | "invalid";
    };

export interface RedefineRegionInput {
  marketId: string;
  state: string;
  counties: string[];
  /** ISO. When the new boundary takes effect. */
  effectiveFrom: string;
  /** The redesignation notice, the census, the board's paperwork. Required. */
  source: string;
}

export interface RegionDeps {
  store: Store;
  now: () => Date;
  id: (prefix: string) => string;
}

let sequence = 0;
const defaultDeps: RegionDeps = {
  store,
  now: () => new Date(),
  id: (prefix: string) =>
    `${prefix}-${Date.now().toString(36)}${(++sequence).toString(36)}`,
};

export async function redefineRegion(
  actor: ActorContext,
  input: RedefineRegionInput,
  deps: RegionDeps = defaultDeps,
): Promise<RegionResult> {
  if (actor.membership.role !== "admin") {
    return {
      ok: false,
      error: "Only an administrator can redefine a region.",
      code: "forbidden",
    };
  }

  const market = await repositories.markets.find(actor, input.marketId);
  if (!market) {
    return { ok: false, error: "Market not found.", code: "not_found" };
  }

  const effectiveFrom = new Date(input.effectiveFrom);
  if (Number.isNaN(effectiveFrom.getTime())) {
    return { ok: false, error: "That is not a date.", code: "invalid" };
  }

  const counties = normaliseCounties(input.counties);
  if (counties.length === 0) {
    return {
      ok: false,
      error: "A region needs at least one county.",
      code: "invalid",
    };
  }

  const history = regionHistory(
    await repositories.regionDefinitions.forMarket(actor, input.marketId),
    input.marketId,
  );

  const blocked = redefineBlockReason(
    history,
    input.marketId,
    effectiveFrom.toISOString(),
  );
  if (blocked) return { ok: false, error: blocked, code: "invalid" };

  const state = input.state.trim().toUpperCase();
  const current = history[0];
  if (current && sameBoundary(current, { state, counties })) {
    // A definition identical to the one in force is not a redesignation, it is
    // a form submitted twice. Recording it would put a second row in the
    // history that changes nothing and makes the market look as though its
    // boundary moved on a date it did not.
    return {
      ok: false,
      error: "That is the boundary already in force. Nothing to record.",
      code: "duplicate",
    };
  }

  const at = deps.now();
  const definition: RegionDefinition = {
    id: deps.id("region"),
    marketId: market.id,
    state,
    counties,
    effectiveFrom: effectiveFrom.toISOString(),
    source: input.source.trim(),
    recordedByUserId: actor.user.id,
    recordedOn: at.toISOString(),
  };

  await deps.store.transaction((uow) => {
    uow.createRegionDefinition(definition);
    uow.appendAuditEvent({
      marketId: market.id,
      at: definition.recordedOn,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "region",
      entityId: definition.id,
      // The boundary it replaces, named. "Why did this market's retention rate
      // change in 2027" is a question somebody will ask, and the answer has to
      // be readable from the log rather than reconstructed.
      from: current ? current.counties.join(", ") : null,
      to: counties.join(", "),
      reason: definition.source,
      viaOverride: false,
    });
  });

  logger.info("region.redefined", {
    marketId: market.id,
    definitionId: definition.id,
    effectiveFrom: definition.effectiveFrom,
  });

  return { ok: true, created: definition };
}
