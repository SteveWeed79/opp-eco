import type { Metadata } from "next";
import { pageTitle } from "@/brand";
import { getActor } from "@/auth/session";
import { showsDemonstrationData } from "@/lib/demonstration";

/**
 * The prototype's segment.
 *
 * Two things keep a forwarded link honest, and they are set once here rather
 * than per page — but they are not the same kind of thing, which is why one is
 * conditional and the other is not:
 *
 *  - **`[Demo]` leads the title, when the rows are the demonstration's.** A
 *    link preview is often the only context a second-hand recipient ever gets.
 *    `/demo` is where the portals live, not a statement about what is in them,
 *    so a coordinator working a real placement gets neither the marker nor a
 *    description calling her learners invented. Resolved from the data, the
 *    same way the banner is.
 *  - **Nothing under here is indexed, ever.** Unconditional, and it stays that
 *    way once real programmes run here: a signed-in portal is not something a
 *    search result should reach either. The venture pages above it are indexed,
 *    which is the point of the split.
 *
 * Setting these on a segment layout rather than at the root means a new page
 * added under `/demo` inherits them without remembering to.
 */
export async function generateMetadata(): Promise<Metadata> {
  const demonstration = await showsDemonstrationData(await getActor());
  return {
    title: pageTitle(undefined, { demonstration }),
    description: demonstration
      ? "Demonstration prototype using fictional organizations. Illustrates a proposed program connecting Kansas students, employers, colleges, and workforce boards around paid internships that earn academic credit."
      : "Connecting Kansas students, employers, colleges, and workforce boards around paid internships that earn academic credit.",
    robots: { index: false, follow: false },
  };
}

export default function DemoLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
