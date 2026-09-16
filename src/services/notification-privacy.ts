/**
 * What may leave the building in an email.
 *
 * Every other privacy control in this codebase decides what a *signed-in*
 * caller may read. This one is different in kind: a notification leaves the
 * system entirely, over a channel nobody here controls, and lands in an inbox
 * that will be forwarded, searched, backed up and eventually breached by
 * somebody else.
 *
 * TEGL 39-11 — the DOL guidance that reaches anyone handling participant PII in
 * a WIOA-funded program — says never to email unencrypted sensitive PII to
 * anyone, explicitly including ETA itself and its contractors. The $20/hour
 * reimbursement is almost certainly WIOA Title I work-experience funding, so
 * this is the least negotiable rule in `docs/security-and-data.md`.
 *
 * The templates were rewritten to name a record rather than a person. This is
 * the backstop for that: a payload key carrying participant PII is stripped at
 * the moment the message is queued, so a template added next year that reaches
 * for `studentName` renders without one rather than mailing it out. Belt and
 * braces, because the failure is silent and the blast radius is a federal
 * incident with a one-hour reporting clock.
 */

import type { NotificationIntent } from "@/data/store";

/**
 * Payload keys that identify a participant, stripped before a message is
 * queued.
 *
 * Deliberately a denylist, which is the opposite of the rule uploads follow —
 * and the reason is the failure mode. An unknown *file* type is dangerous, so
 * uploads allowlist. An unknown *payload* key is usually a harmless number, and
 * an allowlist here would silently blank new fields until somebody noticed the
 * message read oddly. The cost of being wrong in each direction points the
 * other way.
 *
 * Names of people acting in a professional capacity are absent on purpose. A
 * board officer's name on an interview slot, a mentor's name, an employer
 * contact — those are role-functional identities the data rules explicitly
 * keep, and a student booking a call should know who they are meeting.
 */
export const PARTICIPANT_PII_KEYS: readonly string[] = [
  "studentName",
  "studentEmail",
  "learnerName",
  "learnerEmail",
  "programOfStudy",
  "classStanding",
  "expectedGraduation",
  "dateOfBirth",
  "phone",
  "address",
];

const DENIED = new Set(PARTICIPANT_PII_KEYS);

/**
 * The same intent with any participant-identifying payload key removed.
 *
 * Returns the original object when there is nothing to strip, so the common
 * case allocates nothing and a reader can see that the guard is not rewriting
 * messages it has no business rewriting.
 */
export function withoutParticipantPII(intent: NotificationIntent): NotificationIntent {
  const offending = Object.keys(intent.payload).filter((key) => DENIED.has(key));
  if (offending.length === 0) return intent;

  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(intent.payload)) {
    if (!DENIED.has(key)) payload[key] = value;
  }
  return { ...intent, payload };
}

/**
 * Which keys in a payload would be stripped. For tests and for the outbox
 * screen, which says plainly what was withheld rather than quietly dropping it.
 */
export function participantPIIIn(payload: Record<string, unknown>): string[] {
  return Object.keys(payload).filter((key) => DENIED.has(key));
}
