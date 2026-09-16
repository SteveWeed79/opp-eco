/**
 * Consent — attached to the record's source institution, never to the platform.
 *
 * Once a college hands this platform a roster, a verification or a credit
 * award, those are education records under FERPA. Directory information may be
 * disclosed without consent, but only where the institution has designated it,
 * given public notice and offered an opt-out — and each college's designation
 * differs, so nothing here may assume a field is directory information because
 * another school treats it that way. Everything else needs written consent.
 *
 * The design conclusion that survives every local variation: **consent is a
 * property of the record's source institution.** A college's consent does not
 * authorise a high school's records about the same person, and a dual-credit
 * placement can generate both. So a consent names the institution it covers,
 * and a second institution in a learner's story means a second consent rather
 * than a wider reading of the first.
 *
 * What this file deliberately does *not* do is work out whose signature was
 * required. FERPA rights transfer to the learner at 18 or on postsecondary
 * enrolment at any age, so a dual-enrolled sixteen-year-old consents for
 * themselves on the college's records and their parent still holds the high
 * school's. Deciding that needs the school a learner attends, which the model
 * does not have — and it needs a registrar and a district's counsel, who will
 * have a settled local answer. The platform records which was obtained.
 */

import type {
  ConsentGrantor,
  ConsentRecord,
  ConsentScope,
  ConsentStatus,
} from "./types";

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

export const CONSENT_SCOPES: {
  value: ConsentScope;
  label: string;
  /** Who the disclosure is *to*, which is what a learner is actually agreeing to. */
  meta: string;
  description: string;
}[] = [
  {
    value: "education_record",
    label: "Share education records with employers",
    meta: "Disclosure to a host employer",
    description:
      "Lets this institution pass enrolment, verification and placement records to an employer considering or hosting the learner. Without it an employer sees an abbreviated name and no way to contact them.",
  },
  {
    value: "workforce_data",
    label: "Share participant details with the workforce board",
    meta: "Disclosure to a government agency",
    description:
      "Lets the board make an eligibility determination for a funded placement. Separate from the employer consent because a learner can reasonably agree to one and refuse the other.",
  },
  {
    value: "program_participation",
    label: "Take part in the programme",
    meta: "The learner's own agreement",
    description:
      "The baseline agreement to participate at all. Recorded separately so withdrawing from the programme and refusing one disclosure are different events.",
  },
];

const SCOPE_LABELS = new Map(CONSENT_SCOPES.map((s) => [s.value, s.label]));

export function consentScopeLabel(scope: ConsentScope): string {
  return SCOPE_LABELS.get(scope) ?? scope;
}

export const CONSENT_GRANTORS: { value: ConsentGrantor; label: string; meta: string }[] = [
  {
    value: "learner",
    label: "The learner",
    meta: "18+, or enrolled at the college at any age",
  },
  {
    value: "parent_guardian",
    label: "A parent or guardian",
    meta: "Under 18, for records the school holds",
  },
];

// ---------------------------------------------------------------------------
// Whether a disclosure is permitted
// ---------------------------------------------------------------------------

/**
 * Whether this consent is in force on the given date.
 *
 * Expiry is evaluated rather than stored as a status, because a row that lapses
 * on a date nobody sweeps would otherwise read as granted forever. A background
 * job flipping `expired` is an optimisation; correctness cannot wait for it.
 */
export function isInForce(consent: ConsentRecord, now: Date): boolean {
  if (consent.status !== "granted") return false;
  if (!consent.expiresOn) return true;
  return new Date(consent.expiresOn).getTime() > now.getTime();
}

/** Whether a learner has consent in force for this scope, from this institution. */
export function hasConsent(
  consents: ConsentRecord[],
  query: { studentId: string; sourceOrgId: string; scope: ConsentScope },
  now: Date,
): boolean {
  return consents.some(
    (c) =>
      c.studentId === query.studentId &&
      c.sourceOrgId === query.sourceOrgId &&
      c.scope === query.scope &&
      isInForce(c, now),
  );
}

/**
 * Why an employer may not be given this learner's contact details, or null.
 *
 * Two conditions, and both must hold. The placement has to have reached a stage
 * where the employer needs to reach the learner directly — that rule predates
 * this file and lives in `disclosureFor` — **and** the crediting institution
 * must have education-record consent on file.
 *
 * Note what is deliberately *not* gated: the abbreviated name and the match
 * score an employer sees while deciding. Whether that much is directory
 * information is a per-institution designation this platform cannot make on a
 * college's behalf, and gating a hiring decision on a form would stop the
 * programme working. The line is drawn where the disclosure actually widens.
 */
export function disclosureBlockReason(
  consents: ConsentRecord[],
  query: { studentId: string; sourceOrgId: string },
  now: Date,
): string | null {
  if (hasConsent(consents, { ...query, scope: "education_record" }, now)) return null;
  return "No education-record consent is on file for this learner, so their contact details are withheld.";
}

// ---------------------------------------------------------------------------
// Recording one
// ---------------------------------------------------------------------------

/**
 * Who may record a consent: the institution whose records it covers, or an
 * administrator.
 *
 * Ownership rather than role, the same rule funding follows. A college cannot
 * record consent on behalf of a high school it does not operate, and an
 * employer has no business asserting that a learner agreed to anything.
 */
export function canRecordConsent(
  actorOrganizationId: string | null,
  isAdmin: boolean,
  sourceOrgId: string,
): boolean {
  return isAdmin || actorOrganizationId === sourceOrgId;
}

/** Why this consent cannot be recorded as described, or null. */
export function recordBlockReason(input: {
  scope: ConsentScope;
  grantedBy: ConsentGrantor;
  expiresOn: string | null;
  now: Date;
}): string | null {
  if (input.expiresOn) {
    const at = new Date(input.expiresOn);
    if (Number.isNaN(at.getTime())) return "That is not a date.";
    if (at.getTime() <= input.now.getTime()) {
      // A consent that has already lapsed authorises nothing, so recording one
      // is a data-entry slip rather than a decision anyone made.
      return "A consent cannot expire in the past.";
    }
  }
  return null;
}

/** Newest first, with the id as the final tie-break so both layers agree. */
export function byConsentOrder(a: ConsentRecord, b: ConsentRecord): number {
  return b.grantedOn.localeCompare(a.grantedOn) || a.id.localeCompare(b.id);
}

/** The statuses a consent can be moved to, and what each means. */
export const CONSENT_STATUSES: { value: ConsentStatus; label: string }[] = [
  { value: "granted", label: "In force" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "expired", label: "Lapsed" },
];
