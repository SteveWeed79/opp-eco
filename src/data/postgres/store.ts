/**
 * The write side, in SQL.
 *
 * `UnitOfWork` is a **synchronous** interface — every method returns `void` —
 * and that is deliberate rather than an oversight: a caller that could `await`
 * mid-transaction would hold a database connection open across a network round
 * trip it does not control. So the same shape the in-memory store uses applies
 * here. Each method stages a statement; nothing runs until `work` returns, and
 * then the whole batch executes inside one transaction.
 *
 * That ordering is what makes the contract in `store.ts` true: a state change,
 * its audit record, and any notification it queues either all land or none do.
 *
 * **Version checks move into the statement.** The in-memory store compares
 * versions in JavaScript before staging, which is a check-then-act with a gap
 * in the middle. Here the check is `WHERE version = $n` and the assertion is on
 * how many rows came back — so two officers acting on one application cannot
 * both pass the check and both write.
 */

import type {
  Application,
  AuditEvent,
  CreditAward,
  InterviewSlot,
  MentorshipOffer,
  Organization,
  Posting,
  Student,
  TimeEntry,
} from "@/domain/types";
import {
  ConcurrencyError,
  type NotificationIntent,
  type Store,
  type UnitOfWork,
} from "../store";
import { sql, type Sql } from "./client";
import type { PostgresClient } from "./neon";
import { cents } from "./rows";

/**
 * A staged statement, and what it must have done.
 *
 * `expect` names the row a versioned write was aiming at. When the statement
 * returns nothing, the row either moved on or never existed, and the caller
 * has to be told to look again rather than silently losing their edit.
 */
interface Staged {
  statement: Sql;
  expect?: { entity: string; id: string };
}

class PostgresUnitOfWork implements UnitOfWork {
  readonly staged: Staged[] = [];

  private add(statement: Sql, expect?: Staged["expect"]) {
    this.staged.push({ statement, expect });
  }

  // -- Applications ---------------------------------------------------------

  createApplication(application: Application) {
    // No upsert. A create that quietly overwrote an existing row would turn a
    // duplicate submission into silent data loss; the unique constraint on
    // (posting_id, student_id) is the backstop.
    this.add(sql`
      INSERT INTO applications (
        id, market_id, posting_id, student_id, track, status, furthest_status,
        submitted_on, status_since, match_score, match_algorithm_version,
        match_factors, interview_slot_id, funding_authorized_hours,
        funding_authorized_rate_cents, hours_logged, hours_approved,
        deliverable_submitted, deliverable_accepted, version
      ) VALUES (
        ${application.id}, ${application.marketId}, ${application.postingId},
        ${application.studentId}, ${application.track}, ${application.status},
        ${application.furthestStatus ?? null}, ${application.submittedOn},
        ${application.statusSince}, ${application.matchScore.score},
        ${application.matchScore.algorithmVersion},
        ${JSON.stringify(application.matchScore.factors)}::jsonb,
        ${application.interviewSlotId ?? null},
        ${application.fundingAuthorizedHours ?? null},
        ${optionalCents(application.fundingAuthorizedRate)},
        ${application.hoursLogged ?? 0}, ${application.hoursApproved ?? 0},
        ${application.deliverableSubmitted ?? false},
        ${application.deliverableAccepted ?? false},
        ${application.version}
      )`);
  }

  saveApplication(application: Application, expectedVersion: number) {
    this.add(
      sql`
        UPDATE applications SET
          status = ${application.status},
          furthest_status = ${application.furthestStatus ?? null},
          status_since = ${application.statusSince},
          interview_slot_id = ${application.interviewSlotId ?? null},
          funding_authorized_hours = ${application.fundingAuthorizedHours ?? null},
          funding_authorized_rate_cents = ${optionalCents(application.fundingAuthorizedRate)},
          hours_logged = ${application.hoursLogged ?? 0},
          hours_approved = ${application.hoursApproved ?? 0},
          deliverable_submitted = ${application.deliverableSubmitted ?? false},
          deliverable_accepted = ${application.deliverableAccepted ?? false},
          version = version + 1,
          updated_at = now()
        WHERE id = ${application.id} AND version = ${expectedVersion}
        RETURNING id`,
      { entity: "Application", id: application.id },
    );
  }

  // -- Postings -------------------------------------------------------------

  createPosting(posting: Posting) {
    this.add(sql`
      INSERT INTO postings (
        id, market_id, business_id, track, title, description, county,
        skills_required, skills_preferred, status, openings, wage_cents,
        hours_per_week, weeks, credit_hours, supervisor_name, project_fee_cents,
        estimated_hours, deliverable, due_within_days, created_at
      ) VALUES (
        ${posting.id}, ${posting.marketId}, ${posting.businessId}, ${posting.track},
        ${posting.title}, ${posting.description}, ${posting.county},
        ${posting.skillsRequired}, ${posting.skillsPreferred}, ${posting.status},
        ${posting.openings}, ${optionalCents(posting.wagePerHour)},
        ${posting.hoursPerWeek ?? null}, ${posting.weeks ?? null},
        ${posting.creditHours ?? null}, ${posting.supervisorName ?? null},
        ${optionalCents(posting.projectFee)}, ${posting.estimatedHours ?? null},
        ${posting.deliverable ?? null}, ${posting.dueWithinDays ?? null},
        ${posting.createdOn}
      )`);
  }

