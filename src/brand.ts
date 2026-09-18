/**
 * The product's name, in one place.
 *
 * The name has already changed once — "Opportunity Ecosystem" was the working
 * title and the programme is now CCLN — and it may change again, so the cost
 * of replacing it stays one edit to this file rather than a sweep through
 * markup, metadata, seeded records, and email templates.
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
  name: "Career Connected Learning Network",

  /**
   * The header renders the name in two tones. Kept as parts rather than split
   * at the call site, because a one-word name would break a `split(" ")` and
   * the next name might be one word.
   */
  lead: "Career Connected",
  accent: "Learning Network",

  /**
   * The square mark in the header.
   *
   * Four characters here where partner monograms are two, because the
   * programme is known by its initialism rather than by a shortening of its
   * words — nobody calls it "CC". The mark sizes its own text, so a two-letter
   * partner monogram and a four-letter platform one both fit the same box.
   */
  monogram: "CCLN",

  /**
   * Bare domain, used to build addresses **inside the prototype**. `.example`
   * is reserved by RFC 2606 so nothing addressed here can be delivered —
   * deliberate for a demo whose organizations are invented.
   */
  domain: "ccln.example",

  /**
   * The name this venture was launched under, and the domain it still
   * answers on.
   *
   * Not history for its own sake. The programme renamed to the initialism
   * while the domain stayed where it was, so the address people are given —
   * on an application form, in an email signature, from a business card —
   * resolves to a site calling itself something else. A reader who cannot
   * tell whether they have arrived at the right organization leaves.
   *
   * `brand.test.ts` treats "Opportunity Ecosystem" as a former name and
   * fails if it is spelled anywhere in `src/` outside this file. That check
   * is still right: the point was never that the old name is forbidden, it
   * is that it lives in one place. Render it from here.
   */
  formerly: "Opportunity Ecosystem",

  /** The domain the venture actually publishes on. Real, and deliverable. */
  publicDomain: "opportunityecosystem.org",

  /**
   * The mailbox on the public site.
   *
   * **This has to exist before the contact page ships.** The venture had no
   * company address at all — a funder who wanted to reply had a personal
   * inbox and nothing else — which is the gap this closes. Point it at a
   * different address if the shared mailbox is not set up yet; a published
   * address that bounces is worse than the one it replaced.
   */
  contactMailbox: "contact",

  /**
   * Where mail actually arrives, while `contact@` on the public domain does
   * not exist. Overrides the composed address; clear it when it does.
   */
  contactAddress: "steve@swbuild.dev" as string | null,

  /** Who to ask for. */
  founderName: "Melissa Weed",

  /** Where the venture is based. */
  headquarters: "Pittsburg, Kansas",

  /** What the platform operator's own organization is called in-product. */
  operatorName: "Career Connected Learning Network",

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

/**
 * Title for a page inside the prototype. `[Demo]` leads so a forwarded link
 * preview says so first.
 *
 * Conditional for the same reason the banner is: the marker is a claim about
 * the **rows** on the page, and `/demo` is the address of the portals rather
 * than a statement about what is in them. A coordinator working a real
 * placement should not have `[Demo]` in her browser tab, and every link she
 * forwards carries that tab's title.
 *
 * Defaults to marking, so a caller that has not worked out which rows it is
 * showing says the cautious thing. A missing disclaimer and a false one are
 * both failures; this is the one that fails toward the reader.
 */
export function pageTitle(
  page?: string,
  { demonstration = true }: { demonstration?: boolean } = {},
): string {
  const mark = demonstration ? "[Demo] " : "";
  return page
    ? `${mark}${page} — ${brand.name}`
    : `${mark}${brand.name} — ${brand.programme}`;
}

/**
 * Title for a venture page.
 *
 * Deliberately not `pageTitle`. These pages describe real work at a real
 * address, and leading them with `[Demo]` would be a false disclaimer —
 * which is the same failure as a missing one, pointed the other way. The
 * marker belongs to `/demo` and only there.
 */
export function siteTitle(page?: string): string {
  return page ? `${page} — ${brand.name}` : `${brand.name}`;
}

/** An address at the venture's public domain. */
export function publicAddress(mailbox: string): string {
  return `${mailbox}@${brand.publicDomain}`;
}

/** The address the site publishes, which is not always on the public domain. */
export function contactEmail(): string {
  return brand.contactAddress ?? publicAddress(brand.contactMailbox);
}
