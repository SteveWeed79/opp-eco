/**
 * The product's name, in one place.
 *
 * The name is not settled. "Opportunity Ecosystem" is the working title and
 * may be replaced — so the cost of replacing it should be one edit to this
 * file, not a sweep through markup, metadata, seeded records, and email
 * templates.
 *
 * **The reason this is a module and not a find-and-replace waiting to happen:**
 * "opportunity" is also a domain noun in this product. An employer *posts an
 * opportunity*; a student *sees other opportunities*; the pipeline table has an
 * *Opportunity* column. Those are the vocabulary of the thing, not the brand,
 * and a rename must leave every one of them alone. Keeping the brand behind a
 * named import is what makes the two distinguishable to a person doing the
 * rename in a hurry.
 *
 * A test in `brand.test.ts` fails if the name is spelled literally anywhere in
 * `src/` outside this file, so it cannot quietly re-scatter.
 */

export const brand = {
  /** Full name, as it appears in prose and titles. */
  name: "Opportunity Ecosystem",

  /**
   * The header renders the name in two tones. Kept as parts rather than split
   * at the call site, because a one-word name would break a `split(" ")` and
   * the next name might be one word.
   */
  lead: "Opportunity",
  accent: "Ecosystem",

  /** The square mark in the header. One or two characters. */
  monogram: "OE",

  /**
   * Bare domain, used to build addresses. `.example` is reserved by RFC 2606
   * so nothing addressed here can be delivered — deliberate for a demo whose
   * organizations are invented.
   */
  domain: "opportunityecosystem.example",

  /** What the platform operator's own organization is called in-product. */
  operatorName: "Opportunity Ecosystem",

  /**
   * Programme framing shown in metadata. Deliberately separate from the name:
   * this one is a claim about who the platform serves, and it changes on
   * different grounds than the brand does.
   */
  programme: "Kansas Workforce Initiative",
} as const;

/** The two-tone header name, as one string, for titles and email subjects. */
export function brandName(): string {
  return brand.name;
}

/** An address at the product's own domain. */
export function brandAddress(mailbox: string): string {
  return `${mailbox}@${brand.domain}`;
}

/**
 * The default From header.
 *
 * Overridden by `EMAIL_FROM` in any deployment that actually sends, because
 * this domain cannot receive mail and Resend requires a verified sender.
 */
export function defaultEmailFrom(): string {
  return `${brand.name} <onboarding@resend.dev>`;
}

/** Page title. `[Demo]` leads so a forwarded link preview says so first. */
export function pageTitle(page?: string): string {
  return page
    ? `[Demo] ${page} — ${brand.name}`
    : `[Demo] ${brand.name} — ${brand.programme}`;
}
