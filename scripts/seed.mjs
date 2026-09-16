#!/usr/bin/env node
/**
 * Load the demo fixtures into Postgres.
 *
 *   npm run db:seed
 *
 * Imports the *real* fixtures from `src/data/seed.ts` rather than restating
 * them, so the seeded database and the in-memory demo cannot drift apart. That
 * is what the alias hook alongside this file exists for.
 *
 * Idempotent: every table is truncated first, so running it twice leaves the
 * same database rather than a duplicated one. The connection comes from
 * `pool.mjs`, so it reaches whatever `DATABASE_URL` names — Neon, a container
 * in CI, or a local cluster. It writes through raw SQL and not
 * through the Store, deliberately — the Store is the application's write path
 * and is read-only by default, while loading fixtures is an operator action.
 */

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Registers the TypeScript alias hook the fixture import below depends on, and
// loads the env files, before this module's body runs.
import { connect } from "./pool.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const seed = await import(pathToFileURL(join(ROOT, "src/data/seed.ts")).href);
const session = await import(pathToFileURL(join(ROOT, "src/data/session.ts")).href);

/** Dollars to cents, matching `rows.ts` on the read side. */
const cents = (value) => (value === undefined || value === null ? null : Math.round(value * 100));

/**
 * Tables in dependency order, truncated in one statement.
 *
 * `RESTART IDENTITY` resets the two bigserial sequences so a re-seed produces
 * the same audit ids rather than climbing forever. `schema_migrations` is
 * deliberately absent: the schema is not the data, and wiping the ledger would
 * make the next `db:migrate` try to rebuild tables that already exist.
 */
/**
 * Tables the truncation clears and the fixtures never refill.
 *
 * Everything here is produced by the running application rather than by a
 * fixture, and each one would be actively wrong to ship: a seeded session or
 * sign-in code is a working credential committed to the repository, a seeded
 * password is one every checkout knows, and a fixture upload is a blob nobody
 * chose. The outbox fills as transactions commit.
 *
 * Named as a set rather than left implicit because `src/data/postgres/seed.test.ts`
 * asserts that every *other* table in `TABLES` is written by `seedInto` — a
 * fixture that quietly stops being seeded leaves an empty table nobody notices
 * until a portal renders blank.
 */
export const RUNTIME_TABLES = [
  "uploaded_files",
  "notification_outbox",
  "sessions",
  "sign_in_codes",
  // Credentials. These reference `users` and would be emptied by the CASCADE
  // whether or not they were listed — named anyway, because a re-seed silently
  // discarding every password in the database is exactly the kind of thing that
  // should be readable in the list of what it clears.
  "user_passwords",
  "user_totp",
  "user_recovery_codes",
  "mfa_challenges",
];

export const TABLES = [
  "uploaded_files",
  "user_passwords",
  "user_totp",
  "user_recovery_codes",
  "mfa_challenges",
  "sessions",
  "sign_in_codes",
  "notification_outbox",
  "audit_events",
  "host_offers",
  "outcomes",
  "consents",
  "funding_commitments",
  "funding_sources",
  "credit_award_applications",
  "credit_awards",
  "time_entries",
  "applications",
  "interview_slots",
  "mentorship_pairings",
  "mentorship_offers",
  "postings",
  "students",
  "memberships",
  "users",
  "market_colleges",
  "organizations",
  "markets",
];

