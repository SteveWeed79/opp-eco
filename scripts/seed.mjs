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
 * same database rather than a duplicated one. It writes through raw SQL and not
 * through the Store, deliberately — the Store is the application's write path
 * and is read-only by default, while loading fixtures is an operator action.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";
import { Pool, neonConfig } from "@neondatabase/serverless";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(ROOT, "scripts", "ts-alias-hook.mjs")));

for (const file of [".env.local", ".env"]) {
  const path = join(ROOT, file);
  if (existsSync(path)) {
    try {
      process.loadEnvFile(path);
    } catch {
      // An explicit DATABASE_URL should still work past a malformed env file.
    }
  }
}

const seed = await import(pathToFileURL(join(ROOT, "src/data/seed.ts")).href);
const session = await import(pathToFileURL(join(ROOT, "src/data/session.ts")).href);

/** Dollars to cents, matching `rows.ts` on the read side. */
const cents = (value) => (value === undefined || value === null ? null : Math.round(value * 100));

function connect() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error(
      "DATABASE_URL is not set. Put your Neon connection string in .env.local first.",
    );
    process.exit(1);
  }
  if (!neonConfig.webSocketConstructor) {
    neonConfig.webSocketConstructor = globalThis.WebSocket;
  }
  return new Pool({ connectionString, max: 1 });
}

/**
 * Tables in dependency order, truncated in one statement.
 *
 * `RESTART IDENTITY` resets the two bigserial sequences so a re-seed produces
 * the same audit ids rather than climbing forever. `schema_migrations` is
 * deliberately absent: the schema is not the data, and wiping the ledger would
 * make the next `db:migrate` try to rebuild tables that already exist.
 */
export const TABLES = [
  "notification_outbox",
  "audit_events",
  "credit_award_applications",
  "credit_awards",
  "time_entries",
  "applications",
  "interview_slots",
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
      `INSERT INTO markets (id, name, city, counties, stage, board_id, launched_on,
         subsidy_budget_cents, subsidy_rate_cents, program_year)
       VALUES ($1,$2,$3,$4,'configuring',NULL,$5,$6,$7,$8)`,
      [
        market.id,
        market.name,
        market.city,
        market.counties,
        market.launchedOn,
        cents(market.subsidyBudget),
        cents(market.subsidyRatePerHour),
        market.programYear,
      ],
    );
  }

  for (const org of seed.organizations) {
    await insert(
      `INSERT INTO organizations (id, market_id, kind, name, county, status,
         contact_name, contact_email, applied_on, hours_per_credit,
         brand_color, accent_color, logo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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
        // college account that would have — see `saveStudent` in the store.
        student.verifiedOn ? "u-college" : null,
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
         furthest_status, submitted_on, status_since, match_score,
         match_algorithm_version, match_factors, interview_slot_id,
         funding_authorized_hours, funding_authorized_rate_cents,
         hours_logged, hours_approved, deliverable_submitted, deliverable_accepted, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20)`,
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
        award.grantedOn ? "u-college" : null,
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
const pool = connect();
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
       (SELECT count(*) FROM interview_slots)    AS interview_slots,
       (SELECT count(*) FROM credit_awards)      AS credit_awards,
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
