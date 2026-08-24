import type { NextConfig } from "next";
import { DEMO_ROOT } from "./src/routes";

/**
 * Paths the prototype used to answer on.
 *
 * Every portal moved under `/demo` when the venture pages took over the root.
 * Those old addresses are in forwarded emails, in browser history, and in
 * whatever anyone pasted into a chat while walking somebody through the demo
 * — so they have to keep arriving somewhere rather than turning into a 404
 * that reads as "the site is broken".
 *
 * Permanent, because they are not coming back: `/student` is now free for a
 * venture page if one is ever wanted there, and a 308 is what stops a client
 * asking again.
 *
 * **These are for links that left the building, not for links inside it.** A
 * redirect is a round trip and, under this app's `upgrade-insecure-requests`
 * policy, a prefetch that hits one fails outright. Anything rendered by this
 * application must point at the real path — which is why every href comes
 * from `PORTAL_PATH` rather than being written out at the call site.
 */
const MOVED = [
  "student",
  "business",
  "college",
  "board",
  "admin",
  "design",
  "opportunities",
];

const nextConfig: NextConfig = {
  async redirects() {
    return MOVED.flatMap((segment) => [
      {
        source: `/${segment}`,
        destination: `${DEMO_ROOT}/${segment}`,
        permanent: true,
      },
      {
        source: `/${segment}/:path*`,
        destination: `${DEMO_ROOT}/${segment}/:path*`,
        permanent: true,
      },
    ]);
  },
};

export default nextConfig;
