import type { Metadata } from "next";
import { pageTitle } from "@/brand";

/**
 * The prototype's segment.
 *
 * Everything under `/demo` runs on invented organizations, so the two things
 * that keep a forwarded link honest are set once here rather than per page:
 *
 *  - **`[Demo]` leads the title**, because a link preview is often the only
 *    context a second-hand recipient ever gets.
 *  - **Nothing under here is indexed.** The venture pages above it are, which
 *    is the point of the split — a search result should reach the
 *    organization, never a mockup of a program that does not exist yet.
 *
 * Setting `robots` on a segment layout rather than at the root means a new
 * page added under `/demo` inherits both without remembering to.
 */
export const metadata: Metadata = {
  title: pageTitle(),
  description:
    "Demonstration prototype using fictional organizations. Illustrates a proposed program connecting Kansas students, employers, colleges, and workforce boards around paid internships that earn academic credit.",
  robots: { index: false, follow: false },
};

export default function DemoLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
