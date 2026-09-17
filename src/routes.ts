/**
 * Every path this application answers on, in one place.
 *
 * The site has two halves that are addressed to different people, and the
 * split is what this module exists to hold:
 *
 *  - **The venture pages** (`/`, `/approach`, `/partners`, `/evidence`,
 *    `/contact`) are the public front door. They are indexed, they describe
 *    real work, and every figure on them is true.
 *  - **The prototype** lives entirely under `/demo`. It runs on invented
 *    organizations, it is `noindex`, and it carries a banner saying so.
 *
 * They used to be the same page. `/` opened with the program's pitch and a
 * row of statistics computed from seeded fixtures, under a black bar
 * explaining that every figure above it was fictional — which asks a reader
 * to hold two contradictory frames at once, and gives a funder no page to
 * land on. Moving the prototype under one prefix is what lets the
 * demonstration labelling stay loud without it being the first thing anybody
 * reads.
 *
 * Paths are derived from `DEMO_ROOT` rather than spelled out, because they
 * are referenced from email templates, redirect targets, cache revalidation,
 * theming, and the portal switcher — five places that must not disagree
 * about where a portal lives.
 */

import type { ActorRole } from "@/domain/types";

/** The prefix everything belonging to the prototype sits behind. */
export const DEMO_ROOT = "/demo";

/** A path inside the prototype. `demoPath("/student")` → `/demo/student`. */
export function demoPath(path: string): string {
  return `${DEMO_ROOT}${path}`;
}

/** Where each role's own portal lives. */
/**
 * Where a signed-out person is sent under real sign-on.
 *
 * At the site root, deliberately, and it used to be `demoPath("/sign-in")` on
 * the reasoning that it belongs beside the portals it gates. That was wrong in
 * the way that only shows up when somebody arrives at it: `isDemoSurface` was
 * true for it, so the one screen a real person meets before they have an
 * account wore a banner reading "every organization, student and figure shown
 * is fictional" above a nav bar offering one-click entry to all five portals.
 *
 * A login page is not part of the demonstration. It is the door to the
 * product, its URL gets sent to people in writing, and neither the banner nor
 * the switcher belongs anywhere near it.
 */
export const SIGN_IN_PATH = "/sign-in";

/**
 * The sign-on screen, which gets neither chrome.
 *
 * Not the venture header — somebody signing in is not browsing the pitch, and
 * a nav bar is an invitation to wander off mid-task. Not the demo chrome
 * either, for the reason above. `Shell` checks this before either.
 */
export function isSignOnSurface(pathname: string): boolean {
  return pathname === SIGN_IN_PATH || pathname.startsWith(`${SIGN_IN_PATH}/`);
}

export const PORTAL_PATH: Record<ActorRole, string> = {
  admin: demoPath("/admin"),
  student: demoPath("/student"),
  business: demoPath("/business"),
  college: demoPath("/college"),
  board: demoPath("/board"),
};

/** A posting's own page. */
export function opportunityPath(postingId: string): string {
  return demoPath(`/opportunities/${postingId}`);
}

/**
 * True for anything under the prototype.
 *
 * The exact-match arm matters: `/demo` itself is the prototype's own index,
 * and a `startsWith("/demo/")` check alone would render the venture's header
 * over it.
 */
export function isDemoSurface(pathname: string): boolean {
  return pathname === DEMO_ROOT || pathname.startsWith(`${DEMO_ROOT}/`);
}

/**
 * The venture pages, in the order they appear in the header.
 *
 * Home is deliberately absent: the mark is the link home, and a nav that
 * repeats it spends its first slot saying nothing.
 */
export const SITE_NAV: { href: string; label: string }[] = [
  { href: "/approach", label: "Approach" },
  { href: "/partners", label: "For partners" },
  { href: "/evidence", label: "Evidence" },
  { href: "/contact", label: "Contact" },
];
