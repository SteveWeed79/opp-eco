import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { getActor } from "@/auth/session";

export const metadata: Metadata = {
  // "Demo" leads the title and description because these are what a link
  // preview shows when the URL is pasted into Slack or forwarded by email —
  // often the only context a second-hand recipient ever gets.
  title: "[Demo] Opportunity Ecosystem — Kansas Workforce Initiative",
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
  return (
    <html lang="en">
      <body>
        <Shell signedInAs={actor?.user.name}>{children}</Shell>
      </body>
    </html>
  );
}
