/**
 * The write path for hours.
 *
 * Two operations, and the split between them is the whole design: a student
 * *claims* a week, and the employer supervising the placement *validates* it.
 * Self-reported hours that nobody countersigns are not a record a workforce
 * board can reimburse against, so the two halves are separate actions by
 * separate roles and neither can perform the other's.
 *
 * Every write recomputes the application's cached totals inside the same
 * transaction that touches the entry. That is the invariant the transition
 * guards and the credit calculation rest on — they take an `Application` and
 * no repository, so if the cache is wrong they are wrong, silently. One writer
 * and one transaction is what keeps it honest.
 */

import type {
  ActorContext,
  Application,
  Posting,
  TimeEntry,
} from "@/domain/types";
import {
  MAX_HOURS_PER_WEEK,
  claimedWeeks,
  timesheetTotals,
  weekStartingFor,
} from "@/domain/timesheet";
import { repositories } from "@/data/backend";
import { store } from "@/data/backend";
import type { Store, UnitOfWork } from "@/data/store";

export type TimesheetResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: string;
      code: "forbidden" | "not_found" | "duplicate" | "invalid" | "conflict";
    };

export interface TimesheetDeps {
  store: Store;
  now: () => Date;
  id: (prefix: string) => string;
}

let sequence = 0;
const defaultDeps: TimesheetDeps = {
  store,
  now: () => new Date(),
  id: (prefix) => `${prefix}-${Date.now().toString(36)}${(++sequence).toString(36)}`,
};

export interface LogHoursInput {
  applicationId: string;
  /** Monday of the week worked. Normalised and re-derived server-side. */
  weekStarting: string;
  hours: number;
  summary: string;
}

/**
 * A student logs a week against an active placement.
 *
 * Everything except the hours, the week, and the note is derived here.
 * `studentId` in particular is read from the signed-in user's own record and
 * never from the request — a caller supplying their own student id supplies
 * their own timesheet.
 */
export async function logHours(
  actor: ActorContext,
  input: LogHoursInput,
  deps: TimesheetDeps = defaultDeps,
): Promise<TimesheetResult<TimeEntry>> {
  if (actor.membership.role !== "student") {
    return { ok: false, error: "Only students log hours.", code: "forbidden" };
  }

  const student = await repositories.students.forUser(actor, actor.user.id);
  if (!student) {
    return { ok: false, error: "No student record for this account.", code: "not_found" };
  }

  const application = await repositories.applications.find(actor, input.applicationId);
  if (!application || application.studentId !== student.id) {
    return { ok: false, error: "No such placement.", code: "not_found" };
  }
  // Track before status, deliberately. A micro-internship is bought as a
  // deliverable for a fixed fee — billing it by the hour would misstate the
  // agreement in both directions — and that is true of it in every state.
  // Checking status first told a student looking at a micro project that it
  // was "not active", which is both unhelpful and, once it becomes active,
  // wrong.
  if (application.track !== "standard") {
    return {
      ok: false,
      error: "Micro-internships are paid on the deliverable, not by the hour.",
      code: "forbidden",
    };
  }
  if (application.status !== "placement_active") {
    return {
      ok: false,
      error: "Hours can only be logged against an active placement.",
      code: "forbidden",
    };
  }

  const posting = await repositories.postings.find(actor, application.postingId);
  if (!posting) {
    return { ok: false, error: "No such placement.", code: "not_found" };
  }

  const hours = Number(input.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    return { ok: false, error: "Enter the hours you worked.", code: "invalid" };
  }
  if (hours > MAX_HOURS_PER_WEEK) {
    return {
      ok: false,
      error: `A single week cannot exceed ${MAX_HOURS_PER_WEEK} hours. Check the figure and split it across weeks if it is right.`,
      code: "invalid",
    };
  }

  // Normalised rather than trusted: a client sending mid-week dates would
  // create weeks that overlap and cannot be reconciled against each other.
  const weekStarting = weekStartingFor(new Date(input.weekStarting));
  if (weekStarting === "Invalid Date" || Number.isNaN(Date.parse(weekStarting))) {
    return { ok: false, error: "That is not a valid week.", code: "invalid" };
  }

  const now = deps.now();
  if (Date.parse(weekStarting) > now.getTime()) {
    return { ok: false, error: "That week has not happened yet.", code: "invalid" };
  }

  const existing = await repositories.timeEntries.forApplication(actor, application.id);
  if (claimedWeeks(existing).has(weekStarting)) {
    return {
      ok: false,
      error: "You have already logged that week. Edit the existing entry instead.",
      code: "duplicate",
    };
  }

  const summary = input.summary.trim();
  if (summary.length === 0) {
    return {
      ok: false,
      error: "Describe what you worked on — your supervisor approves against it.",
      code: "invalid",
    };
  }

  const at = now.toISOString();
  const entry: TimeEntry = {
    id: deps.id("te"),
    marketId: application.marketId,
    applicationId: application.id,
    studentId: student.id,
    businessId: posting.businessId,
    weekStarting,
    hours,
    summary,
    status: "submitted",
    submittedOn: at,
    version: 1,
  };

  try {
    await deps.store.transaction((uow) => {
      uow.createTimeEntry(entry);
      recacheTotals(uow, application, [...existing, entry]);
      uow.appendAuditEvent({
        marketId: entry.marketId,
        at,
        actorUserId: actor.user.id,
        actorRole: actor.membership.role,
        entityType: "time_entry",
        entityId: entry.id,
        from: null,
        to: "submitted",
        viaOverride: false,
      });
      uow.enqueueNotification({
        marketId: entry.marketId,
        recipientUserId: `contact:${posting.businessId}`,
        recipientOrganizationId: posting.businessId,
        kind: "hours.submitted",
        payload: {
          studentName: student.name,
          postingTitle: posting.title,
          hours,
          weekStarting,
        },
      });
    });
  } catch (error) {
    return conflictOrThrow(error);
  }

  return { ok: true, value: entry };
}

