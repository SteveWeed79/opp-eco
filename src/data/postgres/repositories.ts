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
  HostOffer,
  MentorshipOffer,
  Organization,
  Outcome,
  Posting,
  Student,
  TimeEntry,
} from "@/domain/types";
import {
  disclosureFor,
  redactHostOffer,
  redactOutcome,
  redactStudent,
  redactTimeEntry,
} from "@/domain/disclosure";
import { byWeekAscending, byWeekDescending } from "@/domain/timesheet";
import type { Repositories } from "../repositories";
import { joinSql, sql, type Sql, type SqlClient } from "./client";
import {
  applicationScope,
  consentScope,
  escalationScope,
  fundingCommitmentScope,
  marketScope,
  hostOfferScope,
  regionDefinitionScope,
  outcomeScope,
  mentorshipPairingScope,
  ownMarketScope,
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
  toConsentRecord,
  toEscalation,
  toFundingCommitment,
  toFundingSource,
  toHostOffer,
  toRegionDefinition,
  toMentorshipPairing,
  toOutcome,
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
    (SELECT array_agg(mc.college_id ORDER BY mc.college_id COLLATE "C")
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
    (SELECT array_agg(ca.application_id ORDER BY ca.application_id COLLATE "C")
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

  /**
   * Every id tie-break below is `COLLATE "C"`.
   *
   * A surrogate key has no linguistic meaning, and ordering one by the
   * database's own collation makes the result depend on how that database was
   * created: `en_US.UTF-8` ignores punctuation and sorts `te-app-20-1` before
   * `te-app-2-1`, `C.UTF-8` does the opposite. The rows were identical either
   * way — only their order moved — which is exactly the kind of difference that
   * shows up as a list reshuffling between one deployment and the next. Human
   * names keep the database's collation, because there the locale is the point.
   */
  /** Newest introduction first, which is the order both surfaces read them in. */
  function pairingsWhere(actor: ActorContext, extra: Sql): Sql {
    const where = joinSql([mentorshipPairingScope(actor), extra], " AND ");
    return sql`SELECT * FROM mentorship_pairings WHERE ${where}
               ORDER BY mentorship_pairings.introduced_on DESC,
                        mentorship_pairings.id COLLATE "C"`;
  }

  /**
   * Newest observation first, then the id, matching `byObservedDescending` on
   * the other layer — the parity test compares these row by row, so an order
   * that differs only by chance fails it for no reason.
   *
   * The board's narrowing happens here rather than in the WHERE clause: it may
   * read its market's outcomes and may not read the free text, which is a
   * projection rather than a filter. Same shape as `narrowTimeEntry`.
   */
  /**
   * Purpose order, then newest fund first — matching `byFundOrder` on the other
   * layer. Postgres sorts an enum in declaration order, and `fund_purpose` is
   * declared in the same order the domain lists it, which is what makes the two
   * agree without a CASE expression here.
   */
  function consentsWhere(actor: ActorContext, extra: Sql): Sql {
    const where = joinSql([consentScope(actor), extra], " AND ");
    return sql`SELECT * FROM consents WHERE ${where}
               ORDER BY consents.granted_on DESC, consents.id COLLATE "C"`;
  }

  /**
   * Worst kind first, then oldest first within a kind, then the id.
   *
   * Oldest first is the opposite of every other list here and matches
   * `byEscalationOrder`: elsewhere the newest row is the interesting one, and
   * here the oldest unanswered problem is the one that has waited longest.
   * `escalation_kind` is declared worst-first in the migration, so Postgres
   * sorts it correctly with no CASE expression.
   */
  function escalationsWhere(actor: ActorContext, extra: Sql): Sql {
    const where = joinSql([escalationScope(actor), extra], " AND ");
    return sql`SELECT * FROM escalations WHERE ${where}
               ORDER BY escalations.kind, escalations.raised_on,
                        escalations.id COLLATE "C"`;
  }

  function fundsWhere(actor: ActorContext, extra: Sql): Sql {
    const where = joinSql([marketScope(actor, "funding_sources"), extra], " AND ");
    return sql`SELECT * FROM funding_sources WHERE ${where}
               ORDER BY funding_sources.purpose,
                        funding_sources.opened_on DESC,
                        funding_sources.id COLLATE "C"`;
  }

  function commitmentsWhere(actor: ActorContext, extra: Sql): Sql {
    const where = joinSql([fundingCommitmentScope(actor), extra], " AND ");
    return sql`SELECT * FROM funding_commitments WHERE ${where}
               ORDER BY funding_commitments.authorized_on DESC,
                        funding_commitments.id COLLATE "C"`;
  }

  async function outcomesWhere(actor: ActorContext, extra: Sql): Promise<Outcome[]> {
    const where = joinSql([outcomeScope(actor), extra], " AND ");
    const rows = await all(
      sql`SELECT * FROM outcomes WHERE ${where}
          ORDER BY outcomes.observed_on DESC, outcomes.recorded_on DESC,
                   outcomes.id COLLATE "C"`,
      toOutcome,
    );
    return actor.membership.role === "board" ? rows.map(redactOutcome) : rows;
  }

  async function hostOffersWhere(actor: ActorContext, extra: Sql): Promise<HostOffer[]> {
    const where = joinSql([hostOfferScope(actor), extra], " AND ");
    const rows = await all(
      sql`SELECT * FROM host_offers WHERE ${where}
          ORDER BY host_offers.recorded_on DESC, host_offers.id COLLATE "C"`,
      toHostOffer,
    );
    // Everybody but the administrator and the employer who wrote it. See
    // `visibleHostOffers` for why the college is on the wrong side of that line
    // despite working the same cases.
    const { role } = actor.membership;
    return role === "admin" || role === "business" ? rows : rows.map(redactHostOffer);
  }

  function regionsWhere(actor: ActorContext, extra: Sql) {
    const where = joinSql([regionDefinitionScope(actor), extra], " AND ");
    return all(
      sql`SELECT * FROM region_definitions WHERE ${where}
          ORDER BY region_definitions.effective_from DESC,
                   region_definitions.id COLLATE "C" DESC`,
      toRegionDefinition,
    );
  }

  async function timeEntriesWhere(
    actor: ActorContext,
    extra: Sql,
  ): Promise<TimeEntry[]> {
    const where = joinSql([timeEntryScope(actor), extra], " AND ");
    const rows = await all(
      sql`SELECT * FROM time_entries WHERE ${where}
          ORDER BY time_entries.week_starting DESC, time_entries.id COLLATE "C"`,
      toTimeEntry,
    );
    return rows.map((entry) => narrowTimeEntry(actor, entry));
  }

  return {
    markets: {
      list: (actor) =>
        all(
          sql`${rawText(MARKET_SELECT)} WHERE ${ownMarketScope(actor)}
              ORDER BY markets.name`,
          toMarket,
        ),
      find: (actor, id) =>
        one(
          sql`${rawText(MARKET_SELECT)}
              WHERE ${ownMarketScope(actor)} AND markets.id = ${id}`,
          toMarket,
        ),
    },

    organizations: {
      list: (actor, filter) => {
        const parts = [marketScope(actor, "organizations")];
        if (filter?.kind) parts.push(sql`organizations.kind = ${filter.kind}`);
        return all(
          sql`SELECT * FROM organizations WHERE ${joinSql(parts, " AND ")}
              ORDER BY organizations.name, organizations.id COLLATE "C"`,
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
              ORDER BY organizations.applied_on, organizations.id COLLATE "C"`,
          toOrganization,
        ),
    },

    students: {
      list: (actor) =>
        all(
          sql`${rawText(STUDENT_SELECT)} WHERE ${studentScope(actor)}
              ORDER BY users.name, students.id COLLATE "C"`,
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
                AND students.status IN ('pending_verification', 'profile_complete')
              -- Students who have actually asked come first. A profile nobody
              -- submitted is not waiting on anyone — it is in this list so the
              -- college can see it coming, not so it can head the queue and
              -- offer the one action the college cannot take.
              ORDER BY (students.status = 'pending_verification') DESC,
                       users.name, students.id COLLATE "C"`,
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

        // The consent check runs as the employer, who may read no consents at
        // all — so it deliberately does NOT go through `consentsWhere`. It asks
        // the narrow question "is one in force", which is not the same as
        // handing an employer the row.
        const inForce = await one<{ ok: boolean }>(
          sql`SELECT TRUE AS ok FROM consents
               WHERE consents.student_id = ${student.id}
                 AND consents.source_org_id = ${student.collegeId}
                 AND consents.scope = 'education_record'
                 AND consents.status = 'granted'
                 AND (consents.expires_on IS NULL OR consents.expires_on > now())
               LIMIT 1`,
          (row) => ({ ok: row.ok === true }),
        );
        const level = inForce ? disclosureFor(application) : "summary";
        return redactStudent(student, level);
      },
    },

    postings: {
      list: (actor, filter) => {
        const parts = [marketScope(actor, "postings"), postingOwnershipScope(actor)];
        if (filter?.status) parts.push(sql`postings.status = ${filter.status}`);
        return all(
          sql`SELECT * FROM postings WHERE ${joinSql(parts, " AND ")}
              ORDER BY postings.created_at DESC, postings.id COLLATE "C"`,
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
              WHERE ${marketScope(actor, "postings")} AND postings.status = 'published'
              ORDER BY postings.created_at DESC, postings.id COLLATE "C"`,
          toPosting,
        ),
      awaitingCollegeHelp: (actor) =>
        all(
          sql`SELECT * FROM postings
              WHERE ${marketScope(actor, "postings")}
                AND postings.status IN ('help_requested', 'college_drafting')
              ORDER BY postings.created_at DESC, postings.id COLLATE "C"`,
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
          sql`SELECT * FROM mentorship_offers WHERE ${joinSql(parts, " AND ")}
              ORDER BY mentorship_offers.created_at DESC, mentorship_offers.id COLLATE "C"`,
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
                AND mentorship_offers.status = 'open'
              ORDER BY mentorship_offers.created_at DESC, mentorship_offers.id COLLATE "C"`,
          toMentorshipOffer,
        ),
    },

    mentorshipPairings: {
      list: (actor) => all(pairingsWhere(actor, sql`TRUE`), toMentorshipPairing),
      find: (actor, id) =>
        one(pairingsWhere(actor, sql`mentorship_pairings.id = ${id}`), toMentorshipPairing),
      forOffer: (actor, offerId) =>
        all(
          pairingsWhere(actor, sql`mentorship_pairings.offer_id = ${offerId}`),
          toMentorshipPairing,
        ),
      forStudent: (actor, studentId) =>
        all(
          pairingsWhere(actor, sql`mentorship_pairings.student_id = ${studentId}`),
          toMentorshipPairing,
        ),
    },

    applications: {
      list: (actor) =>
        all(
          sql`${rawText(APPLICATION_SELECT)} WHERE ${applicationScope(actor)}
              ORDER BY applications.submitted_on DESC, applications.id COLLATE "C"`,
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
              WHERE ${applicationScope(actor)} AND applications.student_id = ${studentId}
              ORDER BY applications.submitted_on DESC, applications.id COLLATE "C"`,
          toApplication,
        ),
      forPosting: (actor, postingId) =>
        all(
          sql`${rawText(APPLICATION_SELECT)}
              WHERE ${applicationScope(actor)} AND applications.posting_id = ${postingId}
              ORDER BY applications.submitted_on DESC, applications.id COLLATE "C"`,
          toApplication,
        ),
    },

    interviewSlots: {
      list: (actor) =>
        all(
          sql`SELECT * FROM interview_slots
              WHERE ${marketScope(actor, "interview_slots")}
              ORDER BY interview_slots.starts_at, interview_slots.id COLLATE "C"`,
          toInterviewSlot,
        ),
      open: (actor) =>
        all(
          sql`SELECT * FROM interview_slots
              WHERE ${marketScope(actor, "interview_slots")}
                AND interview_slots.booked_by IS NULL
              ORDER BY interview_slots.starts_at, interview_slots.id COLLATE "C"`,
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
          byWeekAscending,
        ),
    },

    creditAwards: {
      list: (actor) =>
        all(
          sql`${rawText(CREDIT_SELECT)} WHERE ${marketScope(actor, "credit_awards")}
              ORDER BY credit_awards.granted_on DESC NULLS LAST, credit_awards.id COLLATE "C"`,
          toCreditAward,
        ),
      forStudent: (actor, studentId) =>
        all(
          sql`${rawText(CREDIT_SELECT)}
              WHERE ${marketScope(actor, "credit_awards")}
                AND credit_awards.student_id = ${studentId}
              ORDER BY credit_awards.granted_on DESC NULLS LAST, credit_awards.id COLLATE "C"`,
          toCreditAward,
        ),
    },

    consents: {
      list: (actor) => all(consentsWhere(actor, sql`TRUE`), toConsentRecord),
      find: (actor, id) =>
        one(consentsWhere(actor, sql`consents.id = ${id}`), toConsentRecord),
      forStudent: (actor, studentId) =>
        all(consentsWhere(actor, sql`consents.student_id = ${studentId}`), toConsentRecord),
    },

    escalations: {
      list: (actor) => all(escalationsWhere(actor, sql`TRUE`), toEscalation),
      find: (actor, id) =>
        one(escalationsWhere(actor, sql`escalations.id = ${id}`), toEscalation),
      forApplication: (actor, applicationId) =>
        all(
          escalationsWhere(actor, sql`escalations.application_id = ${applicationId}`),
          toEscalation,
        ),
      live: (actor) =>
        all(
          escalationsWhere(actor, sql`escalations.status IN ('open', 'acknowledged')`),
          toEscalation,
        ),
    },

    fundingSources: {
      list: (actor) => all(fundsWhere(actor, sql`TRUE`), toFundingSource),
      find: (actor, id) =>
        one(fundsWhere(actor, sql`funding_sources.id = ${id}`), toFundingSource),
      forMarket: (actor, marketId) =>
        all(fundsWhere(actor, sql`funding_sources.market_id = ${marketId}`), toFundingSource),
    },

    fundingCommitments: {
      list: (actor) => all(commitmentsWhere(actor, sql`TRUE`), toFundingCommitment),
      find: (actor, id) =>
        one(commitmentsWhere(actor, sql`funding_commitments.id = ${id}`), toFundingCommitment),
      forSource: (actor, sourceId) =>
        all(
          commitmentsWhere(actor, sql`funding_commitments.funding_source_id = ${sourceId}`),
          toFundingCommitment,
        ),
      forApplication: (actor, applicationId) =>
        all(
          commitmentsWhere(actor, sql`funding_commitments.application_id = ${applicationId}`),
          toFundingCommitment,
        ),
      forStudent: (actor, studentId) =>
        all(
          commitmentsWhere(actor, sql`funding_commitments.student_id = ${studentId}`),
          toFundingCommitment,
        ),
    },

    outcomes: {
      list: (actor) => outcomesWhere(actor, sql`TRUE`),
      forStudent: (actor, studentId) =>
        outcomesWhere(actor, sql`outcomes.student_id = ${studentId}`),
      forApplication: (actor, applicationId) =>
        outcomesWhere(actor, sql`outcomes.application_id = ${applicationId}`),
    },

    hostOffers: {
      list: (actor) => hostOffersWhere(actor, sql`TRUE`),
      forApplication: async (actor, applicationId) => {
        const rows = await hostOffersWhere(
          actor,
          sql`host_offers.application_id = ${applicationId}`,
        );
        return rows[0] ?? null;
      },
      forStudent: (actor, studentId) =>
        hostOffersWhere(actor, sql`host_offers.student_id = ${studentId}`),
    },

    regionDefinitions: {
      list: (actor) => regionsWhere(actor, sql`TRUE`),
      forMarket: (actor, marketId) =>
        regionsWhere(actor, sql`region_definitions.market_id = ${marketId}`),
    },

    auditEvents: {
      list: (actor, filter) => {
        const parts = [marketScope(actor, "audit_events")];
        if (filter?.entityId) {
          parts.push(sql`audit_events.entity_id = ${filter.entityId}`);
        }
        return all(
          sql`SELECT * FROM audit_events WHERE ${joinSql(parts, " AND ")}
              -- Qualified, and deliberately not collated: the audit log's id
              -- is a bigserial, and a number has one order on every server.
              ORDER BY audit_events.occurred_at DESC, audit_events.id DESC`,
          toAuditEvent,
        );
      },
    },

    users: {
      // Deliberately unscoped, matching the in-memory contract: this resolves
      // the name behind an audit entry or a notification recipient, both of
      // which cross market boundaries by design.
      find: (id) => one(sql`SELECT * FROM users WHERE id = ${id}`, toUser),
      // Every administrator, because the role is the one without a market to
      // narrow by — `admin_is_cross_market` in the schema says so. Ordered by
      // id so the two layers agree; the parity suite compares the list.
      administrators: () =>
        all(
          sql`SELECT users.* FROM users
              JOIN memberships ON memberships.user_id = users.id
              WHERE memberships.role = 'admin'
              ORDER BY users.id COLLATE "C"`,
          toUser,
        ),
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