export async function seedInto(tx) {
  const insert = (text, params) => tx.query(text, params);

  /**
   * Markets and organizations reference each other: a market names its board,
   * and every organization belongs to a market. There is no order that
   * satisfies both, and `live_market_has_board` refuses a live market with no
   * board — so markets land in a pre-live stage first and are corrected once
   * their board exists.
   */
  for (const market of seed.markets) {
    await insert(
      `INSERT INTO markets (id, name, city, counties, state, stage, board_id,
         launched_on, program_year)
       VALUES ($1,$2,$3,$4,$5,'configuring',NULL,$6,$7)`,
      [
        market.id,
        market.name,
        market.city,
        market.counties,
        market.state,
        market.launchedOn,
        market.programYear,
      ],
    );
  }

  for (const org of seed.organizations) {
    await insert(
      `INSERT INTO organizations (id, market_id, kind, name, county, status,
         contact_name, contact_email, applied_on, hours_per_credit,
         brand_color, accent_color, logo_url, identity_mode, email_domains)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        org.id,
        org.marketId,
        org.kind,
        org.name,
        org.county,
        org.status,
        org.contactName,
        org.contactEmail,
        org.appliedOn,
        org.hoursPerCredit ?? null,
        org.brandColor ?? null,
        org.accentColor ?? null,
        org.logoUrl ?? null,
        org.identityMode,
        org.emailDomains,
      ],
    );
  }

  // Now the board exists, so the real stage and board can be set together.
  for (const market of seed.markets) {
    await insert(`UPDATE markets SET board_id = $2, stage = $3 WHERE id = $1`, [
      market.id,
      market.boardId,
      market.stage,
    ]);
    for (const collegeId of market.collegeIds) {
      await insert(
        `INSERT INTO market_colleges (market_id, college_id) VALUES ($1,$2)`,
        [market.id, collegeId],
      );
    }
  }

  for (const user of seed.users) {
    await insert(`INSERT INTO users (id, name, email) VALUES ($1,$2,$3)`, [
      user.id,
      user.name,
      user.email,
    ]);
  }

  // Memberships are what every repository read is scoped by, so a database
  // without them is one where nobody can sign in.
  //
  // Read through `contextFor` rather than `demoAccounts`, which strips the
  // membership on purpose so it cannot leak to a client.
  for (const role of ["admin", "student", "business", "college", "board"]) {
    const m = session.contextFor(role).membership;
    await insert(
      `INSERT INTO memberships (id, user_id, organization_id, market_id, role)
       VALUES ($1,$2,$3,$4,$5)`,
      [m.id, m.userId, m.organizationId, m.marketId, m.role],
    );
  }

  const collegeUserId = session.contextFor("college").membership.userId;

  for (const student of seed.students) {
    await insert(
      `INSERT INTO students (id, market_id, user_id, college_id, program_of_study,
         class_standing, expected_graduation, skills, interests,
         available_hours_per_week, status, eligibility,
         eligibility_determined_on, verified_on, verified_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        student.id,
        student.marketId,
        student.userId,
        student.collegeId,
        student.programOfStudy,
        student.classStanding,
        student.expectedGraduation,
        student.skills,
        student.interests,
        student.availableHoursPerWeek,
        student.status,
        student.eligibility,
        student.eligibilityDeterminedOn,
        student.verifiedOn,
        // The schema requires an attributable verification. The domain's
        // `Student` does not carry who did it, so the seed attributes it to the
        // college account that would have — read from the same membership the
        // app signs in as, because a literal id here was one that no `users`
        // row had and every insert failed on the foreign key.
        student.verifiedOn ? collegeUserId : null,
      ],
    );
  }

  for (const posting of seed.postings) {
    await insert(
      `INSERT INTO postings (id, market_id, business_id, track, title, description,
         county, skills_required, skills_preferred, status, openings, wage_cents,
         hours_per_week, weeks, credit_hours, supervisor_name, project_fee_cents,
         estimated_hours, deliverable, due_within_days, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        posting.id,
        posting.marketId,
        posting.businessId,
        posting.track,
        posting.title,
        posting.description,
        posting.county,
        posting.skillsRequired,
        posting.skillsPreferred,
        posting.status,
        posting.openings,
        cents(posting.wagePerHour),
        posting.hoursPerWeek ?? null,
        posting.weeks ?? null,
        posting.creditHours ?? null,
        posting.supervisorName ?? null,
        cents(posting.projectFee),
        posting.estimatedHours ?? null,
        posting.deliverable ?? null,
        posting.dueWithinDays ?? null,
        posting.createdOn,
      ],
    );
  }

  for (const offer of seed.mentorshipOffers) {
    await insert(
      `INSERT INTO mentorship_offers (id, market_id, business_id, format, mentor_name,
         mentor_role, topics, description, capacity, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        offer.id,
        offer.marketId,
        offer.businessId,
        offer.format,
        offer.mentorName,
        offer.mentorRole,
        offer.topics,
        offer.description,
        offer.capacity,
        offer.status,
        offer.createdOn,
      ],
    );
  }

  // After the offers they point at, and after the students and users they
  // name — a pairing has a foreign key to all four.
  for (const pairing of seed.mentorshipPairings) {
    await insert(
      `INSERT INTO mentorship_pairings (id, market_id, offer_id, business_id,
         student_id, introduced_by, introduced_on, status, outcome_note, outcome_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        pairing.id,
        pairing.marketId,
        pairing.offerId,
        pairing.businessId,
        pairing.studentId,
        pairing.introducedByUserId,
        pairing.introducedOn,
        pairing.status,
        pairing.outcomeNote ?? null,
        pairing.outcomeOn ?? null,
      ],
    );
  }

  // Slots are generated relative to "now" in the fixtures, so they are
  // materialised here at their absolute times rather than as a rule.
  const slots = seed.interviewSlotsAt(new Date());
  for (const slot of slots) {
    await insert(
      `INSERT INTO interview_slots (id, market_id, board_id, starts_at,
         duration_minutes, officer_name, booked_by, booked_at, meeting_url, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        slot.id,
        slot.marketId,
        slot.boardId,
        slot.startsAt,
        slot.durationMinutes,
        slot.officerName,
        slot.bookedByStudentId,
        slot.bookedByStudentId ? (slot.bookedAt ?? new Date().toISOString()) : null,
        slot.meetingUrl,
        slot.version,
      ],
    );
  }

  for (const application of seed.applications) {
    await insert(
      `INSERT INTO applications (id, market_id, posting_id, student_id, track, status,
         furthest_status, submitted_on, status_since, exited_on, match_score,
         match_algorithm_version, match_factors, interview_slot_id,
         funding_authorized_hours, funding_authorized_rate_cents,
         hours_logged, hours_approved, deliverable_submitted, deliverable_accepted, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        application.id,
        application.marketId,
        application.postingId,
        application.studentId,
        application.track,
        application.status,
        application.furthestStatus ?? null,
        application.submittedOn,
        application.statusSince,
        application.exitedOn ?? null,
        application.matchScore.score,
        application.matchScore.algorithmVersion,
        JSON.stringify(application.matchScore.factors),
        application.interviewSlotId ?? null,
        application.fundingAuthorizedHours ?? null,
        cents(application.fundingAuthorizedRate),
        application.hoursLogged ?? 0,
        application.hoursApproved ?? 0,
        application.deliverableSubmitted ?? false,
        application.deliverableAccepted ?? false,
        application.version,
      ],
    );
  }

  for (const entry of seed.timeEntries) {
    await insert(
      `INSERT INTO time_entries (id, market_id, application_id, student_id, business_id,
         week_starting, hours, summary, status, submitted_on, reviewed_on,
         reviewed_by, review_note, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        entry.id,
        entry.marketId,
        entry.applicationId,
        entry.studentId,
        entry.businessId,
        entry.weekStarting,
        entry.hours,
        entry.summary,
        entry.status,
        entry.submittedOn,
        entry.reviewedOn ?? null,
        entry.reviewedByUserId ?? null,
        entry.reviewNote ?? null,
        entry.version,
      ],
    );
  }

  for (const award of seed.creditAwards) {
    await insert(
      `INSERT INTO credit_awards (id, market_id, student_id, college_id, credit_hours,
         total_work_hours, carried_hours, status, course_mapping, granted_on, granted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        award.id,
        award.marketId,
        award.studentId,
        award.collegeId,
        award.creditHours,
        award.totalWorkHours,
        award.carriedHours,
        award.status,
        award.courseMapping,
        award.grantedOn,
        award.grantedOn ? collegeUserId : null,
      ],
    );

    // `work_hours` is per application here, which is the number the domain's
    // `CreditAward` does not carry. Split evenly, remainder on the first.
    const ids = award.applicationIds;
    const each = ids.length ? Math.floor(award.totalWorkHours / ids.length) : 0;
    const remainder = award.totalWorkHours - each * ids.length;
    for (const [index, applicationId] of ids.entries()) {
      await insert(
        `INSERT INTO credit_award_applications (credit_award_id, application_id, work_hours)
         VALUES ($1,$2,$3)`,
        [award.id, applicationId, each + (index === 0 ? remainder : 0)],
      );
    }
  }

  // Consents need their learner, the institution whose records they cover, and
  // the user who recorded them — all of which are in by now.
  for (const consent of seed.consents) {
    await insert(
      `INSERT INTO consents (id, market_id, student_id, source_org_id, scope,
         granted_by, granted_on, expires_on, status, recorded_by, note, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        consent.id,
        consent.marketId,
        consent.studentId,
        consent.sourceOrgId,
        consent.scope,
        consent.grantedBy,
        consent.grantedOn,
        consent.expiresOn ?? null,
        consent.status,
        consent.recordedByUserId,
        consent.note ?? null,
        consent.version,
      ],
    );
  }

  // Funds first, then the draws against them. A source needs its market and its
  // sponsoring organization; a commitment needs the source, the student, the
  // user who authorized it, and — where the draw is against a placement — the
  // application. All of those are in by this point.
  for (const source of seed.fundingSources) {
    await insert(
      `INSERT INTO funding_sources (id, market_id, sponsor_org_id, kind, purpose,
         program_year, name, allocated_cents, rate_cents, status, opened_on, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        source.id,
        source.marketId,
        source.sponsorOrgId,
        source.kind,
        source.purpose,
        source.programYear,
        source.name,
        cents(source.allocated),
        source.ratePerHour === undefined ? null : cents(source.ratePerHour),
        source.status,
        source.openedOn,
        source.version,
      ],
    );
  }

  for (const commitment of seed.fundingCommitments) {
    await insert(
      `INSERT INTO funding_commitments (id, market_id, funding_source_id, student_id,
         application_id, amount_cents, hours, rate_cents, status, authorized_on,
         authorized_by, note, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        commitment.id,
        commitment.marketId,
        commitment.fundingSourceId,
        commitment.studentId,
        commitment.applicationId ?? null,
        cents(commitment.amount),
        commitment.hours ?? null,
        commitment.ratePerHour === undefined ? null : cents(commitment.ratePerHour),
        commitment.status,
        commitment.authorizedOn,
        commitment.authorizedByUserId,
        commitment.note ?? null,
        commitment.version,
      ],
    );
  }

  // Last of the scoped tables: an outcome points at a market, a student, the
  // user who recorded it, and — when the learner reached it through a
  // placement — an application. All four are already in.
  for (const outcome of seed.outcomes) {
    await insert(
      `INSERT INTO outcomes (id, market_id, student_id, application_id, kind,
         employed_by_host, employment_county, employment_state,
         asserted_in_region, observed_on, recorded_on, recorded_by, source,
         detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        outcome.id,
        outcome.marketId,
        outcome.studentId,
        outcome.applicationId ?? null,
        outcome.kind,
        outcome.employedByHost,
        outcome.employmentCounty,
        outcome.employmentState,
        outcome.assertedInRegion,
        outcome.observedOn,
        outcome.recordedOn,
        outcome.recordedByUserId,
        outcome.source,
        outcome.detail ?? null,
      ],
    );
  }

  // The host's answer points at a market, an application, the employer, the
  // learner and whoever recorded it. All five are already in.
  for (const offer of seed.hostOffers) {
    await insert(
      `INSERT INTO host_offers (id, market_id, application_id, business_id,
         student_id, answer, recorded_by, recorded_on, source, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        offer.id,
        offer.marketId,
        offer.applicationId,
        offer.businessId,
        offer.studentId,
        offer.answer,
        offer.recordedByUserId,
        offer.recordedOn,
        offer.source,
        offer.note ?? null,
      ],
    );
  }

  for (const event of seed.auditEvents) {
    await insert(
      `INSERT INTO audit_events (market_id, occurred_at, actor_user_id, actor_role,
         entity_type, entity_id, from_state, to_state, reason, via_override)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        event.marketId,
        event.at,
        event.actorUserId,
        event.actorRole,
        event.entityType,
        event.entityId,
        event.from ?? null,
        event.to,
        event.reason ?? null,
        event.viaOverride ?? false,
      ],
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}

async function main() {
const pool = await connect();
try {
  const client = await pool.connect();
  try {
    // One transaction: a half-seeded database is worse than an empty one,
    // because it looks like it worked.
    await client.query("BEGIN");
    await client.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    await seedInto(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*) FROM markets)            AS markets,
       (SELECT count(*) FROM organizations)      AS organizations,
       (SELECT count(*) FROM users)              AS users,
       (SELECT count(*) FROM students)           AS students,
       (SELECT count(*) FROM postings)           AS postings,
       (SELECT count(*) FROM applications)       AS applications,
       (SELECT count(*) FROM time_entries)       AS time_entries,
       (SELECT count(*) FROM mentorship_offers)  AS mentorship_offers,
       (SELECT count(*) FROM mentorship_pairings) AS mentorship_pairings,
       (SELECT count(*) FROM interview_slots)    AS interview_slots,
       (SELECT count(*) FROM credit_awards)      AS credit_awards,
       (SELECT count(*) FROM outcomes)           AS outcomes,
       (SELECT count(*) FROM host_offers)        AS host_offers,
       (SELECT count(*) FROM consents)           AS consents,
       (SELECT count(*) FROM funding_sources)    AS funding_sources,
       (SELECT count(*) FROM funding_commitments) AS funding_commitments,
       (SELECT count(*) FROM audit_events)       AS audit_events`,
  );
  console.log("seeded:");
  for (const [table, count] of Object.entries(rows[0])) {
    console.log(`  ${String(count).padStart(5)}  ${table}`);
  }
} catch (error) {
  console.error("\nseed failed:", error.message ?? error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
}