export interface ReviewHoursInput {
  entryId: string;
  decision: "approve" | "reject";
  /** Required on rejection: a week sent back without a reason cannot be fixed. */
  note?: string;
}

/**
 * The supervisor signs off, or sends a week back.
 *
 * Only the employer that owns the posting may do this. Not the college, which
 * awards credit for the work but was not there; not the board, which pays for
 * it but was not there either. The party that can attest to attendance is the
 * one that supervised it, and that is the entire evidentiary basis for
 * reimbursing public money against these rows.
 */
export async function reviewHours(
  actor: ActorContext,
  input: ReviewHoursInput,
  deps: TimesheetDeps = defaultDeps,
): Promise<TimesheetResult<TimeEntry>> {
  if (actor.membership.role !== "business") {
    return {
      ok: false,
      error: "Only the supervising employer approves hours.",
      code: "forbidden",
    };
  }

  const entry = await repositories.timeEntries.find(actor, input.entryId);
  if (!entry) {
    return { ok: false, error: "No such timesheet entry.", code: "not_found" };
  }
  // Belt and braces: the repository already scopes to the actor's own
  // organization, and this re-asserts it at the point of write rather than
  // trusting a read path to stay narrow.
  if (entry.businessId !== actor.membership.organizationId) {
    return { ok: false, error: "That placement is not yours.", code: "forbidden" };
  }
  if (entry.status !== "submitted") {
    return {
      ok: false,
      error: "That week has already been reviewed.",
      code: "conflict",
    };
  }

  const note = input.note?.trim() ?? "";
  if (input.decision === "reject" && note.length === 0) {
    return {
      ok: false,
      error: "Say what needs correcting — a week sent back without a reason cannot be fixed.",
      code: "invalid",
    };
  }

  const application = await repositories.applications.find(actor, entry.applicationId);
  if (!application) {
    return { ok: false, error: "No such placement.", code: "not_found" };
  }

  // Read off the record rather than derived from the student id. Deriving it
  // is what produced `u-stu-omar` once already — see `userIdForStudent`.
  const student = await repositories.students.forApplication(actor, application);
  if (!student) {
    return { ok: false, error: "No student on that placement.", code: "not_found" };
  }

  const at = deps.now().toISOString();
  const status = input.decision === "approve" ? "approved" : "rejected";
  const reviewed: TimeEntry = {
    ...entry,
    status,
    reviewedOn: at,
    reviewedByUserId: actor.user.id,
    reviewNote: note.length > 0 ? note : undefined,
  };

  const siblings = (
    await repositories.timeEntries.forApplication(actor, entry.applicationId)
  ).map((row) => (row.id === reviewed.id ? reviewed : row));

  try {
    await deps.store.transaction((uow) => {
      uow.saveTimeEntry(reviewed, entry.version);
      recacheTotals(uow, application, siblings);
      uow.appendAuditEvent({
        marketId: entry.marketId,
        at,
        actorUserId: actor.user.id,
        actorRole: actor.membership.role,
        entityType: "time_entry",
        entityId: entry.id,
        from: entry.status,
        to: status,
        reason: note.length > 0 ? note : undefined,
        viaOverride: false,
      });
      uow.enqueueNotification({
        marketId: entry.marketId,
        recipientUserId: student.userId,
        kind: status === "approved" ? "hours.approved" : "hours.rejected",
        payload: {
          hours: entry.hours,
          weekStarting: entry.weekStarting,
          note,
        },
      });
    });
  } catch (error) {
    return conflictOrThrow(error);
  }

  return { ok: true, value: reviewed };
}

