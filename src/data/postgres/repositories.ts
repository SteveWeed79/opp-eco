/**
 * The repository contracts, in SQL.
 *
 * Same interfaces as `memory.ts`, same scoping, same redaction — the layer
 * above must not be able to tell which one it is talking to. Three rules hold
 * that line:
 *
 * 1. **Scoping is composed, never hand-written.** Every query interpolates a
 *    fragment from `scoping.ts`. A `WHERE` clause assembled at the call site
 *    is how one accessor ends up wider than its neighbours, which is exactly
 *    the bug the in-memory layer's `visibleApplications` exists to prevent.
 *
 * 2. **Redaction happens after mapping, in the domain's own functions.** The
 *    employer's narrowed view of a student is `redactStudent`, the board's
 *    view of a timesheet is `redactTimeEntry` — the same calls the in-memory
 *    layer makes. Reimplementing either as a column list would put the
 *    disclosure rules in two places and let them drift.
 *
 * 3. **Three entities need a join to be whole.** A student's name lives on
 *    `users`, a market's colleges in `market_colleges`, a credit award's
 *    applications in `credit_award_applications`. Those joins live in the
 *    `SELECT` constants below so no accessor can forget one and return a
 *    half-built object.
 */

import type {
  ActorContext,
  Application,
  MentorshipOffer,
  Organization,
  Posting,
  Student,
  TimeEntry,
} from "@/domain/types";
import { disclosureFor, redactStudent, redactTimeEntry } from "@/domain/disclosure";
import { byWeekDescending } from "@/domain/timesheet";
import type { Repositories } from "../repositories";
import { joinSql, sql, type Sql, type SqlClient } from "./client";
import {
  applicationScope,
  marketScope,
  postingOwnershipScope,
  studentScope,
} from "./scoping";
import {
  toApplication,
  toAuditEvent,
  toCreditAward,
  toInterviewSlot,
  toMarket,
  toMentorshipOffer,
  toOrganization,
  toPosting,
  toStudent,
  toTimeEntry,
  toUser,
  type Row,
} from "./rows";

// ---------------------------------------------------------------------------
// Base selections
// ---------------------------------------------------------------------------

/**
 * A market carries the colleges operating it, which are a join table.
 *
 * Written without table aliases on purpose. The scoping fragments in
 * `scoping.ts` qualify their columns with the real table name
 * (`markets.market_id`), and `FROM markets m` would shadow that name and make
 * every one of those fragments a syntax error. Spelling the table out costs a
 * few characters and keeps one definition of each scoping rule.
 */
const MARKET_SELECT = `
  SELECT markets.*, COALESCE(
    (SELECT array_agg(mc.college_id ORDER BY mc.college_id)
       FROM market_colleges mc WHERE mc.market_id = markets.id),
    '{}'::text[]
  ) AS college_ids
  FROM markets`;

/**
 * Students join users for their name and email — `students` has neither
 * column, because identity belongs to the person and not to their enrolment.
 */
const STUDENT_SELECT = `
  SELECT students.*, users.name AS name, users.email AS email
  FROM students
  JOIN users ON users.id = students.user_id`;

/**
 * An application's credit award is reachable only through the join table, and
 * `credit.ts` reads it to decide which completed work is still unclaimed.
 */
const APPLICATION_SELECT = `
  SELECT applications.*, (
    SELECT ca.credit_award_id FROM credit_award_applications ca
     WHERE ca.application_id = applications.id LIMIT 1
  ) AS credit_award_id
  FROM applications`;

const CREDIT_SELECT = `
  SELECT credit_awards.*, COALESCE(
    (SELECT array_agg(ca.application_id ORDER BY ca.application_id)
       FROM credit_award_applications ca WHERE ca.credit_award_id = credit_awards.id),
    '{}'::text[]
  ) AS application_ids
  FROM credit_awards`;

// ---------------------------------------------------------------------------

