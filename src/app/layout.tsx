import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { getActor } from "@/auth/session";
import { pageTitle } from "@/brand";
import { resolvePartnerTheme } from "@/theme/resolve";
import { backend } from "@/data/backend";

export const metadata: Metadata = {
  // "Demo" leads the title and description because these are what a link
  // preview shows when the URL is pasted into Slack or forwarded by email —
  // often the only context a second-hand recipient ever gets.
  title: pageTitle(),
  description:
    "Demonstration prototype using fictional organizations. Illustrates a proposed program connecting Kansas students, employers, colleges, and workforce boards around paid internships that earn academic credit.",
  // This is a demo built on fictional organizations. Keeping it out of search
  // results avoids anyone finding it and taking it for a live program.
  robots: { index: false, follow: false },
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
        >
          {children}
        </Shell>
      </body>
    </html>
  );
}
