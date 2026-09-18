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
 * Idempotent: the demonstration is cleared before it is loaded, so running this
 * twice leaves the same database rather than a duplicated one.
 *
 * It does not truncate. `markets.is_demo_data` says which markets are the
 * demonstration, and every statement here is scoped to those — so a real
 * market, its learners, its placements and its money are not "preserved" from
 * this script, they are never named by it. Neither are administrators, whose
 * accounts and credentials therefore survive without being captured and put
 * back. `--replace-admins` names them for deletion deliberately.
 *
 * That is why there is no refusal and no `--force` any more. Both existed
 * because a truncate cannot tell a fixture from somebody's work; this can, and
 * a guard that fires on every real deployment is a guard whose override becomes
 * the command everybody types.
 *
 * The connection comes from `pool.mjs`, so it reaches whatever `DATABASE_URL`
 * names — Neon, a container in CI, or a local cluster. It writes through raw
 * SQL and not through the Store, deliberately — the Store is the application's
 * write path and is read-only by default, while loading fixtures is an
 * operator action.
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
 * Every table this schema holds, in dependency order — children first.
 *
 * Nothing truncates them any more; the order is what `DEMO_DELETES` walks,
 * because almost every foreign key to `markets` is `RESTRICT` and so the
 * markets have to go last. `schema_migrations` is deliberately absent: the
 * schema is not the data.
 *
 * Kept as one list because two tests read it — `seed.test.ts` asserts every
 * table here is either written by the fixtures or named as runtime, and that
 * every one is either deleted explicitly or reached by a cascade. A table added
 * to the schema and forgotten here fails both.
 */
/**
 * Tables the fixtures never write, whatever else clears them.
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
  "region_definitions",
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

// ---------------------------------------------------------------------------
// Telling the fixtures apart from somebody's real data
// ---------------------------------------------------------------------------

/**
 * Refused before anything was destroyed.
 *
 * Its own class so the command can present it as a decision rather than as a
 * crash — the same distinction `admin.mjs` draws with `AdminRefused`.
 */
export class SeedRefused extends Error {
  constructor(message) {
    super(message);
    this.name = "SeedRefused";
  }
}

/**
 * The ids the fixtures write, per table.
 *
 * This is how the seed tells its own rows from somebody's real ones: a row in
 * one of these tables whose id is not on this list was put there by the running
 * application or by an operator, and a fixture loader has no business
 * destroying it.
 *
 * Seven tables rather than all thirty, chosen because each one carries an
 * identity somebody entered by hand — a market, an employer, an account, a
 * learner, a job, an application to it, and the county list a board actually
 * operates over. A real person, organization or placement cannot exist without
 * a row here, so checking these catches the case that matters. What it
 * deliberately does not catch is a record the app wrote *about a fixture* — an
 * outcome on a seeded learner is demo data by construction, and re-seeding is
 * how you throw demo data away.
 *
 * `region_definitions` is on the list for a specific reason: it is the one
 * place where real, hand-gathered information gets recorded against a seeded
 * market. A board's WIOA county list is a phone call, not a fixture, and
 * losing it to a re-seed means making that call again.
 */
export const FIXTURE_IDS = {
  markets: seed.markets.map((m) => m.id),
  organizations: seed.organizations.map((o) => o.id),
  users: seed.users.map((u) => u.id),
  students: seed.students.map((s) => s.id),
  postings: seed.postings.map((p) => p.id),
  applications: seed.applications.map((a) => a.id),
  region_definitions: seed.regionDefinitions.map((r) => r.id),
};

/**
 * Administrators this script did not create, and can therefore carry through a
 * truncate rather than destroy.
 *
 * Preserving an administrator is safe in a way that preserving anybody else is
 * not, and the constraint is what makes it so: `admin_is_cross_market` requires
 * a null market *and* a null organization, so an administrator is the one role
 * that nothing the truncate removes is anchored to. Every other role points at
 * an organization that is about to stop existing — carrying one of those
 * through would leave a row referring to a market that no longer exists, which
 * is why an account holding any non-admin membership is excluded here and falls
 * through to the refusal instead.
 */
export async function findRealAdmins(tx) {
  const { rows } = await tx.query(
    `SELECT u.id, u.name, u.email
       FROM users u
       JOIN memberships m ON m.user_id = u.id AND m.role = 'admin'
      WHERE u.id <> ALL($1)
        AND NOT EXISTS (
              SELECT 1 FROM memberships other
               WHERE other.user_id = u.id AND other.role <> 'admin'
            )
      ORDER BY u.email`,
    [FIXTURE_IDS.users],
  );
  return rows;
}

