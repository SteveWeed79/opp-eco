/**
 * Self-registration — the door the product has never had.
 *
 * The user story opens Phase 1 with "students self-activate once their market
 * is live", and nothing implemented it. `StudentStatus` carries `registered`,
 * `profile_complete` and `pending_verification`, and no screen could put a
 * learner into any of the three: every account existed because the seed made
 * it, or because an administrator added one through the access panel. That left
 * the college holding a verification queue nothing could fill.
 *
 * Four rules decide who gets in, and each one is doing real work:
 *
 *  - **The market has to be live.** The story's sequence is deliberate — a
 *    board commits, then a college, then the market opens. Registering into a
 *    market with no board and no funding produces a learner who can apply for
 *    nothing.
 *  - **The address has to belong to the college.** `addressMatchesOrganization`
 *    already enforces this for work accounts, and it is the whole of the
 *    anti-abuse story here: you cannot register as a Verdigris learner without
 *    a Verdigris address. No CAPTCHA, no approval queue before the queue, and
 *    nothing this programme's scale does not warrant.
 *  - **The demonstration is not registrable.** Its markets are live and
 *    flagged, so they would otherwise appear in the list — and a real person's
 *    name and address written into rows marked `is_demo_data` is precisely the
 *    boundary this codebase spent its life drawing. It would also be deleted by
 *    the next `db:seed`.
 *  - **Registering is not verifying.** A new learner lands in `registered`, and
 *    the college decides. That is the queue this exists to fill, not one to
 *    bypass.
 *
 * What registration deliberately does **not** do is issue a credential. Every
 * account here gets its password the same way — request a code, choose one —
 * and inventing a second path for new learners would be a second way to become
 * somebody, which is the kind of thing that only gets audited after it is
 * abused.
 */

import type { Market, Organization } from "./types";

export const MAX_NAME_LENGTH = 120;

/**
 * A college somebody may register with: its market is live and real.
 *
 * Returned as ids and names rather than organizations, because this list is
 * rendered on a page anyone can load and an `Organization` carries a contact
 * address, a vetting status and an identity mode that a stranger has no
 * business reading.
 */
export interface RegistrableCollege {
  id: string;
  name: string;
  marketName: string;
}

/** Whether this market can take registrations at all. */
export function marketAcceptsRegistrations(market: Pick<Market, "stage" | "isDemoData">): boolean {
  // Demonstration markets are excluded here rather than at the call site, so a
  // second caller cannot forget. See the note at the top of this file.
  return market.stage === "live" && !market.isDemoData;
}

/**
 * Why this registration cannot proceed, or null.
 *
 * Takes the college and the market rather than looking them up, so the rules
 * stay testable without a repository and the service stays responsible for
 * scoping.
 */
export function registrationBlockReason(input: {
  name: string;
  college: Pick<Organization, "kind" | "emailDomains" | "name"> | null;
  market: Pick<Market, "stage" | "isDemoData"> | null;
  addressMatchesCollege: boolean;
}): string | null {
  const name = input.name.trim();
  if (!name) return "Enter your name.";
  if (name.length > MAX_NAME_LENGTH) {
    return `Keep your name under ${MAX_NAME_LENGTH} characters.`;
  }

  if (!input.college || input.college.kind !== "college") {
    return "Choose the college you attend.";
  }
  if (!input.market || !marketAcceptsRegistrations(input.market)) {
    // Deliberately the same sentence for "no such market", "not live yet" and
    // "that is the demonstration". A stranger picking ids out of a form should
    // not be able to map which markets exist and what stage each is at.
    return "That college is not open for registration yet.";
  }

  if (!input.addressMatchesCollege) {
    const domains = input.college.emailDomains.join(", ");
    return domains
      ? `Use your ${input.college.name} address — ${domains}. That is how we know you are their learner.`
      : `Use your ${input.college.name} address.`;
  }
  return null;
}
