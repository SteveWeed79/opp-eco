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
  ConsentRecord,
  CreditAward,
  FundingCommitment,
  FundingSource,
  InterviewSlot,
  MentorshipOffer,
  MentorshipPairing,
  Organization,
  Outcome,
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
import { withoutParticipantPII } from "@/services/notification-privacy";
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
   * `verified_by` comes in beside the student rather than on it. The schema
   * will not accept a verified student without one — `students_verified_check`
   * — and the domain's `Student` has no field to carry it, so the acting user
   * is threaded from the transition that made the decision. Writing it here
   * rather than leaving the column untouched is what makes the college's
   * verification survive against a real database.
   */
  saveStudent(student: Student, verifiedBy: string | null) {
    this.add(sql`
      UPDATE students SET
        program_of_study = ${student.programOfStudy},
        purged_on = ${student.purgedOn},
        class_standing = ${student.classStanding},
        expected_graduation = ${student.expectedGraduation},
        skills = ${student.skills},
        interests = ${student.interests},
        available_hours_per_week = ${student.availableHoursPerWeek},
        status = ${student.status},
        eligibility = ${student.eligibility},
        eligibility_determined_on = ${student.eligibilityDeterminedOn},
        verified_on = ${student.verifiedOn},
        verified_by = ${verifiedBy},
        updated_at = now()
      WHERE id = ${student.id}`);
  }

  // -- Mentorship introductions ---------------------------------------------

  /**
   * No upsert, matching `createApplication`: the same student may be
   * introduced to the same mentor again months later, and the partial unique
   * index — one *live* pairing per student per offer — is the backstop that
   * distinguishes that from a double booking.
   */
  createMentorshipPairing(pairing: MentorshipPairing) {
    this.add(sql`
      INSERT INTO mentorship_pairings (
        id, market_id, offer_id, business_id, student_id, introduced_by,
        introduced_on, status, outcome_note, outcome_on
      ) VALUES (
        ${pairing.id}, ${pairing.marketId}, ${pairing.offerId},
        ${pairing.businessId}, ${pairing.studentId}, ${pairing.introducedByUserId},
        ${pairing.introducedOn}, ${pairing.status},
        ${pairing.outcomeNote ?? null}, ${pairing.outcomeOn ?? null}
      )`);
  }

  saveMentorshipPairing(pairing: MentorshipPairing) {
    this.add(sql`
      UPDATE mentorship_pairings SET
        status = ${pairing.status},
        outcome_note = ${pairing.outcomeNote ?? null},
        outcome_on = ${pairing.outcomeOn ?? null},
        updated_at = now()
      WHERE id = ${pairing.id}`);
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

  /**
   * Two statements, one transaction.
   *
   * The `students` row records that it happened; the `users` row is where the
   * name and the email actually are. Splitting them across two units of work
   * would allow a learner marked purged who still has contact details on file,
   * which is the only outcome worth preventing here.
   */
  purgeLearner(student: Student, at: string) {
    this.add(sql`
      UPDATE students SET purged_on = ${at}, skills = '{}', interests = '{}',
        expected_graduation = NULL, class_standing = ${student.classStanding},
        updated_at = now()
      WHERE id = ${student.id}`);
    this.add(sql`
      UPDATE users SET name = ${student.name}, email = ${student.email}
      WHERE id = ${student.userId}`);
  }

  // -- Consent --------------------------------------------------------------

  createConsent(consent: ConsentRecord) {
    this.add(sql`
      INSERT INTO consents (
        id, market_id, student_id, source_org_id, scope, granted_by,
        granted_on, expires_on, status, recorded_by, note, version
      ) VALUES (
        ${consent.id}, ${consent.marketId}, ${consent.studentId},
        ${consent.sourceOrgId}, ${consent.scope}, ${consent.grantedBy},
        ${consent.grantedOn}, ${consent.expiresOn}, ${consent.status},
        ${consent.recordedByUserId}, ${consent.note ?? null}, ${consent.version}
      )`);
  }

  /**
   * Status, expiry and note only.
   *
   * The scope, the institution and the grantor are absent from the SET list on
   * purpose: those describe what was actually signed, and a consent edited into
   * covering something it never did is worse than no record at all. Correcting
   * one means withdrawing it and recording the real thing.
   */
  saveConsent(consent: ConsentRecord, expectedVersion: number) {
    this.add(
      sql`
        UPDATE consents SET
          status = ${consent.status},
          expires_on = ${consent.expiresOn},
          note = ${consent.note ?? null},
          version = version + 1,
          updated_at = now()
        WHERE id = ${consent.id} AND version = ${expectedVersion}
        RETURNING id`,
      { entity: "Consent", id: consent.id },
    );
  }

  // -- Funding --------------------------------------------------------------

  createFundingSource(source: FundingSource) {
    this.add(sql`
      INSERT INTO funding_sources (
        id, market_id, sponsor_org_id, kind, purpose, program_year, name,
        allocated_cents, rate_cents, status, opened_on, version
      ) VALUES (
        ${source.id}, ${source.marketId}, ${source.sponsorOrgId}, ${source.kind},
        ${source.purpose}, ${source.programYear}, ${source.name},
        ${cents(source.allocated)}, ${optionalCents(source.ratePerHour)},
        ${source.status}, ${source.openedOn}, ${source.version}
      )`);
  }

  /**
   * The write that lets the numbers move.
   *
   * Versioned, and the `RETURNING id` is what turns a stale write into a told
   * failure rather than a silent one: a supplemental award overwritten by an
   * administrator's stale figure is an error a funder eventually finds.
   */
  saveFundingSource(source: FundingSource, expectedVersion: number) {
    this.add(
      sql`
        UPDATE funding_sources SET
          name = ${source.name},
          allocated_cents = ${cents(source.allocated)},
          rate_cents = ${optionalCents(source.ratePerHour)},
          status = ${source.status},
          version = version + 1,
          updated_at = now()
        WHERE id = ${source.id} AND version = ${expectedVersion}
        RETURNING id`,
      { entity: "Funding source", id: source.id },
    );
  }

  createFundingCommitment(commitment: FundingCommitment) {
    this.add(sql`
      INSERT INTO funding_commitments (
        id, market_id, funding_source_id, student_id, application_id,
        amount_cents, hours, rate_cents, status, authorized_on, authorized_by,
        note, version
      ) VALUES (
        ${commitment.id}, ${commitment.marketId}, ${commitment.fundingSourceId},
        ${commitment.studentId}, ${commitment.applicationId},
        ${cents(commitment.amount)}, ${commitment.hours ?? null},
        ${optionalCents(commitment.ratePerHour)}, ${commitment.status},
        ${commitment.authorizedOn}, ${commitment.authorizedByUserId},
        ${commitment.note ?? null}, ${commitment.version}
      )`);
  }

  /**
   * Status and note only.
   *
   * The amount, the hours and the rate are deliberately absent from the SET
   * list: a commitment is what was promised at the moment it was made, and
   * editing the figure afterwards would let a released draw be rewritten into a
   * smaller one that was never actually released. Correcting a commitment means
   * releasing it and making another.
   */
  saveFundingCommitment(commitment: FundingCommitment, expectedVersion: number) {
    this.add(
      sql`
        UPDATE funding_commitments SET
          status = ${commitment.status},
          note = ${commitment.note ?? null},
          version = version + 1,
          updated_at = now()
        WHERE id = ${commitment.id} AND version = ${expectedVersion}
        RETURNING id`,
      { entity: "Funding commitment", id: commitment.id },
    );
  }

  createOutcome(outcome: Outcome) {
    this.add(sql`
      INSERT INTO outcomes (
        id, market_id, student_id, application_id, kind,
        observed_on, recorded_on, recorded_by, source, detail
      ) VALUES (
        ${outcome.id}, ${outcome.marketId}, ${outcome.studentId},
        ${outcome.applicationId}, ${outcome.kind},
        ${outcome.observedOn}, ${outcome.recordedOn},
        ${outcome.recordedByUserId}, ${outcome.source},
        ${outcome.detail ?? null}
      )`);
  }

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
  /**
   * One recipient, and the column that can actually hold it.
   *
   * An intent naming an organization carries a synthetic `contact:org-x` in
   * `recipientUserId` — an address for a party with no account, which is not a
   * user id and must not be written as one. So the organization decides: when
   * it is set the message belongs to that organization's published contact,
   * and otherwise `recipientUserId` is a real user. Writing the sentinel into
   * a column that references `users` is what made every employer, college and
   * board notification fail, taking the state change beside it down too.
   */
  /**
   * Queued with participant PII stripped, matching the in-memory store.
   *
   * It matters more here than there. This payload is written to
   * `notification_outbox` as jsonb and sits in the database — and in every
   * backup of it — until the row is drained. A guard applied at render time
   * would clean the email and leave the participant's name in a table.
   */
  enqueueNotification(intent: NotificationIntent) {
    const safe = withoutParticipantPII(intent);
    const organizationId = safe.recipientOrganizationId ?? null;
    this.add(sql`
      INSERT INTO notification_outbox (
        market_id, recipient_user_id, recipient_organization_id, kind, payload
      ) VALUES (
        ${safe.marketId},
        ${organizationId ? null : safe.recipientUserId},
        ${organizationId},
        ${safe.kind},
        ${JSON.stringify(safe.payload)}::jsonb
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
