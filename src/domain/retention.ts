/**
 * Retention — a schedule, not an accident.
 *
 * The Kansas Student Data Privacy Act requires deleting a student's personal
 * information when it is no longer required for the purpose it was collected,
 * and with dual-credit high schoolers in scope that binds directly rather than
 * as a courtesy. The practical form of that requirement is a schedule decided
 * *before* there is real data, because **a record with no deletion date is a
 * record kept forever by default.**
 *
 * Two design commitments follow, and both are arguable — which is why they are
 * written down here rather than implied by whatever a purge script happens to
 * do.
 *
 * **Purging anonymises rather than deletes.** The rows stay; the identifiers
 * go. A programme has accountability obligations that outlive any individual's
 * privacy interest — how many placements ran, how much subsidy was drawn, what
 * share of learners stayed in the region — and those aggregates should be
 * derivable without touching individual records. Deleting a learner would
 * silently restate every historical figure a board was reported.
 *
 * **The clock starts at last participation, not at creation.** A learner who
 * finished a placement last month and one who finished three years ago are the
 * same record age and completely different retention questions.
 */

import type { Application, Student } from "./types";
import { isTerminal } from "./workflow";

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

export type RetainedRecord =
  | "learner_identity"
  | "application"
  | "uploaded_file"
  | "audit_event";

export interface RetentionRule {
  record: RetainedRecord;
  label: string;
  /** Days after the anchor, after which the personal part must go. */
  days: number;
  /** What the clock starts from, in words. */
  anchor: string;
  rationale: string;
}

/**
 * The schedule, in the order a reviewer would ask about it.
 *
 * The figures are a starting position rather than a legal conclusion. They are
 * deliberately concrete anyway: a schedule expressed as "to be determined" is
 * the same as no schedule, and the useful thing to hand a district's counsel is
 * a number to argue with.
 */
export const RETENTION_SCHEDULE: RetentionRule[] = [
  {
    record: "uploaded_file",
    label: "Uploaded files",
    days: 365,
    anchor: "the placement ending",
    rationale:
      "The shortest of all. A résumé or a deliverable is the least valuable thing to keep and the most annoying thing to leak, and nothing downstream reads one after the work is examined.",
  },
  {
    record: "learner_identity",
    label: "Learner identity",
    days: 365 * 3,
    anchor: "the learner's last participation",
    rationale:
      "Long enough to answer a follow-up about employment a year or two after exit, which is the measure the programme reports on, and no longer. The placement record survives the purge; the name does not.",
  },
  {
    record: "application",
    label: "Applications and placements",
    days: 365 * 5,
    anchor: "the application reaching a terminal status",
    rationale:
      "Program reporting runs on these, and a workforce board's own accountability window is measured in years. The PII is purged with the learner's identity at three; what stays is the shape of the placement.",
  },
  {
    record: "audit_event",
    label: "Audit log",
    days: 365 * 7,
    anchor: "the entry being written",
    rationale:
      "The longest, and the uncomfortable one: the log exists to record who did what, which makes it personal data about staff as well as evidence about the programme. Kept for the accountability obligation that justifies it and not past that.",
  },
];

const BY_RECORD = new Map(RETENTION_SCHEDULE.map((rule) => [rule.record, rule]));

export function retentionRule(record: RetainedRecord): RetentionRule {
  const rule = BY_RECORD.get(record);
  if (!rule) throw new Error(`No retention rule for ${record}`);
  return rule;
}

// ---------------------------------------------------------------------------
// When a learner's identity is due to go
// ---------------------------------------------------------------------------

export interface RetentionStatus {
  /** When the learner last did anything the programme cares about. */
  lastActivity: string;
  dueOn: string;
  /** Negative once overdue. */
  daysRemaining: number;
  due: boolean;
  alreadyPurged: boolean;
}

/**
 * The most recent date a learner was actually participating.
 *
 * Falls back to the verification date, and then to the earliest application,
 * so a learner who never got anywhere still has a clock. A learner with no
 * activity at all returns null and is deliberately *not* due — a record the
 * platform cannot date is one to investigate rather than silently anonymise.
 */
export function lastActivityFor(
  student: Student,
  applications: Application[],
): string | null {
  const mine = applications.filter((a) => a.studentId === student.id);
  const dates = [
    ...mine.map((a) => a.statusSince),
    ...mine.map((a) => a.submittedOn),
    student.verifiedOn ?? "",
  ].filter((d) => d.length > 0);

  if (dates.length === 0) return null;
  return dates.reduce((latest, d) => (d > latest ? d : latest));
}

export function retentionStatusFor(
  student: Student,
  applications: Application[],
  now: Date,
): RetentionStatus | null {
  const lastActivity = lastActivityFor(student, applications);
  if (!lastActivity) return null;

  const rule = retentionRule("learner_identity");
  const due = new Date(new Date(lastActivity).getTime() + rule.days * 86_400_000);
  const daysRemaining = Math.floor((due.getTime() - now.getTime()) / 86_400_000);

  return {
    lastActivity,
    dueOn: due.toISOString(),
    daysRemaining,
    due: daysRemaining <= 0,
    alreadyPurged: student.purgedOn !== null,
  };
}

/**
 * Whether a learner is still taking part, in which case nothing is purged
 * whatever the clock says.
 *
 * The rule is "no longer required for the purpose collected", and a live
 * application is that purpose. A schedule that anonymised an active learner
 * because their last *status change* was a while ago would break the programme
 * to satisfy a date.
 */
export function stillParticipating(applications: Application[]): boolean {
  return applications.some((a) => !isTerminal(a.status));
}

/** Why this learner cannot be purged, or null. */
export function purgeBlockReason(
  student: Student,
  applications: Application[],
  now: Date,
): string | null {
  if (student.purgedOn) return "This learner's identity has already been purged.";

  const mine = applications.filter((a) => a.studentId === student.id);
  if (stillParticipating(mine)) {
    return "This learner is still taking part. Retention runs from their last participation.";
  }

  const status = retentionStatusFor(student, applications, now);
  if (!status) {
    return "Nothing dates this record, so it cannot be scheduled. Check it by hand.";
  }
  if (!status.due) {
    return `Not due until ${new Date(status.dueOn).toLocaleDateString("en-US")}.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// What purging actually does
// ---------------------------------------------------------------------------

/** What a purged record shows in place of a name. */
export const PURGED_NAME = "Former participant";

/**
 * The learner with every direct identifier removed and the programme data
 * intact.
 *
 * `programOfStudy` and `collegeId` survive, and that is a judgement rather than
 * an oversight: they are what aggregate reporting is *by*, and dropping them
 * would make the historical figures unreconstructible. They are also
 * quasi-identifiers — in a market the size of Beloit, one programme in one year
 * may be one person — so this is anonymisation for the purpose of not holding
 * contact details, and it is not a claim of k-anonymity. Stating the limit
 * rather than implying a guarantee nothing here provides.
 */
export function purgeStudent(student: Student, at: Date): Student {
  return {
    ...student,
    name: PURGED_NAME,
    email: "",
    skills: [],
    interests: [],
    expectedGraduation: "",
    classStanding: "",
    purgedOn: at.toISOString(),
  };
}