  /**
   * Unversioned, matching the in-memory contract: a posting is reviewed by one
   * college, so the concurrent-write case versions protect against does not
   * arise the way it does where five portals act on one record.
   */
  savePosting(posting: Posting) {
    this.add(sql`
      UPDATE postings SET
        title = ${posting.title},
        description = ${posting.description},
        county = ${posting.county},
        skills_required = ${posting.skillsRequired},
        skills_preferred = ${posting.skillsPreferred},
        status = ${posting.status},
        openings = ${posting.openings},
        wage_cents = ${optionalCents(posting.wagePerHour)},
        hours_per_week = ${posting.hoursPerWeek ?? null},
        weeks = ${posting.weeks ?? null},
        credit_hours = ${posting.creditHours ?? null},
        supervisor_name = ${posting.supervisorName ?? null},
        project_fee_cents = ${optionalCents(posting.projectFee)},
        estimated_hours = ${posting.estimatedHours ?? null},
        deliverable = ${posting.deliverable ?? null},
        due_within_days = ${posting.dueWithinDays ?? null},
        updated_at = now()
      WHERE id = ${posting.id}`);
  }

  // -- People and organizations ---------------------------------------------

  /**
   * Name and email are absent on purpose: they live on `users`, and a student
   * record changing does not change who the person is.
   *
   * `verified_by` is left untouched rather than written, because the domain's
   * `Student` does not carry it and the schema requires it once a student is
   * verified. A verification performed through the app therefore needs the
   * acting user threaded into this method before writes are switched on — the
   * seed sets it directly, which is why nothing fails today.
   */
  saveStudent(student: Student) {
    this.add(sql`
      UPDATE students SET
        program_of_study = ${student.programOfStudy},
        class_standing = ${student.classStanding},
        expected_graduation = ${student.expectedGraduation},
        skills = ${student.skills},
        interests = ${student.interests},
        available_hours_per_week = ${student.availableHoursPerWeek},
        status = ${student.status},
        eligibility = ${student.eligibility},
        eligibility_determined_on = ${student.eligibilityDeterminedOn},
        verified_on = ${student.verifiedOn},
        updated_at = now()
      WHERE id = ${student.id}`);
  }

  saveOrganization(organization: Organization) {
    this.add(sql`
      UPDATE organizations SET
        name = ${organization.name},
        county = ${organization.county},
        status = ${organization.status},
        contact_name = ${organization.contactName},
        contact_email = ${organization.contactEmail},
        hours_per_credit = ${organization.hoursPerCredit ?? null},
        brand_color = ${organization.brandColor ?? null},
        accent_color = ${organization.accentColor ?? null},
        logo_url = ${organization.logoUrl ?? null},
        updated_at = now()
      WHERE id = ${organization.id}`);
  }

  // -- Mentorship -----------------------------------------------------------

  createMentorshipOffer(offer: MentorshipOffer) {
    this.add(sql`
      INSERT INTO mentorship_offers (
        id, market_id, business_id, format, mentor_name, mentor_role,
        topics, description, capacity, status, created_at
      ) VALUES (
        ${offer.id}, ${offer.marketId}, ${offer.businessId}, ${offer.format},
        ${offer.mentorName}, ${offer.mentorRole}, ${offer.topics},
        ${offer.description}, ${offer.capacity}, ${offer.status}, ${offer.createdOn}
      )`);
  }

  saveMentorshipOffer(offer: MentorshipOffer) {
    this.add(sql`
      UPDATE mentorship_offers SET
        format = ${offer.format},
        mentor_name = ${offer.mentorName},
        mentor_role = ${offer.mentorRole},
        topics = ${offer.topics},
        description = ${offer.description},
        capacity = ${offer.capacity},
        status = ${offer.status},
        updated_at = now()
      WHERE id = ${offer.id}`);
  }

  // -- Interview slots ------------------------------------------------------

  saveInterviewSlot(slot: InterviewSlot, expectedVersion: number) {
    // Two students racing for the last slot is the likeliest write conflict in
    // the system. The version predicate is what settles it: the second update
    // matches no row and its caller is told to pick another.
    this.add(
      sql`
        UPDATE interview_slots SET
          booked_by = ${slot.bookedByStudentId},
          booked_at = ${slot.bookedAt ?? null},
          meeting_url = ${slot.meetingUrl},
          version = version + 1
        WHERE id = ${slot.id} AND version = ${expectedVersion}
        RETURNING id`,
      { entity: "Interview slot", id: slot.id },
    );
  }

  // -- Hours ----------------------------------------------------------------

  createTimeEntry(entry: TimeEntry) {
    this.add(sql`
      INSERT INTO time_entries (
        id, market_id, application_id, student_id, business_id, week_starting,
        hours, summary, status, submitted_on, reviewed_on, reviewed_by,
        review_note, version
      ) VALUES (
        ${entry.id}, ${entry.marketId}, ${entry.applicationId}, ${entry.studentId},
        ${entry.businessId}, ${entry.weekStarting}, ${entry.hours}, ${entry.summary},
        ${entry.status}, ${entry.submittedOn}, ${entry.reviewedOn ?? null},
        ${entry.reviewedByUserId ?? null}, ${entry.reviewNote ?? null}, ${entry.version}
      )`);
  }