/**
 * Rows the fixtures did not write, counted per table.
 *
 * `<> ALL($1)` over an empty array is true for every row, which is the answer
 * we want: a table the fixtures write nothing into is a table where everything
 * present is somebody else's.
 */
export async function surveyForeignRows(tx, { exceptUsers = [] } = {}) {
  const found = [];
  for (const [table, ids] of Object.entries(FIXTURE_IDS)) {
    // The administrators being carried through are not foreign — they are the
    // one thing this script knows how to keep.
    const known = table === "users" ? [...ids, ...exceptUsers] : ids;
    const { rows } = await tx.query(
      `SELECT count(*)::int AS count FROM ${table} WHERE id <> ALL($1)`,
      [known],
    );
    if (rows[0]?.count > 0) found.push({ table, count: rows[0].count });
  }
  return found;
}

/**
 * How the demonstration's rows are found, table by table, in the order the
 * foreign keys require.
 *
 * This replaced `TRUNCATE`, and the reason is the whole point of the flag: the
 * seed no longer needs to know what is safe to destroy, because it can ask. A
 * truncate empties a table; this empties the demonstration and leaves whatever
 * else is in there alone. A real market, its learners, its placements and its
 * money are not "preserved" — they are never named by any statement here.
 *
 * The order is `TABLES`, which is already children-first, and it has to be:
 * almost every foreign key to `markets` is `RESTRICT`, so the markets
 * themselves go last and anything pointing at them goes before.
 *
 * **Seven tables are deliberately absent.** `uploaded_files`, `sessions`,
 * `sign_in_codes`, `mfa_challenges`, `user_passwords`, `user_totp` and
 * `user_recovery_codes` carry no market and reach one only through a user, a
 * student or an application — every one of those foreign keys is `ON DELETE
 * CASCADE`, so a demonstration learner's upload and a fixture account's
 * password go when the row they hang off goes. A real administrator's password
 * stays because their `users` row is never deleted, which is also why the
 * capture-and-restore this file used to do is gone: nothing is being carried
 * over a truncate any more, because there is no truncate.
 *
 * `seed.test.ts` asserts this list plus those seven accounts for every table in
 * `TABLES`, so a table added to the schema cannot quietly go unhandled.
 */
const byMarket = (table) => ({
  table,
  sql: `DELETE FROM ${table} WHERE market_id = ANY($1)`,
  params: ({ markets }) => [markets],
});

export const CASCADED_TABLES = [
  // Reached through the student and the application it hangs off, both of which
  // are deleted below, both `ON DELETE CASCADE`. The fixtures never write one.
  "uploaded_files",
];

const byUser = (table) => ({
  table,
  sql: `DELETE FROM ${table} WHERE user_id = ANY($1)`,
  params: ({ users }) => [users],
});

export const DEMO_DELETES = [
  // The demonstration's own history. Deletable only because migration 0019
  // exempts rows in a market flagged `is_demo_data` — a real programme's audit
  // trail is refused as absolutely as it ever was, and an UPDATE is refused on
  // every row in the table including these.
  byMarket("audit_events"),
  // Credentials, first, because they hang off accounts rather than markets.
  //
  // These used to be reached by the cascade from `users`, and are named now
  // that `users` is never deleted. For a fixture account they clear nothing —
  // the seed writes no credential of any kind, deliberately. They exist for
  // `--replace-admins`, where the account cannot be deleted (an audit event
  // naming it as the actor restricts that) and so what has to go instead is
  // everything that account could sign in with.
  byUser("sessions"),
  byUser("sign_in_codes"),
  byUser("mfa_challenges"),
  byUser("user_passwords"),
  byUser("user_totp"),
  byUser("user_recovery_codes"),
  byMarket("notification_outbox"),
  byMarket("region_definitions"),
  byMarket("host_offers"),
  byMarket("outcomes"),
  byMarket("consents"),
  byMarket("funding_commitments"),
  byMarket("funding_sources"),
  {
    // No market of its own; it is a join between an award and an application.
    // Reached through the award, which has one — and which `RESTRICT`s from
    // `applications`, so this must go before them both.
    table: "credit_award_applications",
    sql: `DELETE FROM credit_award_applications
           WHERE credit_award_id IN (SELECT id FROM credit_awards WHERE market_id = ANY($1))`,
    params: ({ markets }) => [markets],
  },
  byMarket("credit_awards"),
  byMarket("time_entries"),
  byMarket("applications"),
  byMarket("interview_slots"),
  byMarket("mentorship_pairings"),
  byMarket("mentorship_offers"),
  byMarket("postings"),
  byMarket("students"),
  {
    // Two ways a membership belongs to the demonstration, and the second is not
    // optional: an administrator's membership has a null market by constraint,
    // so `market_id = ANY(...)` would never match the fixture administrator and
    // the `users` delete below would then fail on the foreign key.
    table: "memberships",
    sql: `DELETE FROM memberships WHERE market_id = ANY($1) OR user_id = ANY($2)`,
    params: ({ markets, users }) => [markets, users],
  },
  byMarket("market_colleges"),
  byMarket("organizations"),
];

