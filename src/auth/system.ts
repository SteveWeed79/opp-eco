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
  // `systemWide` because this context is not a viewer. Every other
  // administrator reads one world at a time — the demonstration or real
  // programmes — so that a console cannot sum invented money into a real
  // total. This one resolves an address to a sign-in method before anybody is
  // authenticated, and dispatches queued notifications; both must work for a
  // real college and a fictional one alike, and neither renders a figure.
  //
  // Without it this became `contextFor("admin")` viewing the demonstration,
  // and a real workforce board's address quietly stopped resolving to the
  // one-time code its officers sign in with.
  return { ...contextFor("admin"), systemWide: true };
}
