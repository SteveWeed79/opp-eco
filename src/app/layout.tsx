import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { getActor } from "@/auth/session";
import { demoSignOnEnabled } from "@/auth/config";
import { siteTitle } from "@/brand";
import { resolvePartnerTheme } from "@/theme/resolve";
import { backend } from "@/data/backend";

export const metadata: Metadata = {
  title: siteTitle(),
  description:
    "Connective infrastructure between education, employers, workforce partners, funding, and learners across rural Kansas — so career-connected opportunities are easier to see and to reach.",
  // Deliberately *not* noindex, and deliberately not set here at all beyond
  // the default. The prototype's own segment layout turns indexing off for
  // everything under `/demo`; the venture pages are meant to be findable, and
  // a blanket rule at the root is what previously made the whole site
  // invisible to anyone who did not already have the address.
};

/**
 * Rendered per request rather than prerendered, so the demo clock re-anchors
 * and the board's upcoming interview slots never drift into the past.
 */
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const actor = await getActor();
  // Resolved here rather than in the shell because it reads the repositories.
  // The shell decides whether to *apply* it, since only it knows the route.
  const theme = await resolvePartnerTheme(actor);
  // Whether this deployment can be changed at all. Said in the masthead rather
  // than discovered by clicking something and being refused.
  const { readOnly } = backend();
  // Which door this deployment opens. Read here rather than in the shell,
  // which is a client component and must not be trusted to work out whether
  // the role picker is allowed.
  const demoSignOn = demoSignOnEnabled();

  return (
    <html lang="en">
      <body>
        {/* The role, not just the name: the switcher has to know which portals
            this session can actually reach. */}
        <Shell
          signedInAs={actor?.user.name}
          signedInRole={actor?.membership.role}
          theme={theme}
          readOnly={readOnly}
          demoSignOn={demoSignOn}
        >
          {children}
        </Shell>
      </body>
    </html>
  );
}