/**
 * Tables the demonstration keeps rather than rebuilds, and why they cannot be
 * anything else.
 *
 * `audit_events` is append-only, enforced by a `BEFORE UPDATE OR DELETE`
 * trigger that raises. That is deliberate — `SECURITY.md` names audit tampering
 * as one of the findings this project treats as most serious — and it means the
 * old `TRUNCATE` was getting around the guard rather than respecting it, since
 * truncation does not fire row triggers. Deleting a demonstration's history is
 * exactly what the trigger exists to refuse, so this does not.
 *
 * `markets` and `users` follow from it: `audit_events.market_id` and
 * `audit_events.actor_user_id` are both `ON DELETE RESTRICT`, so once the
 * application has written a single audit row, neither can be deleted at all.
 *
 * So the fixtures upsert them instead. Their ids are fixed, so a re-seed
 * refreshes the row in place and everything hanging off it is rebuilt around
 * it. The visible consequence is the honest one: **a demonstration's audit
 * history accumulates rather than resetting**, and `seedInto` declines to write
 * a second copy of the same fixture history on top of it.
 */
export const PRESERVED_TABLES = ["markets", "users"];

/** The markets this database says are the demonstration. */
export async function demonstrationMarketIds(tx) {
  const { rows } = await tx.query(`SELECT id FROM markets WHERE is_demo_data`);
  return rows.map((row) => row.id);
}

/**
 * Remove the demonstration, and only the demonstration.
 *
 * Returns what it deleted, per table, so the command can print it — a re-seed
 * that says what it removed is one whose blast radius a person can check
 * against what they expected.
 */
export async function clearDemonstration(tx, { markets, users }) {
  // Before anything is removed: take the demonstration's markets back out of
  // `live`.
  //
  // A market names its board, and `markets.board_id` drops to null when that
  // organization goes — at which point `live_market_has_board` refuses the row.
  // So the board cannot be deleted while the market it runs is live. `seedInto`
  // already knows this from the other direction: it inserts markets as
  // `configuring` with no board and corrects them once the organizations exist.
  // This is the same dance run backwards, and it is why the clear cannot simply
  // be a list of deletes.
  await tx.query(
    `UPDATE markets SET stage = 'configuring', board_id = NULL WHERE id = ANY($1)`,
    [markets],
  );

  const removed = [];
  for (const { table, sql, params } of DEMO_DELETES) {
    const result = await tx.query(sql, params({ markets, users }));
    const count = result.rowCount ?? 0;
    if (count > 0) removed.push({ table, count });
  }
  return removed;
}

/**
 * Clear the demonstration and load the fixtures.
 *
 * Takes a transaction rather than opening one, so the whole thing is one unit —
 * a database cleared but not re-seeded is worse than either end state — and so
 * that it can be exercised against a real Postgres by the integration suite
 * rather than only through the command.
 *
 * There is no refusal any more, and no `--force`. Both existed because this
 * script truncated and so could not tell a fixture from somebody's work; it can
 * now, and a guard that fires on every real deployment is a guard whose
 * override becomes the command everybody types. What it reports instead is what
 * it left alone.
 */
export async function reseedInto(tx, { replaceAdmins = false } = {}) {
  const admins = await findRealAdmins(tx);
  const replaced = replaceAdmins ? admins : [];

  const markets = await demonstrationMarketIds(tx);
  const removed = await clearDemonstration(tx, {
    markets,
    users: [...FIXTURE_IDS.users, ...replaced.map((a) => a.id)],
  });

  await seedInto(tx);

  const untouched = await surveyForeignRows(tx, {
    exceptUsers: admins.map((a) => a.id),
  });
  return { preserved: replaceAdmins ? [] : admins, replaced, removed, untouched };
}

