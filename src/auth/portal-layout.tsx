import type { ActorRole } from "@/domain/types";
import { actorForPortal } from "./session";

/**
 * A portal's gate, placed where a refusal can still be an HTTP refusal.
 *
 * Each portal has a `loading.tsx`, so Next wraps its page in a Suspense
 * boundary and starts streaming the skeleton before the page component runs.
 * A `redirect()` from inside that boundary arrives too late to be a 307: the
 * status is already 200 and the shell already sent, so Next appends a
 * client-side navigation instead. Interactively that looks fine — the browser
 * moves to the sign-in page — but the response an anonymous caller receives is
 * a successful one containing the portal's chrome, which is not the answer the
 * application means to give.
 *
 * A segment's layout renders *above* that segment's loading boundary. Calling
 * the same gate here refuses before a byte is committed.
 *
 * A factory rather than five copies of the same component, because five copies
 * is five chances for one of them to drift. Each portal's `layout.tsx` is then
 * two lines, which is short enough to read as what it is.
 */
export function portalLayout(portal: ActorRole) {
  return async function PortalLayout({
    children,
  }: Readonly<{ children: React.ReactNode }>) {
    await actorForPortal(portal);
    return children;
  };
}
