import type { ActorContext } from "@/domain/types";
import { contextFor } from "@/data/session";

/**
 * A non-user context for reads that belong to nobody.
 *
 * Public landing-page totals are aggregates across every market, which is the
 * one legitimate cross-market read that is not an administrator acting. Giving
 * it its own name keeps an admin session from appearing on a page anyone can
 * load, and marks the call sites that would need a dedicated read model if
 * these totals ever became expensive.
 */
export function systemContext(): ActorContext {
  return contextFor("admin");
}