export async function seedInto(tx, { auditEvents = true } = {}) {
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
      // `is_demo_data` is written here and nowhere else in the system. The
      // seed is what makes these markets fictional, so the seed is what says
      // so — and because the application has no write path to `markets`, this
      // statement is the only thing in the product that can set it.
      `INSERT INTO markets (id, name, city, stage, board_id,
         launched_on, program_year, is_demo_data)
       VALUES ($1,$2,$3,'configuring',NULL,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name, city = EXCLUDED.city,
              stage = 'configuring', board_id = NULL,
              launched_on = EXCLUDED.launched_on,
              program_year = EXCLUDED.program_year,
              is_demo_data = EXCLUDED.is_demo_data`,
      [
        market.id,
        market.name,
        market.city,
        market.launchedOn,
        market.programYear,
        market.isDemoData,
      ],
    );
  }

  // The boundary each market's figures are measured against. Loaded straight
  // after the markets they belong to and before anything that reads one.
  for (const region of seed.regionDefinitions) {
    await insert(
      `INSERT INTO region_definitions (id, market_id, state, counties,
         effective_from, source, recorded_by, recorded_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        region.id,
        region.marketId,
        region.state,
        region.counties,
        region.effectiveFrom,
        region.source ?? null,
        region.recordedByUserId,
        region.recordedOn,
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
    // Upserted rather than inserted: `audit_events.actor_user_id` is
    // ON DELETE RESTRICT, so a fixture account that has ever acted cannot be
    // removed and re-created. Its id is fixed, so refreshing it in place is the
    // same end state.
    await insert(
      `INSERT INTO users (id, name, email) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email`,
      [
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

  // Skipped on a re-seed that found history already there — `audit_events`
  // refuses deletes, so writing a second copy could never be undone.
  for (const event of auditEvents ? seed.auditEvents : []) {
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

/** `--force` and `--replace-admins`, and nothing else. */
export function parseArgs(argv) {
  const known = new Set(["--replace-admins"]);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    // `--force` is named rather than lumped in with any typo, because it was a
    // documented flag and somebody following an old note deserves to be told it
    // is gone and why, not that it was misspelled.
    const why =
      unknown[0] === "--force"
        ? `--force is gone. Seeding no longer destroys anything outside the ` +
          `demonstration's own markets, so there is nothing left to force past.`
        : `unrecognised argument ${unknown[0]}. This command takes --replace-admins.`;
    throw new SeedRefused(why);
  }
  return { replaceAdmins: argv.includes("--replace-admins") };
}

async function main() {
const pool = await connect();
try {
  // Inside the try so that an unrecognised flag is presented as the same
  // one-line refusal as everything else here, rather than as a stack trace
  // from an unhandled rejection.
  const args = parseArgs(process.argv.slice(2));
  const client = await pool.connect();
  let outcome;
  try {
    // One transaction: a half-seeded database is worse than an empty one,
    // because it looks like it worked. The survey runs inside it too, so the
    // refusal is decided against the same snapshot the truncate would act on.
    await client.query("BEGIN");
    outcome = await reseedInto(client, args);
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
       (SELECT count(*) FROM region_definitions) AS region_definitions,
       (SELECT count(*) FROM consents)           AS consents,
       (SELECT count(*) FROM funding_sources)    AS funding_sources,
       (SELECT count(*) FROM funding_commitments) AS funding_commitments,
       (SELECT count(*) FROM audit_events)       AS audit_events`,
  );
  console.log("seeded:");
  for (const [table, count] of Object.entries(rows[0])) {
    console.log(`  ${String(count).padStart(5)}  ${table}`);
  }

  if (outcome.preserved.length > 0) {
    const n = outcome.preserved.length;
    console.log(`\n${n} administrator${n === 1 ? "" : "s"} here, none of them touched:`);
    for (const admin of outcome.preserved) console.log(`  ${admin.name} <${admin.email}>`);
    console.log("\nUntouched — no statement here named them. You stay signed in.");
  }
  if (outcome.replaced.length > 0) {
    console.log("\nDestroyed, as --replace-admins asked:");
    for (const admin of outcome.replaced) console.log(`  ${admin.name} <${admin.email}>`);
    console.log("\n  npm run db:admin -- you@yourdomain.com --name \"Your Name\"");
  }
  if (outcome.removed.length > 0) {
    console.log("\nCleared from the demonstration's markets:");
    for (const { table, count } of outcome.removed) {
      console.log(`  ${String(count).padStart(5)}  ${table}`);
    }
  }
  if (outcome.untouched.length > 0) {
    // The reassurance that replaced the refusal. These rows were never named by
    // any statement this command ran.
    console.log("\nLeft alone — not the demonstration's:");
    for (const { table, count } of outcome.untouched) {
      console.log(`  ${String(count).padStart(5)}  ${table}`);
    }
  }
} catch (error) {
  if (error instanceof SeedRefused) {
    console.error(`\nRefused: ${error.message}`);
  } else {
    console.error("\nseed failed:", error.message ?? error);
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
}
