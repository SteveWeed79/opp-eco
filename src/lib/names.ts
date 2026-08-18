/**
 * Name lookups for ids a page already holds.
 *
 * Pages render `organizationName(posting.businessId)` inside JSX, a dozen
 * times per screen. Those used to read the seed arrays directly, which worked
 * only because the fixtures were the data. Against a real database that would
 * be a lie the moment the two diverge, and turning each call into an `await`
 * is not possible inside a `.map`.
 *
 * So the page resolves the lookup once, before it renders, and calls it
 * synchronously afterwards. One market-scoped query for the organizations, one
 * for the markets, and the markup does not change.
 */

import type { ActorContext, Organization } from "@/domain/types";
import { repositories } from "@/data/backend";

/** What a page holds after awaiting `nameLookups`. */
export interface NameLookups {
  /** An organization's name, or an em dash when there is no id to resolve. */
  organizationName: (id: string | null | undefined) => string;
  /** A market's name, for the admin console's cross-market tables. */
  marketName: (id: string) => string;
  /** Every organization of one kind in a market, for pickers. */
  organizationsOfKind: (marketId: string, kind: Organization["kind"]) => Organization[];
}

export async function nameLookups(actor: ActorContext): Promise<NameLookups> {
  const [organizations, markets] = await Promise.all([
    repositories.organizations.list(actor),
    repositories.markets.list(actor),
  ]);

  const organizationById = new Map(organizations.map((o) => [o.id, o]));
  const marketById = new Map(markets.map((m) => [m.id, m]));

  return {
    // An em dash rather than an empty string: a blank cell reads as a
    // rendering fault, and several of these ids are legitimately absent — a
    // market with no board yet, for one.
    organizationName: (id) => (id ? (organizationById.get(id)?.name ?? "—") : "—"),
    marketName: (id) => marketById.get(id)?.name ?? "—",
    organizationsOfKind: (marketId, kind) =>
      organizations.filter((o) => o.marketId === marketId && o.kind === kind),
  };
}