/**
 * Rewrite the application's cached hour totals from the entries.
 *
 * Called inside the same transaction as every entry write, which is what stops
 * the cache and the rows disagreeing. The application's `version` is checked
 * as usual: a supervisor approving hours while an admin moves the same
 * placement is a genuine conflict and the loser must reload.
 */
function recacheTotals(
  uow: UnitOfWork,
  application: Application,
  entries: TimeEntry[],
): void {
  const totals = timesheetTotals(entries);
  uow.saveApplication(
    {
      ...application,
      hoursLogged: totals.logged,
      hoursApproved: totals.approved,
    },
    application.version,
  );
}

/**
 * A version clash is an expected outcome to be shown to the person, not a
 * crash. Anything else is a real fault and must keep its stack.
 */
function conflictOrThrow(error: unknown): TimesheetResult<never> {
  if (error instanceof Error && error.name === "ConcurrencyError") {
    return { ok: false, error: error.message, code: "conflict" };
  }
  throw error;
}

/**
 * Weeks awaiting review, per application, in one pass.
 *
 * Every portal that renders transition buttons needs this to build a
 * `TransitionContext`, and doing it per application would be a query per row.
 * Scoping falls out of the repository: an employer gets their own placements,
 * a student their own weeks, the college and board their market.
 */
export async function unreviewedWeeksByApplication(
  actor: ActorContext,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const entry of await repositories.timeEntries.awaitingReview(actor)) {
    counts.set(entry.applicationId, (counts.get(entry.applicationId) ?? 0) + 1);
  }
  return counts;
}

/** Weeks awaiting the employer's sign-off, joined to what they are against. */
export interface ReviewQueueItem {
  entry: TimeEntry;
  application: Application;
  posting: Posting;
  studentName: string;
}

export async function reviewQueue(
  actor: ActorContext,
): Promise<ReviewQueueItem[]> {
  const items: ReviewQueueItem[] = [];

  for (const entry of await repositories.timeEntries.awaitingReview(actor)) {
    const application = await repositories.applications.find(actor, entry.applicationId);
    if (!application) continue;
    const posting = await repositories.postings.find(actor, application.postingId);
    if (!posting) continue;
    // Through `forApplication`, so an employer sees the name at the disclosure
    // level this placement's stage permits rather than the raw record.
    const student = await repositories.students.forApplication(actor, application);

    items.push({
      entry,
      application,
      posting,
      studentName: student?.name ?? "Student",
    });
  }

  return items;
}