export function postgresRepositories(db: SqlClient): Repositories {
  /** Run a composed statement and map every row. */
  async function all<T>(statement: Sql, map: (row: Row) => T): Promise<T[]> {
    const rows = await db.query<Row>(statement.text, statement.params);
    return rows.map(map);
  }

  async function one<T>(statement: Sql, map: (row: Row) => T): Promise<T | null> {
    const rows = await all(statement, map);
    return rows[0] ?? null;
  }

  /**
   * Every time entry this actor may see, already narrowed to what their role
   * needs. One definition shared by all four accessors, for the same reason
   * the in-memory layer has one: narrowing in `awaitingReview` but not in
   * `find` is how an employer reads a competitor's timesheet by guessing an id.
   */
  function timeEntryScope(actor: ActorContext): Sql {
    const parts: Sql[] = [marketScope(actor, "time_entries")];
    const { role, organizationId } = actor.membership;

    if (role === "business") {
      parts.push(sql`time_entries.business_id = ${organizationId}`);
    }
    if (role === "student") {
      // The signed-in student's own weeks, not the market's. A student has no
      // business reading a classmate's.
      parts.push(
        sql`time_entries.student_id IN (
          SELECT id FROM students WHERE user_id = ${actor.user.id}
        )`,
      );
    }
    return joinSql(parts, " AND ");
  }

  /** The board validates hours against a cap; it never reads the work summary. */
  function narrowTimeEntry(actor: ActorContext, entry: TimeEntry): TimeEntry {
    return actor.membership.role === "board" ? redactTimeEntry(entry) : entry;
  }

  async function timeEntriesWhere(
    actor: ActorContext,
    extra: Sql,
  ): Promise<TimeEntry[]> {
    const where = joinSql([timeEntryScope(actor), extra], " AND ");
    const rows = await all(
      sql`SELECT * FROM time_entries WHERE ${where}`,
      toTimeEntry,
    );
    return rows.map((entry) => narrowTimeEntry(actor, entry));
  }

  return {
    markets: {
      list: (actor) =>
        all(
          sql`${rawText(MARKET_SELECT)} WHERE ${marketScope(actor, "markets")}`,
          toMarket,
        ),
      find: (actor, id) =>
        one(
          sql`${rawText(MARKET_SELECT)}
              WHERE ${marketScope(actor, "markets")} AND markets.id = ${id}`,
          toMarket,
        ),
    },

    organizations: {
      list: (actor, filter) => {
        const parts = [marketScope(actor, "organizations")];
        if (filter?.kind) parts.push(sql`organizations.kind = ${filter.kind}`);
        return all(
          sql`SELECT * FROM organizations WHERE ${joinSql(parts, " AND ")}
              ORDER BY name`,
          toOrganization,
        );
      },
      find: (actor, id) =>
        one(
          sql`SELECT * FROM organizations
              WHERE ${marketScope(actor, "organizations")} AND organizations.id = ${id}`,
          toOrganization,
        ),
      pendingVetting: (actor) =>
        all(
          sql`SELECT * FROM organizations
              WHERE ${marketScope(actor, "organizations")}
                AND organizations.status IN ('applied', 'under_review', 'info_requested')
              ORDER BY applied_on`,
          toOrganization,
        ),
    },

    students: {
      list: (actor) =>
        all(
          sql`${rawText(STUDENT_SELECT)} WHERE ${studentScope(actor)}`,
          toStudent,
        ),
      find: (actor, id) =>
        one(
          sql`${rawText(STUDENT_SELECT)}
              WHERE ${studentScope(actor)} AND students.id = ${id}`,
          toStudent,
        ),
      pendingVerification: (actor) =>
        all(
          sql`${rawText(STUDENT_SELECT)}
              WHERE ${studentScope(actor)}
                AND students.status IN ('pending_verification', 'profile_complete')`,
          toStudent,
        ),
      forUser: (actor, userId) =>
        one(
          sql`${rawText(STUDENT_SELECT)}
              WHERE ${studentScope(actor)} AND students.user_id = ${userId}`,
          toStudent,
        ),
      forApplication: async (actor, application) => {
        const student = await one<Student>(
          sql`${rawText(STUDENT_SELECT)}
              WHERE ${studentScope(actor)} AND students.id = ${application.studentId}`,
          toStudent,
        );
        if (!student) return null;
        // Only a business is held at arm's length. The college owns the student
        // relationship and the board needs identity to determine eligibility.
        if (actor.membership.role !== "business") return student;
        return redactStudent(student, disclosureFor(application));
      },
    },

    postings: {
      list: (actor, filter) => {
        const parts = [marketScope(actor, "postings"), postingOwnershipScope(actor)];
        if (filter?.status) parts.push(sql`postings.status = ${filter.status}`);
        return all(
          sql`SELECT * FROM postings WHERE ${joinSql(parts, " AND ")}`,
          toPosting,
        );
      },
      find: (actor, id) =>
        one(
          sql`SELECT * FROM postings
              WHERE ${marketScope(actor, "postings")}
                AND ${postingOwnershipScope(actor)}
                AND postings.id = ${id}`,
          toPosting,
        ),
      published: (actor) =>
        // The market's shopfront: every role in the market may browse it,
        // including a business looking at a competitor's. Deliberately not
        // ownership-scoped.
        all(
          sql`SELECT * FROM postings
              WHERE ${marketScope(actor, "postings")} AND postings.status = 'published'`,
          toPosting,
        ),
      awaitingCollegeHelp: (actor) =>
        all(
          sql`SELECT * FROM postings
              WHERE ${marketScope(actor, "postings")}
                AND postings.status IN ('help_requested', 'college_drafting')`,
          toPosting,
        ),
    },

    mentorshipOffers: {
      list: (actor) => {
        const parts = [marketScope(actor, "mentorship_offers")];
        if (actor.membership.role === "business") {
          parts.push(
            sql`mentorship_offers.business_id = ${actor.membership.organizationId}`,
          );
        }
        return all(
          sql`SELECT * FROM mentorship_offers WHERE ${joinSql(parts, " AND ")}`,
          toMentorshipOffer,
        );
      },
      find: (actor, id) => {
        const parts = [marketScope(actor, "mentorship_offers")];
        if (actor.membership.role === "business") {
          parts.push(
            sql`mentorship_offers.business_id = ${actor.membership.organizationId}`,
          );
        }
        parts.push(sql`mentorship_offers.id = ${id}`);
        return one(
          sql`SELECT * FROM mentorship_offers WHERE ${joinSql(parts, " AND ")}`,
          toMentorshipOffer,
        );
      },
      openInMarket: (actor) =>
        // Like `postings.published`, the market's shopfront rather than an
        // employer's own records. A paused offer is absent by definition: an
        // employer who paused and still appeared would field introductions
        // they said they could not take.
        all(
          sql`SELECT * FROM mentorship_offers
              WHERE ${marketScope(actor, "mentorship_offers")}
                AND mentorship_offers.status = 'open'`,
          toMentorshipOffer,
        ),
    },

    applications: {
      list: (actor) =>
        all(
          sql`${rawText(APPLICATION_SELECT)} WHERE ${applicationScope(actor)}`,
          toApplication,
        ),
      find: (actor, id) =>
        one(
          sql`${rawText(APPLICATION_SELECT)}
              WHERE ${applicationScope(actor)} AND applications.id = ${id}`,
          toApplication,
        ),
      forStudent: (actor, studentId) =>
        all(
          sql`${rawText(APPLICATION_SELECT)}
              WHERE ${applicationScope(actor)} AND applications.student_id = ${studentId}`,
          toApplication,
        ),
      forPosting: (actor, postingId) =>
        all(
          sql`${rawText(APPLICATION_SELECT)}
              WHERE ${applicationScope(actor)} AND applications.posting_id = ${postingId}`,
          toApplication,
        ),
    },

    interviewSlots: {
      list: (actor) =>
        all(
          sql`SELECT * FROM interview_slots
              WHERE ${marketScope(actor, "interview_slots")}
              ORDER BY starts_at`,
          toInterviewSlot,
        ),
      open: (actor) =>
        all(
          sql`SELECT * FROM interview_slots
              WHERE ${marketScope(actor, "interview_slots")}
                AND interview_slots.booked_by IS NULL
              ORDER BY starts_at`,
          toInterviewSlot,
        ),
    },

    timeEntries: {
      find: async (actor, id) => {
        const rows = await timeEntriesWhere(actor, sql`time_entries.id = ${id}`);
        return rows[0] ?? null;
      },
      forApplication: async (actor, applicationId) =>
        (
          await timeEntriesWhere(
            actor,
            sql`time_entries.application_id = ${applicationId}`,
          )
        ).sort(byWeekDescending),
      forStudent: async (actor, studentId) =>
        (await timeEntriesWhere(actor, sql`time_entries.student_id = ${studentId}`)).sort(
          byWeekDescending,
        ),
      awaitingReview: async (actor) =>
        // Oldest first: this is a queue someone works through, and the week a
        // student has been waiting longest on is the one to clear.
        (await timeEntriesWhere(actor, sql`time_entries.status = 'submitted'`)).sort(
          (a, b) => a.weekStarting.localeCompare(b.weekStarting),
        ),
    },

    creditAwards: {
      list: (actor) =>
        all(
          sql`${rawText(CREDIT_SELECT)} WHERE ${marketScope(actor, "credit_awards")}`,
          toCreditAward,
        ),
      forStudent: (actor, studentId) =>
        all(
          sql`${rawText(CREDIT_SELECT)}
              WHERE ${marketScope(actor, "credit_awards")}
                AND credit_awards.student_id = ${studentId}`,
          toCreditAward,
        ),
    },

    auditEvents: {
      list: (actor, filter) => {
        const parts = [marketScope(actor, "audit_events")];
        if (filter?.entityId) {
          parts.push(sql`audit_events.entity_id = ${filter.entityId}`);
        }
        return all(
          sql`SELECT * FROM audit_events WHERE ${joinSql(parts, " AND ")}
              ORDER BY occurred_at DESC, id DESC`,
          toAuditEvent,
        );
      },
    },

    users: {
      // Deliberately unscoped, matching the in-memory contract: this resolves
      // the name behind an audit entry or a notification recipient, both of
      // which cross market boundaries by design.
      find: (id) => one(sql`SELECT * FROM users WHERE id = ${id}`, toUser),
    },
  };
}

/**
 * Splice a statement fragment written in this file into a composed query.
 *
 * The `SELECT` constants above are literals, never caller input — the guard is
 * there so this cannot quietly become a way to interpolate a value.
 */
function rawText(text: string): Sql {
  if (/\$\d/.test(text)) {
    throw new Error("Refusing to splice a fragment that carries placeholders");
  }
  return { text, params: [] };
}

/** Kept for the type checker: these are the shapes the mappers produce. */
export type { Application, MentorshipOffer, Organization, Posting, Student };
