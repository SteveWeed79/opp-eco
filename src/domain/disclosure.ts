/**
 * Field-level PII disclosure.
 *
 * A candidate's contact details are not an employer's to see while they are
 * still deciding. The rule belongs to the record, not to the screen rendering
 * it — masking a name in JSX while the full row travels to the client is not
 * a privacy control, it is a costume.
 *
 * The stages are deliberately coarse. What matters is that a business sees
 * enough to make a decision and nothing more until the placement is real.
 */

import type { Application, ApplicationStatus, Student } from "./types";

export type DisclosureLevel = "summary" | "full";

/**
 * Statuses at which a business has a working relationship with the student and
 * needs to reach them directly. Everything earlier is a hiring decision, which
 * does not require an address or a phone number.
 */
const FULL_DISCLOSURE_STATUSES: ApplicationStatus[] = [
  "funding_authorized",
  "unsubsidized",
  "placement_active",
  "placement_completed",
  "credit_pending",
  "credit_granted",
  "credit_denied",
  "terminated_early",
  "closed",
];

export function disclosureFor(application: Application): DisclosureLevel {
  return FULL_DISCLOSURE_STATUSES.includes(application.status) ? "full" : "summary";
}

/** "Omar Haddad" → "Omar H." Copes with single-word and multi-part names. */
export function abbreviateName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]}.` : first;
}

/**
 * A student record reduced to what the given level permits. Redacted fields
 * are emptied rather than left present-but-hidden, so nothing withheld on
 * screen is still sitting in the payload.
 */
export function redactStudent(student: Student, level: DisclosureLevel): Student {
  if (level === "full") return student;
  return {
    ...student,
    name: abbreviateName(student.name),
    email: "",
    expectedGraduation: "",
  };
}