  saveTimeEntry(entry: TimeEntry, expectedVersion: number) {
    this.add(
      sql`
        UPDATE time_entries SET
          hours = ${entry.hours},
          summary = ${entry.summary},
          status = ${entry.status},
          reviewed_on = ${entry.reviewedOn ?? null},
          reviewed_by = ${entry.reviewedByUserId ?? null},
          review_note = ${entry.reviewNote ?? null},
          version = version + 1,
          updated_at = now()
        WHERE id = ${entry.id} AND version = ${expectedVersion}
        RETURNING id`,
      { entity: "Time entry", id: entry.id },
    );
  }

  // -- Credit ---------------------------------------------------------------

  /**
   * Upserted, then its applications rewritten.
   *
   * The join table carries `work_hours` per application and the domain's
   * `CreditAward` does not — it has a single `totalWorkHours`. Rather than
   * inventing a per-row number, the total is divided across the applications
   * with the remainder on the first. That is a reconstruction, and it is
   * honest only because nothing in the product calls this yet: the seed writes
   * the real per-application hours directly. Threading them onto `CreditAward`
   * is the fix, and it belongs with whoever writes the granting flow.
   */
  saveCreditAward(award: CreditAward) {
    this.add(sql`
      INSERT INTO credit_awards (
        id, market_id, student_id, college_id, credit_hours, total_work_hours,
        carried_hours, status, course_mapping, granted_on
      ) VALUES (
        ${award.id}, ${award.marketId}, ${award.studentId}, ${award.collegeId},
        ${award.creditHours}, ${award.totalWorkHours}, ${award.carriedHours},
        ${award.status}, ${award.courseMapping}, ${award.grantedOn}
      )
      ON CONFLICT (id) DO UPDATE SET
        credit_hours = EXCLUDED.credit_hours,
        total_work_hours = EXCLUDED.total_work_hours,
        carried_hours = EXCLUDED.carried_hours,
        status = EXCLUDED.status,
        course_mapping = EXCLUDED.course_mapping,
        granted_on = EXCLUDED.granted_on`);

    this.add(sql`
      DELETE FROM credit_award_applications WHERE credit_award_id = ${award.id}`);

    const count = award.applicationIds.length;
    if (count > 0) {
      const each = Math.floor(award.totalWorkHours / count);
      const remainder = award.totalWorkHours - each * count;
      award.applicationIds.forEach((applicationId, index) => {
        this.add(sql`
          INSERT INTO credit_award_applications (credit_award_id, application_id, work_hours)
          VALUES (${award.id}, ${applicationId}, ${each + (index === 0 ? remainder : 0)})`);
      });
    }
  }

  // -- Audit and notification ----------------------------------------------

  appendAuditEvent(event: Omit<AuditEvent, "id">) {
    this.add(sql`
      INSERT INTO audit_events (
        market_id, occurred_at, actor_user_id, actor_role, entity_type,
        entity_id, from_state, to_state, reason, via_override
      ) VALUES (
        ${event.marketId}, ${event.at}, ${event.actorUserId}, ${event.actorRole},
        ${event.entityType}, ${event.entityId}, ${event.from ?? null},
        ${event.to}, ${event.reason ?? null}, ${event.viaOverride ?? false}
      )`);
  }

  /**
   * The outbox row *is* the queue in this mode.
   *
   * Written in the same transaction as the change that caused it, which is the
   * whole point: a message about work that rolled back is a lie, and a change
   * that commits without its message is a queue nobody watches.
   */
  enqueueNotification(intent: NotificationIntent) {
    this.add(sql`
      INSERT INTO notification_outbox (market_id, recipient_id, kind, payload)
      VALUES (
        ${intent.marketId}, ${intent.recipientUserId}, ${intent.kind},
        ${JSON.stringify(intent.payload)}::jsonb
      )`);
  }
}

/** Dollars to cents, preserving "not set" rather than turning it into zero. */
function optionalCents(value: number | undefined): number | null {
  return value === undefined ? null : cents(value);
}

export function postgresStore(client: PostgresClient): Store {
  return {
    async transaction<T>(work: (uow: UnitOfWork) => T): Promise<T> {
      const uow = new PostgresUnitOfWork();
      // Runs first and synchronously, exactly as the in-memory store does.
      // Guards and domain validation raise here, before a connection is taken.
      const result = work(uow);

      if (uow.staged.length === 0) return result;

      await client.transaction(async (tx) => {
        for (const { statement, expect } of uow.staged) {
          const rows = await tx.query(statement.text, statement.params);
          // A versioned write that matched nothing means the row moved under
          // the caller. Throwing here rolls the whole batch back.
          if (expect && rows.length === 0) {
            throw new ConcurrencyError(expect.entity, expect.id);
          }
        }
      });

      return result;
    },
  };
}
