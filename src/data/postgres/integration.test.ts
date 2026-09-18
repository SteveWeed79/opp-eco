/**
 * The suite that needs a real Postgres.
 *
 * Everything else in this directory is verified against a recording client,
 * which proves the statement text and nothing about whether Postgres accepts
 * it. That gap hid five separate faults until the schema was first applied for
 * real: a `citext` column whose extension was never created, two seeded
 * foreign keys pointing at users that do not exist, a pair of fixtures that
 * violated the app's own one-application-per-posting rule, and a verification
 * that could not be written because the acting user never reached the UPDATE.
 * None of them was visible in TypeScript. All of them stopped the first
 * migration and seed.
 *
 * So this runs the real thing: the migrations as `db:migrate` applies them,
 * the fixtures as `db:seed` loads them, and then every repository accessor,
 * for every role, compared against the in-memory implementation reading the
 * same fixtures. Parity is the assertion, because "the Postgres layer is
 * correct" and "the two layers are indistinguishable" are the same statement —
 * and the second one is checkable.
 *
 * Skipped without `TEST_DATABASE_URL`, so a checkout with no database still
 * runs the whole suite green. CI sets it against a container; locally:
 *
 *   TEST_DATABASE_URL=postgresql://user:password@localhost:5432/oppeco_test \
 *     npx vitest run src/data/postgres/integration.test.ts
 *
 * The database it names is **truncated and reseeded**. Never point it at one
 * whose contents matter.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import type { ActorContext, ActorRole } from "@/domain/types";
import { ConcurrencyError } from "../store";
import { repositories as memoryRepositories } from "../memory";
import { contextFor } from "../session";
import { systemContext } from "@/auth/system";
import { databaseConfig } from "./config";
import { createPostgresClient, type PostgresClient } from "./neon";
import { nodePostgresPool } from "./node-pg";
import { postgresNotificationQueue, readOnlyNotificationQueue } from "./outbox";
import { postgresRepositories } from "./repositories";
import { postgresStore } from "./store";
import { postgresAuthStore } from "@/auth/postgres-store";
import { createMemoryFileStore, type FileStore } from "@/services/uploads/storage";
import { postgresFileStore } from "@/services/uploads/postgres-store";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- plain JS operator script, which cannot import TypeScript
import { seedInto, reseedInto, TABLES } from "../../../scripts/seed.mjs";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- ditto
import { withLedgerInsert } from "../../../scripts/migrations.mjs";

const url = process.env.TEST_DATABASE_URL;

/** Present the skip as a skip rather than as a pass nobody reads. */
const withDatabase = url ? describe : describe.skip;

const MIGRATIONS = join(process.cwd(), "src", "data", "postgres", "migrations");

const LEDGER = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       text PRIMARY KEY,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);`;

let client: PostgresClient;

/**
 * Apply anything pending, exactly as `scripts/db.mjs` does.
 *
 * The ledger splice is imported rather than reimplemented: a test that applied
 * migrations its own way would prove the SQL runs and not that the runner
 * shipping alongside it does.
 */
async function migrate(): Promise<void> {
  await client.query(LEDGER);
  const applied = new Set(
    (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).map(
      (row) => row.name,
    ),
  );

  for (const name of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    const body = readFileSync(join(MIGRATIONS, name), "utf8");
    const checksum = createHash("sha256").update(body).digest("hex").slice(0, 16);
    await client.query(withLedgerInsert({ name, body, checksum }));
  }
}

/** Truncate and reload, in one transaction, the way the seed script does. */
async function reseed(): Promise<void> {
  await client.transaction(async (tx) => {
    await tx.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    await seedInto(tx as { query(text: string, params?: unknown[]): Promise<unknown> });
  });
}

beforeAll(async () => {
  // Guarded rather than relying on the runner to skip a file whose every
  // `describe` is skipped: this hook opens a connection, and without a
  // database configured there is nothing to open.
  if (!url) return;

  const config = databaseConfig({
    DATABASE_URL: url,
    // The store under test is the writable one; the read-only wrapper is a
    // `backend.ts` decision and is covered by its own tests.
    DATABASE_READ_ONLY: "false",
    DATABASE_MAX_CONNECTIONS: "4",
  });
  client = createPostgresClient(nodePostgresPool(config), config);
  await migrate();
  await reseed();
}, 60_000);

afterAll(async () => {
  await client?.end();
});

withDatabase("the schema", () => {
  it("applies every migration once, and records what it applied", async () => {
    const rows = await client.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM schema_migrations ORDER BY name",
    );
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

    expect(rows.map((r) => r.name)).toEqual(files);
    for (const row of rows) {
      const body = readFileSync(join(MIGRATIONS, row.name), "utf8");
      expect(
        createHash("sha256").update(body).digest("hex").slice(0, 16),
        `${row.name} was applied from different text than the file holds`,
      ).toBe(row.checksum);
    }
  });

  it("creates the extensions its columns depend on", async () => {
    // `users.email` is citext, and a schema that assumes an extension it does
    // not create fails on the first line of the first real migration.
    const rows = await client.query<{ data_type: string; udt_name: string }>(
      `SELECT data_type, udt_name FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'email'`,
    );
    expect(rows[0].udt_name).toBe("citext");
  });

  it("compares email addresses case-insensitively", async () => {
    const rows = await client.query(
      "SELECT id FROM users WHERE email = $1",
      ["EVANCE@VERDIGRIS.EXAMPLE.EDU"],
    );
    expect(rows).toHaveLength(1);
  });
});

withDatabase("the fixtures", () => {
  it("loads every table the demo reads", async () => {
    const [counts] = await client.query<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM markets)           AS markets,
         (SELECT count(*) FROM organizations)     AS organizations,
         (SELECT count(*) FROM users)             AS users,
         (SELECT count(*) FROM memberships)       AS memberships,
         (SELECT count(*) FROM students)          AS students,
         (SELECT count(*) FROM postings)          AS postings,
         (SELECT count(*) FROM applications)      AS applications,
         (SELECT count(*) FROM time_entries)      AS time_entries,
         (SELECT count(*) FROM mentorship_offers) AS mentorship_offers,
         (SELECT count(*) FROM mentorship_pairings) AS mentorship_pairings,
         (SELECT count(*) FROM credit_awards)     AS credit_awards`,
    );
    for (const [table, count] of Object.entries(counts)) {
      expect(Number(count), `${table} is empty`).toBeGreaterThan(0);
    }
  });

  it("seeds a verifier the users table actually has", async () => {
    // The seed attributed verifications to a literal `u-college`, which is not
    // a user — every student insert failed on the foreign key.
    const rows = await client.query<{ id: string }>(
      `SELECT s.id FROM students s
        WHERE s.verified_on IS NOT NULL AND s.verified_by IS NULL`,
    );
    expect(rows).toEqual([]);
  });
});

/**
 * Both implementations, for one role.
 *
 * The comparison is on the value the application would receive — redaction
 * included, because `forApplication` and the timesheet accessors narrow what
 * they return and a Postgres layer that returned a whole student would be a
 * disclosure bug rather than a mapping one.
 */
const ROLES: ActorRole[] = ["admin", "student", "business", "college", "board"];

/**
 * Compare two collections by content rather than by row order.
 *
 * Order is not part of the repository contract except where an accessor
 * documents one — the fixtures come back in the order they were authored, and
 * SQL comes back in the order its `ORDER BY` names. The accessors that *do*
 * promise an order are asserted on separately, below, in the order they
 * promise.
 */
function byId<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

withDatabase("parity with the in-memory layer", () => {
  const pg = () => postgresRepositories(client);

  /** Every accessor that takes nothing but an actor. */
  async function readAll(actor: ActorContext) {
    const of = async (repos: typeof memoryRepositories) => ({
      markets: await repos.markets.list(actor),
      organizations: await repos.organizations.list(actor),
      colleges: await repos.organizations.list(actor, { kind: "college" }),
      pendingVetting: await repos.organizations.pendingVetting(actor),
      students: await repos.students.list(actor),
      pendingVerification: await repos.students.pendingVerification(actor),
      postings: await repos.postings.list(actor),
      published: await repos.postings.published(actor),
      awaitingCollegeHelp: await repos.postings.awaitingCollegeHelp(actor),
      mentorshipOffers: await repos.mentorshipOffers.list(actor),
      openOffers: await repos.mentorshipOffers.openInMarket(actor),
      mentorshipPairings: await repos.mentorshipPairings.list(actor),
      applications: await repos.applications.list(actor),
      interviewSlots: await repos.interviewSlots.list(actor),
      openSlots: await repos.interviewSlots.open(actor),
      awaitingReview: await repos.timeEntries.awaitingReview(actor),
      creditAwards: await repos.creditAwards.list(actor),
      outcomes: await repos.outcomes.list(actor),
      hostOffers: await repos.hostOffers.list(actor),
      regionDefinitions: await repos.regionDefinitions.list(actor),
      consents: await repos.consents.list(actor),
      fundingSources: await repos.fundingSources.list(actor),
      fundingCommitments: await repos.fundingCommitments.list(actor),
      // Without their ids: the log's primary key is a bigserial the database
      // assigns, while the fixtures carry `evt-1`. Everything an audit entry
      // means — who, when, what moved, and whether it was an override — is
      // compared; the surrogate key is the one thing that cannot match and the
      // one thing nothing reads.
      auditEvents: (await repos.auditEvents.list(actor)).map(({ id, ...rest }) => {
        void id;
        return rest;
      }),
    });
    return { memory: await of(memoryRepositories), postgres: await of(pg()) };
  }

  it.each(ROLES)("reads the same collections as %s", async (role) => {
    const actor = contextFor(role);
    const { memory, postgres } = await readAll(actor);

    for (const key of Object.keys(memory) as (keyof typeof memory)[]) {
      if (key === "auditEvents") {
        expect(postgres[key], `${role}.${key}`).toEqual(memory[key]);
        continue;
      }
      expect(
        byId(postgres[key] as { id: string }[]),
        `${role}.${key}`,
      ).toEqual(byId(memory[key] as { id: string }[]));
    }
  });

  it.each(ROLES)("resolves the same records by id as %s", async (role) => {
    const actor = contextFor(role);
    const postgres = pg();

    // Ids come from the in-memory side deliberately: a Postgres layer that
    // returned nothing for a record the application can see would otherwise
    // agree with itself and pass.
    for (const market of await memoryRepositories.markets.list(actor)) {
      expect(await postgres.markets.find(actor, market.id)).toEqual(
        await memoryRepositories.markets.find(actor, market.id),
      );
    }
    for (const organization of await memoryRepositories.organizations.list(actor)) {
      expect(await postgres.organizations.find(actor, organization.id)).toEqual(
        await memoryRepositories.organizations.find(actor, organization.id),
      );
    }
    for (const posting of await memoryRepositories.postings.list(actor)) {
      expect(await postgres.postings.find(actor, posting.id)).toEqual(
        await memoryRepositories.postings.find(actor, posting.id),
      );
    }
    for (const offer of await memoryRepositories.mentorshipOffers.openInMarket(actor)) {
      expect(await postgres.mentorshipOffers.find(actor, offer.id)).toEqual(
        await memoryRepositories.mentorshipOffers.find(actor, offer.id),
      );
      expect(byId(await postgres.mentorshipPairings.forOffer(actor, offer.id))).toEqual(
        byId(await memoryRepositories.mentorshipPairings.forOffer(actor, offer.id)),
      );
    }
  });

  it.each(ROLES)("narrows per-record reads the same way as %s", async (role) => {
    const actor = contextFor(role);
    const postgres = pg();

    for (const application of await memoryRepositories.applications.list(actor)) {
      expect(
        await postgres.applications.find(actor, application.id),
        `${role}: application ${application.id}`,
      ).toEqual(await memoryRepositories.applications.find(actor, application.id));

      expect(
        await postgres.students.forApplication(actor, application),
        `${role}: student behind ${application.id}`,
      ).toEqual(await memoryRepositories.students.forApplication(actor, application));

      expect(
        await postgres.timeEntries.forApplication(actor, application.id),
        `${role}: hours on ${application.id}`,
      ).toEqual(
        // Not `byId`: this accessor promises newest week first, and both
        // layers must deliver it.
        await memoryRepositories.timeEntries.forApplication(actor, application.id),
      );
    }

    for (const student of await memoryRepositories.students.list(actor)) {
      expect(await postgres.students.find(actor, student.id)).toEqual(
        await memoryRepositories.students.find(actor, student.id),
      );
      expect(byId(await postgres.applications.forStudent(actor, student.id))).toEqual(
        byId(await memoryRepositories.applications.forStudent(actor, student.id)),
      );
      expect(await postgres.timeEntries.forStudent(actor, student.id)).toEqual(
        await memoryRepositories.timeEntries.forStudent(actor, student.id),
      );
      expect(byId(await postgres.creditAwards.forStudent(actor, student.id))).toEqual(
        byId(await memoryRepositories.creditAwards.forStudent(actor, student.id)),
      );
      expect(
        byId(await postgres.mentorshipPairings.forStudent(actor, student.id)),
      ).toEqual(
        byId(await memoryRepositories.mentorshipPairings.forStudent(actor, student.id)),
      );
      expect(byId(await postgres.outcomes.forStudent(actor, student.id))).toEqual(
        byId(await memoryRepositories.outcomes.forStudent(actor, student.id)),
      );
      expect(byId(await postgres.hostOffers.forStudent(actor, student.id))).toEqual(
        byId(await memoryRepositories.hostOffers.forStudent(actor, student.id)),
      );
      expect(byId(await postgres.consents.forStudent(actor, student.id))).toEqual(
        byId(await memoryRepositories.consents.forStudent(actor, student.id)),
      );
      expect(
        byId(await postgres.fundingCommitments.forStudent(actor, student.id)),
      ).toEqual(
        byId(await memoryRepositories.fundingCommitments.forStudent(actor, student.id)),
      );
    }

    for (const posting of await memoryRepositories.postings.list(actor)) {
      expect(byId(await postgres.applications.forPosting(actor, posting.id))).toEqual(
        byId(await memoryRepositories.applications.forPosting(actor, posting.id)),
      );
    }

    // Outcomes hang off applications, and the board's view of one is redacted
    // rather than withheld — which is exactly the shape of narrowing the two
    // layers disagreed about the first time this suite ran.
    for (const application of await memoryRepositories.applications.list(actor)) {
      expect(
        byId(await postgres.outcomes.forApplication(actor, application.id)),
      ).toEqual(
        byId(await memoryRepositories.outcomes.forApplication(actor, application.id)),
      );
      // The one accessor here that returns a single record or null rather than
      // a list, so `byId` would hide a disagreement about which of the two it
      // was. Compared directly for that reason.
      expect(await postgres.hostOffers.forApplication(actor, application.id)).toEqual(
        await memoryRepositories.hostOffers.forApplication(actor, application.id),
      );
      expect(
        byId(await postgres.fundingCommitments.forApplication(actor, application.id)),
      ).toEqual(
        byId(
          await memoryRepositories.fundingCommitments.forApplication(actor, application.id),
        ),
      );
    }

    // Money is stored in cents and read back in dollars, so a parity failure
    // here is a factor-of-100 bug rather than a scoping one — which is exactly
    // the kind that survives a unit test against a recording client.
    for (const market of await memoryRepositories.markets.list(actor)) {
      const fromPg = await postgres.fundingSources.forMarket(actor, market.id);
      const fromMemory = await memoryRepositories.fundingSources.forMarket(actor, market.id);
      expect(fromPg).toEqual(fromMemory);
      for (const source of fromMemory) {
        expect(byId(await postgres.fundingCommitments.forSource(actor, source.id))).toEqual(
          byId(await memoryRepositories.fundingCommitments.forSource(actor, source.id)),
        );
      }
    }
  });

  it.each(ROLES)("returns the queues in the order each promises, as %s", async (role) => {
    const actor = contextFor(role);
    const postgres = pg();

    // Oldest first: the week a student has waited longest on is the one to
    // clear, and a queue that reorders between requests is a queue nobody can
    // work through.
    const awaiting = await postgres.timeEntries.awaitingReview(actor);
    expect(awaiting.map((e) => e.weekStarting)).toEqual(
      [...awaiting].map((e) => e.weekStarting).sort(),
    );
    expect(awaiting).toEqual(await memoryRepositories.timeEntries.awaitingReview(actor));

    // Newest first, and the same sequence the fixtures produce.
    const events = await postgres.auditEvents.list(actor);
    expect(events.map((e) => e.at)).toEqual(
      [...events].map((e) => e.at).sort().reverse(),
    );
    expect(events.map((e) => e.entityId)).toEqual(
      (await memoryRepositories.auditEvents.list(actor)).map((e) => e.entityId),
    );

    // The college's queue leads with someone it can act on: a student who has
    // asked to be verified, rather than one who has not submitted yet.
    const waiting = await postgres.students.pendingVerification(actor);
    expect(waiting.map((s) => s.status)).toEqual(
      await memoryRepositories.students
        .pendingVerification(actor)
        .then((rows) => rows.map((s) => s.status)),
    );

    const slots = await postgres.interviewSlots.open(actor);
    expect(slots.map((s) => s.startsAt)).toEqual(
      [...slots].map((s) => s.startsAt).sort(),
    );
  });

  it("orders the same way on every call", async () => {
    // Without an ORDER BY, Postgres is free to return rows in any order it
    // likes — which shows up as a list that reshuffles between requests long
    // before it shows up as a test failure.
    const actor = contextFor("college");
    const postgres = pg();
    const once = await postgres.postings.list(actor);
    const twice = await postgres.postings.list(actor);
    expect(once.map((p) => p.id)).toEqual(twice.map((p) => p.id));
  });

  it("gives every role the boundary its market is measured against", async () => {
    // The loosest scope in the schema, and the assertion is that it really is
    // loose: a definition names nobody and holds no figure, and a boundary
    // somebody cannot see is a figure they cannot check. Pinned because the
    // reflex in this codebase is to narrow, and narrowing here would leave a
    // learner unable to find out what "in region" means.
    const postgres = pg();
    for (const role of ROLES) {
      for (const repos of [postgres, memoryRepositories]) {
        const rows = await repos.regionDefinitions.list(contextFor(role));
        expect(rows.length).toBeGreaterThan(0);
      }
    }
  });

  it("shows an employer its own host answers and nobody else's", async () => {
    // The parity assertions above compare the two layers against each other,
    // which two empty lists satisfy perfectly. This one pins that the employer
    // narrowing returns something and leaves something out, so a scoping rule
    // that quietly matched nothing could not pass as agreement.
    const postgres = pg();
    const actor = contextFor("business");
    const own = actor.membership.organizationId;

    for (const repos of [postgres, memoryRepositories]) {
      const rows = await repos.hostOffers.list(actor);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((o) => o.businessId === own)).toBe(true);
    }

    // And there is genuinely a row belonging to somebody else to be excluded,
    // or the assertion above proves nothing.
    const all = await postgres.hostOffers.list(contextFor("admin"));
    expect(all.some((o) => o.businessId !== own)).toBe(true);
  });

  it("strips the employer's note for the learner and the board, and keeps the answer", async () => {
    const postgres = pg();
    const seeded = await postgres.hostOffers.list(contextFor("admin"));
    const withNote = seeded.filter((o) => o.note);
    expect(withNote.length).toBeGreaterThan(0);

    // Everybody but the administrator and the author. The college is on this
    // list deliberately despite working the same cases — narrow by default,
    // because widening later costs nothing and un-disclosing is impossible.
    for (const role of ["student", "board", "college"] as const) {
      for (const repos of [postgres, memoryRepositories]) {
        const rows = await repos.hostOffers.list(contextFor(role));
        expect(rows.every((o) => o.note === undefined)).toBe(true);
        // The answer is not a secret from any of them. A learner knows
        // whether they were offered a job.
        expect(rows.every((o) => Boolean(o.answer))).toBe(true);
      }
    }

    // The employer that wrote it reads it back — a statement somebody cannot
    // read back is one they cannot correct — and so does the administrator.
    for (const role of ["business", "admin"] as const) {
      for (const repos of [postgres, memoryRepositories]) {
        const rows = await repos.hostOffers.list(contextFor(role));
        expect(rows.some((o) => o.note)).toBe(true);
      }
    }
  });

  it("refuses another market's records, whoever asks", async () => {
    const postgres = pg();
    const other = await client.query<{ id: string }>(
      `SELECT id FROM postings WHERE market_id <> $1 LIMIT 1`,
      [contextFor("college").membership.marketId],
    );
    // The fixtures may not have a second market with postings; the assertion is
    // only meaningful if they do.
    if (other.length === 0) return;

    for (const role of ROLES.filter((r) => r !== "admin")) {
      expect(await postgres.postings.find(contextFor(role), other[0].id)).toBeNull();
    }
  });
});

withDatabase("the write path", () => {
  /** A fresh database for each write case, so one cannot depend on another. */
  beforeAll(reseed);

  it("clears the free text on a purged learner's observations, and nobody else's", async () => {
    // The in-memory layer has this covered in `consent.test.ts`; this is the
    // half that only SQL can get wrong. Two UPDATEs with a `student_id`
    // predicate look obviously right and are exactly the shape that silently
    // touches every row when the predicate is dropped — so the assertion is
    // both that the learner's text is gone and that somebody else's is not.
    const store = postgresStore(client);
    const repos = postgresRepositories(client);
    const admin = contextFor("admin");

    const offers = await repos.hostOffers.list(admin);
    const mine = offers.find((o) => o.note)!;
    expect(mine).toBeTruthy();
    const theirs = offers.find((o) => o.note && o.studentId !== mine.studentId);
    expect(theirs).toBeTruthy();

    const student = (await repos.students.find(admin, mine.studentId))!;
    await store.transaction((uow) => {
      uow.purgeLearner({ ...student, name: "Purged", email: "" }, new Date().toISOString());
    });

    const after = await repos.hostOffers.list(admin);
    expect(after.find((o) => o.id === mine.id)?.note).toBeUndefined();
    expect(after.find((o) => o.id === theirs!.id)?.note).toBe(theirs!.note);

    // The answer itself survives. Purging anonymises rather than deletes, and
    // what survives is what the aggregates are computed from.
    expect(after.find((o) => o.id === mine.id)?.answer).toBe(mine.answer);

    for (const row of await repos.outcomes.forStudent(admin, mine.studentId)) {
      expect(row.detail).toBeUndefined();
    }
  });

  it("never lets a stale save blank an exit date", async () => {
    // `saveApplication` is last-write-wins for everything except this column,
    // which COALESCEs. A caller holding an application it loaded before 0016 —
    // or before the placement ended — would otherwise write `exited_on = NULL`
    // over a real date, and the follow-up clock would silently fall back to
    // `status_since` for that row with nothing to show it had happened.
    const store = postgresStore(client);
    const repos = postgresRepositories(client);
    const admin = contextFor("admin");

    const exited = (await repos.applications.list(admin)).find((a) => a.exitedOn)!;
    expect(exited).toBeTruthy();

    await store.transaction((uow) => {
      uow.saveApplication({ ...exited, exitedOn: undefined }, exited.version);
    });

    const after = await repos.applications.find(admin, exited.id);
    expect(after?.exitedOn).toBe(exited.exitedOn);
  });

  it("commits the row, its audit entry, and its notification together", async () => {
    const store = postgresStore(client);
    const actor = contextFor("college");
    const application = (await postgresRepositories(client).applications.list(actor))[0];

    await store.transaction((uow) => {
      uow.saveApplication({ ...application, status: "withdrawn" }, application.version);
      uow.appendAuditEvent({
        marketId: application.marketId,
        actorUserId: actor.user.id,
        actorRole: actor.membership.role,
        at: new Date().toISOString(),
        entityType: "application",
        entityId: application.id,
        from: application.status,
        to: "withdrawn",
        viaOverride: false,
      });
      uow.enqueueNotification({
        marketId: application.marketId,
        recipientUserId: actor.user.id,
        kind: "application.withdrawn",
        payload: {},
      });
    });

    const [row] = await client.query<{ status: string; version: number }>(
      "SELECT status, version FROM applications WHERE id = $1",
      [application.id],
    );
    expect(row.status).toBe("withdrawn");
    expect(row.version).toBe(application.version + 1);

    expect(
      await client.query("SELECT 1 FROM audit_events WHERE entity_id = $1", [application.id]),
    ).not.toHaveLength(0);
    expect(
      await client.query("SELECT 1 FROM notification_outbox WHERE kind = $1", [
        "application.withdrawn",
      ]),
    ).not.toHaveLength(0);
  });

  it("refuses a stale version, and leaves nothing behind", async () => {
    const store = postgresStore(client);
    const actor = contextFor("college");
    const application = (await postgresRepositories(client).applications.list(actor))[1];

    const before = await client.query("SELECT count(*) FROM audit_events");

    await expect(
      store.transaction((uow) => {
        uow.saveApplication({ ...application, status: "withdrawn" }, application.version + 99);
        uow.appendAuditEvent({
          marketId: application.marketId,
          actorUserId: actor.user.id,
          actorRole: actor.membership.role,
          at: new Date().toISOString(),
          entityType: "application",
          entityId: application.id,
          from: application.status,
          to: "withdrawn",
          viaOverride: false,
        });
      }),
    ).rejects.toBeInstanceOf(ConcurrencyError);

    const [row] = await client.query<{ status: string }>(
      "SELECT status FROM applications WHERE id = $1",
      [application.id],
    );
    expect(row.status).toBe(application.status);
    expect(await client.query("SELECT count(*) FROM audit_events")).toEqual(before);
  });

  it("writes a verification the schema will accept", async () => {
    // `students_verified_check` requires a verifier alongside the date, and
    // the store used to leave the column untouched — so the college's own
    // verification was the one transition a real database refused.
    const store = postgresStore(client);
    const actor = contextFor("college");
    const student = (await postgresRepositories(client).students.pendingVerification(actor))[0];
    expect(student, "the fixtures no longer have a student awaiting verification").toBeTruthy();

    await store.transaction((uow) => {
      uow.saveStudent(
        { ...student, status: "verified", verifiedOn: "2026-05-01" },
        actor.user.id,
      );
    });

    const [row] = await client.query<{ verified_by: string }>(
      "SELECT verified_by FROM students WHERE id = $1",
      [student.id],
    );
    expect(row.verified_by).toBe(actor.user.id);
  });

  it("rolls back every statement when one fails", async () => {
    const store = postgresStore(client);
    const actor = contextFor("college");
    const application = (await postgresRepositories(client).applications.list(actor))[2];

    await expect(
      store.transaction((uow) => {
        uow.saveApplication({ ...application, status: "withdrawn" }, application.version);
        // A market that does not exist: the foreign key rejects it, and the
        // application update in the same transaction must not survive.
        uow.appendAuditEvent({
          marketId: "mkt-does-not-exist",
          actorUserId: actor.user.id,
          actorRole: actor.membership.role,
          at: new Date().toISOString(),
          entityType: "application",
          entityId: application.id,
          from: application.status,
          to: "withdrawn",
          viaOverride: false,
        });
      }),
    ).rejects.toThrow();

    const [row] = await client.query<{ status: string }>(
      "SELECT status FROM applications WHERE id = $1",
      [application.id],
    );
    expect(row.status).toBe(application.status);
  });

  it("hands a queued notification to the dispatcher, organization contacts included", async () => {
    // A message to an employer, a college or a board is addressed to the
    // organization, because most of them have no user account. The column it
    // was written to referenced `users`, so the insert failed and took the
    // transition beside it down; the dispatcher then drained an in-memory
    // array that a Postgres deployment never filled. Both halves are here.
    const store = postgresStore(client);
    const queue = postgresNotificationQueue(client);
    const actor = contextFor("college");
    const [application] = await postgresRepositories(client).applications.list(actor);

    await store.transaction((uow) => {
      uow.enqueueNotification({
        marketId: application.marketId,
        recipientUserId: "contact:org-apex",
        recipientOrganizationId: "org-apex",
        kind: "posting.submitted",
        payload: { title: "Water quality data intern" },
      });
      uow.enqueueNotification({
        marketId: application.marketId,
        recipientUserId: actor.user.id,
        kind: "student.verified",
        payload: {},
      });
    });

    const waiting = await queue.pending(application.marketId);
    expect(waiting.map((n) => n.intent.kind)).toEqual(
      expect.arrayContaining(["posting.submitted", "student.verified"]),
    );
    const employerMessage = waiting.find((n) => n.intent.kind === "posting.submitted")!;
    expect(employerMessage.intent.recipientOrganizationId).toBe("org-apex");
    expect(employerMessage.intent.recipientUserId).toBe("contact:org-apex");
    expect(employerMessage.intent.payload).toEqual({
      title: "Water quality data intern",
    });
    // The columns this table always had and nobody read. Age is what an
    // operator acts on; depth was only ever a proxy for it.
    expect(employerMessage.attempts).toBe(0);
    expect(employerMessage.lastError).toBeNull();
    expect(Number.isNaN(Date.parse(employerMessage.queuedAt))).toBe(false);

    // Claiming empties the queue, the way a splice does — two instances
    // draining at once must not both send it.
    const claimed = await queue.take();
    expect(claimed.length).toBeGreaterThanOrEqual(2);
    expect(await queue.take()).toEqual([]);
    expect(await queue.pending(null)).toEqual([]);

    // A failure a retry could fix comes back, with the reason recorded.
    const returned = claimed.find((c) => c.intent.kind === "posting.submitted")!;
    await queue.requeue(returned, "connection reset");
    expect((await queue.pending(null)).map((n) => n.intent.kind)).toEqual([
      "posting.submitted",
    ]);
    const [row] = await client.query<{ last_error: string; attempts: number }>(
      "SELECT last_error, attempts FROM notification_outbox WHERE id = $1",
      [returned.id],
    );
    expect(row.last_error).toBe("connection reset");
    expect(row.attempts).toBe(1);
  });

  it("never claims a message on a read-only deployment", async () => {
    // Claiming marks a row sent, and a demonstration pointed at a shared
    // database must not mark someone else's messages as sent.
    const queue = readOnlyNotificationQueue(client);
    expect(await queue.take()).toEqual([]);
    expect((await queue.pending(null)).length).toBeGreaterThan(0);
  });

  it("lets Postgres itself refuse a read-only transaction", async () => {
    await expect(
      client.transaction(
        (tx) => tx.query("UPDATE applications SET status = 'withdrawn'"),
        { readOnly: true },
      ),
    ).rejects.toThrow(/read-only/i);
  });
});

withDatabase("uploaded files", () => {
  /**
   * The bytes survive the round trip, exactly.
   *
   * This is the assertion the change exists for. Files used to live in a `Map`
   * where a round trip is the identity function, so nothing could be wrong with
   * it; through Postgres they are base64 on the way in, `bytea` at rest, and
   * base64 on the way out, and any one of those steps can quietly mangle a byte
   * that no unit test with a recording client would notice.
   */
  const payload = () => {
    // Every byte value, so a truncation at 0x00 or a latin1 round trip through
    // something that should have stayed binary shows up as a mismatch rather
    // than as a shorter file that still looks plausible.
    const bytes = new Uint8Array(1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    return bytes;
  };

  const file = (studentId: string) => ({
    purpose: "resume" as const,
    filename: "resume.pdf",
    contentType: "application/pdf",
    bytes: 1024,
    uploadedBy: "u-alex",
    studentId,
    scan: "pending" as const,
  });

  /** A learner who exists in the seed, since the table has a foreign key. */
  const LEARNER = "stu-alex";

  async function freshStore(): Promise<FileStore> {
    await client.query("DELETE FROM uploaded_files");
    return postgresFileStore(client);
  }

  it("returns the same bytes it was given", async () => {
    const store = await freshStore();
    const data = payload();
    const stored = await store.put(file(LEARNER), data);

    const read = await store.get(stored.key);
    expect(read).not.toBeNull();
    expect(Buffer.from(read!.data).equals(Buffer.from(data))).toBe(true);
  });

  it("agrees with the in-memory store about the metadata it keeps", async () => {
    // Parity, the same way every repository accessor is checked: two layers
    // behind one contract only count as one contract if they answer alike.
    const pg = await freshStore();
    const memory = createMemoryFileStore();
    const data = payload();

    const a = await pg.put(file(LEARNER), data);
    const b = await memory.put(file(LEARNER), data);

    const shape = (f: typeof a) => ({ ...f, key: "<generated>", uploadedAt: "<then>" });
    expect(shape(a)).toEqual(shape(b));
    // The key is generated, not derived — so it must not be the filename, a
    // hash of the content, or anything else two stores would agree on.
    expect(a.key).not.toBe(b.key);
    expect(a.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("holds a file quarantined until a scan clears it", async () => {
    const store = await freshStore();
    const stored = await store.put(file(LEARNER), payload());
    expect((await store.metadata(stored.key))!.scan).toBe("pending");

    await store.markScanned(stored.key, "clean");
    expect((await store.metadata(stored.key))!.scan).toBe("clean");
  });

  it("refuses a scan status the application does not have", async () => {
    // The constraint is in the schema rather than only in the type, because a
    // migration, a script, or a future write path can all reach this table
    // without going through TypeScript.
    const store = await freshStore();
    const stored = await store.put(file(LEARNER), payload());
    await expect(
      client.query("UPDATE uploaded_files SET scan = 'probably-fine' WHERE key = $1", [
        stored.key,
      ]),
    ).rejects.toThrow();
  });

  it("removes a file outright", async () => {
    const store = await freshStore();
    const stored = await store.put(file(LEARNER), payload());
    await store.remove(stored.key);
    expect(await store.get(stored.key)).toBeNull();
    expect(await store.metadata(stored.key)).toBeNull();
  });

  it("takes every file about one learner, and says which", async () => {
    // What the retention purge calls. It has to be exhaustive and it has to be
    // scoped: a purge that missed a file would leave a named document behind,
    // and one that took too many would delete somebody else's.
    const store = await freshStore();
    const mine = await store.put(file(LEARNER), payload());
    const alsoMine = await store.put(file(LEARNER), payload());
    const theirs = await store.put(file("stu-jordan"), payload());

    const removed = await store.removeForStudent(LEARNER);
    expect(removed.sort()).toEqual([mine.key, alsoMine.key].sort());
    expect(await store.get(mine.key)).toBeNull();
    expect(await store.get(theirs.key)).not.toBeNull();
  });

  it("refuses a file for a learner who does not exist", async () => {
    // The foreign key, doing the job the application would otherwise have to
    // remember to do on every write path that ever touches this table.
    const store = await freshStore();
    await expect(store.put(file("s-nobody"), payload())).rejects.toThrow();
  });
});

withDatabase("saving a learner who is already verified", () => {
  it("keeps the attribution when the write is not a verification", async () => {
    // The bug this is here for: `saveStudent` took `verifiedBy` and wrote it
    // straight into the column, so any non-verification save sent null and
    // blanked it — which for a verified learner trips
    // `verification_is_attributable` and fails the whole write. It stayed
    // hidden because until a learner could edit their own profile, every
    // caller that saved a verified student *was* the verification, and because
    // the in-memory layer ignores the parameter, so parity agreed on nothing.
    await reseed();
    const college = contextFor("college");
    const verified = (await memoryRepositories.students.list(college)).find(
      (s) => s.status === "verified",
    )!;

    const store = postgresStore(client);
    await store.transaction((uow) => {
      uow.saveStudent({ ...verified, programOfStudy: "Welding Technology" }, null);
    });

    const [row] = await client.query<{ verified_by: string | null; program_of_study: string }>(
      "SELECT verified_by, program_of_study FROM students WHERE id = $1",
      [verified.id],
    );
    expect(row.program_of_study).toBe("Welding Technology");
    expect(row.verified_by).not.toBeNull();
  });

  it("still records a new verifier when the write is one", async () => {
    await reseed();
    const college = contextFor("college");
    const pending = (await memoryRepositories.students.list(college)).find(
      (s) => s.status !== "verified",
    )!;

    const store = postgresStore(client);
    await store.transaction((uow) => {
      uow.saveStudent(
        { ...pending, status: "verified", verifiedOn: new Date().toISOString() },
        "u-ellen",
      );
    });

    const [row] = await client.query<{ verified_by: string | null }>(
      "SELECT verified_by FROM students WHERE id = $1",
      [pending.id],
    );
    expect(row.verified_by).toBe("u-ellen");
  });
});

/**
 * The auth store, against the real thing.
 *
 * Nothing else covered this. `src/auth/postgres-store.ts` holds every
 * credential the platform has — passwords, one-time codes, sessions,
 * authenticator seeds, recovery codes — and until now the only thing that ever
 * exercised it was a person running a dev server against Postgres by hand. The
 * unit suite runs on the in-memory store, so a Postgres-only fault in here was
 * invisible until somebody signed in, and "somebody signs in" is the one path
 * that has no fallback.
 *
 * The assertions below are the ones only a real database can answer: that the
 * composite primary key keeps two purposes of code apart, that the upsert
 * guards do what their `WHERE` clauses claim, and that single use is the
 * database's property rather than the caller's.
 */
withDatabase("changing a work address", () => {
  /**
   * The narrow write behind account recovery.
   *
   * Here rather than alongside the service because the risk it carries is SQL
   * rather than logic: the statement has to reach the right row and leave the
   * name alone, and a recording client cannot tell you whether Postgres agrees.
   * The policy around it — who may call it, the reason, the domain rule, the
   * audit entry — is the service's, and is tested there.
   */
  it("moves the address and touches nothing else about the person", async () => {
    await reseed();
    const before = (await memoryRepositories.users.find("u-marcia"))!;

    const store = postgresStore(client);
    await store.transaction((uow) => {
      uow.changeUserEmail("u-marcia", "m.delgado@sekwp.example.org");
    });

    const [row] = await client.query<{ name: string; email: string }>(
      "SELECT name, email FROM users WHERE id = $1",
      ["u-marcia"],
    );
    expect(row.email).toBe("m.delgado@sekwp.example.org");
    // The reason this is `changeUserEmail` and not `saveUser`: recovering an
    // account must not be a way to rename the person it belongs to.
    expect(row.name).toBe(before.name);
  });

  it("leaves the old address free of the account, so sign-on cannot find it", async () => {
    await reseed();
    const store = postgresStore(client);
    await store.transaction((uow) => {
      uow.changeUserEmail("u-marcia", "m.delgado@sekwp.example.org");
    });

    // `users.email` is citext, so this is the case-insensitive comparison the
    // sign-on path makes — the old address must resolve to nobody.
    const stale = await client.query(
      "SELECT id FROM users WHERE email = $1",
      ["MDELGADO@SEKWP.EXAMPLE.ORG"],
    );
    expect(stale).toHaveLength(0);
  });
});

withDatabase("adding somebody to an organization", () => {
  it("lands the account and the membership together, or not at all", async () => {
    await reseed();
    const store = postgresStore(client);
    await store.transaction((uow) => {
      uow.addOrganizationMember(
        { id: "u-ray", name: "Ray Okonkwo", email: "rokonkwo@sekwp.example.org" },
        {
          id: "mem-ray",
          userId: "u-ray",
          organizationId: "org-sekwp",
          marketId: "mkt-pittsburg",
          role: "board",
        },
      );
    });

    const [row] = await client.query<{ name: string; role: string }>(
      `SELECT u.name, m.role FROM users u
         JOIN memberships m ON m.user_id = u.id
        WHERE u.id = $1`,
      ["u-ray"],
    );
    expect(row.name).toBe("Ray Okonkwo");
    expect(row.role).toBe("board");
  });

  it("rolls the account back when the membership is refused", async () => {
    // The reason this is one operation. `admin_is_cross_market` refuses a board
    // membership with no market, and a user row left behind by that refusal is
    // an account nobody can sign into and nobody can see — which is exactly the
    // half-landed state the pairing exists to prevent.
    await reseed();
    const store = postgresStore(client);
    await expect(
      store.transaction((uow) => {
        uow.addOrganizationMember(
          { id: "u-orphan", name: "Nobody", email: "nobody@sekwp.example.org" },
          {
            id: "mem-orphan",
            userId: "u-orphan",
            organizationId: "org-sekwp",
            marketId: null,
            role: "board",
          },
        );
      }),
    ).rejects.toBeTruthy();

    const rows = await client.query("SELECT id FROM users WHERE id = $1", ["u-orphan"]);
    expect(rows).toHaveLength(0);
  });

  it("refuses a second account on one address", async () => {
    // `users.email` is citext and unique, so the database is what stops two
    // people sharing a login rather than a check somebody has to remember.
    await reseed();
    const store = postgresStore(client);
    await expect(
      store.transaction((uow) => {
        uow.addOrganizationMember(
          { id: "u-dupe", name: "Someone Else", email: "MDELGADO@SEKWP.EXAMPLE.ORG" },
          {
            id: "mem-dupe",
            userId: "u-dupe",
            organizationId: "org-sekwp",
            marketId: "mkt-pittsburg",
            role: "board",
          },
        );
      }),
    ).rejects.toBeTruthy();
  });
});

withDatabase("the auth store", () => {
  const COLLEGE_USER = "u-ellen";
  const ADMIN_USER = "u-admin";

  const store = () => postgresAuthStore(client);

  /** Credentials only. The fixtures around them are left alone. */
  async function clearCredentials(): Promise<void> {
    for (const table of [
      "user_recovery_codes",
      "user_totp",
      "mfa_challenges",
      "user_passwords",
      "sign_in_codes",
      "sessions",
    ]) {
      await client.query(`DELETE FROM ${table}`);
    }
  }

  beforeEach(clearCredentials);

  describe("passwords", () => {
    it("round-trips a hash, and replaces it in place", async () => {
      const auth = store();
      await auth.putPassword({
        userId: COLLEGE_USER,
        hash: "scrypt$65536$8$1$c2FsdA$a2V5",
        updatedAt: "2026-06-01T12:00:00.000Z",
        mustChange: false,
      });

      const first = await auth.findPassword(COLLEGE_USER);
      expect(first?.hash).toBe("scrypt$65536$8$1$c2FsdA$a2V5");
      expect(first?.mustChange).toBe(false);

      // Upsert on the primary key rather than a second row: two live hashes for
      // one account is two passwords, and only one of them was intended.
      await auth.putPassword({
        userId: COLLEGE_USER,
        hash: "scrypt$65536$8$1$bmV3c2FsdA$bmV3a2V5",
        updatedAt: "2026-06-02T12:00:00.000Z",
        mustChange: true,
      });

      const second = await auth.findPassword(COLLEGE_USER);
      expect(second?.hash).toBe("scrypt$65536$8$1$bmV3c2FsdA$bmV3a2V5");
      expect(second?.mustChange).toBe(true);
      const [{ count }] = await client.query<{ count: string }>(
        "SELECT count(*) AS count FROM user_passwords WHERE user_id = $1",
        [COLLEGE_USER],
      );
      expect(Number(count)).toBe(1);
    });

    it("answers null for somebody who has none, which is a real state", async () => {
      // A board officer by design, and a new account that has not chosen one
      // yet. Both are answered by sending the person down a different path, so
      // this must be null rather than an error.
      expect(await store().findPassword(COLLEGE_USER)).toBeNull();
    });

    it("removes one", async () => {
      const auth = store();
      await auth.putPassword({
        userId: COLLEGE_USER,
        hash: "scrypt$65536$8$1$c2FsdA$a2V5",
        updatedAt: "2026-06-01T12:00:00.000Z",
        mustChange: false,
      });
      await auth.removePassword(COLLEGE_USER);
      expect(await auth.findPassword(COLLEGE_USER)).toBeNull();
    });
  });

  describe("one-time codes", () => {
    const code = (purpose: "sign_in" | "password_reset", hash: string) => ({
      userId: COLLEGE_USER,
      purpose,
      codeHash: hash,
      createdAt: "2026-06-01T12:00:00.000Z",
      expiresAt: "2026-06-01T12:10:00.000Z",
      attempts: 0,
      consumedAt: null,
    });

    it("keeps a sign-in code and a reset code apart", async () => {
      // The whole reason the primary key is `(user_id, purpose)`. Before it,
      // asking to reset a password silently invalidated the sign-in code
      // somebody was already holding — one person asked for both, and neither
      // should cancel the other.
      const auth = store();
      await auth.putSignInCode(code("sign_in", "hash-of-the-sign-in-code"));
      await auth.putSignInCode(code("password_reset", "hash-of-the-reset-code"));

      expect((await auth.findSignInCode(COLLEGE_USER, "sign_in"))?.codeHash).toBe(
        "hash-of-the-sign-in-code",
      );
      expect((await auth.findSignInCode(COLLEGE_USER, "password_reset"))?.codeHash).toBe(
        "hash-of-the-reset-code",
      );
    });

    it("replaces an outstanding code of the same purpose", async () => {
      const auth = store();
      await auth.putSignInCode(code("sign_in", "the-first-one"));
      await auth.recordCodeAttempt(COLLEGE_USER, "sign_in", 3);
      await auth.putSignInCode(code("sign_in", "the-second-one"));

      const found = await auth.findSignInCode(COLLEGE_USER, "sign_in");
      expect(found?.codeHash).toBe("the-second-one");
      // The attempt count comes back with it. A replacement that inherited the
      // old count would be dead on arrival after a few wrong guesses.
      expect(found?.attempts).toBe(0);
      expect(found?.consumedAt).toBeNull();
    });

    it("records attempts and consumption against the right purpose", async () => {
      const auth = store();
      await auth.putSignInCode(code("sign_in", "sign-in-hash"));
      await auth.putSignInCode(code("password_reset", "reset-hash"));

      await auth.recordCodeAttempt(COLLEGE_USER, "password_reset", 2);
      await auth.consumeSignInCode(
        COLLEGE_USER,
        "password_reset",
        "2026-06-01T12:05:00.000Z",
      );

      const reset = await auth.findSignInCode(COLLEGE_USER, "password_reset");
      expect(reset?.attempts).toBe(2);
      expect(reset?.consumedAt).toBe("2026-06-01T12:05:00.000Z");

      // Untouched, which is the point.
      const signIn = await auth.findSignInCode(COLLEGE_USER, "sign_in");
      expect(signIn?.attempts).toBe(0);
      expect(signIn?.consumedAt).toBeNull();
    });
  });

  describe("sessions", () => {
    const session = (id: string, userId = COLLEGE_USER) => ({
      id,
      userId,
      createdAt: "2026-06-01T12:00:00.000Z",
      expiresAt: "2026-06-02T00:00:00.000Z",
      lastSeenAt: "2026-06-01T12:00:00.000Z",
      revokedAt: null,
    });

    it("creates, finds and touches one", async () => {
      const auth = store();
      await auth.createSession(session("session-one"));
      expect((await auth.findSession("session-one"))?.userId).toBe(COLLEGE_USER);

      await auth.touchSession("session-one", "2026-06-01T13:30:00.000Z");
      expect((await auth.findSession("session-one"))?.lastSeenAt).toBe(
        "2026-06-01T13:30:00.000Z",
      );
    });

    it("revokes one, and does not un-revoke it later", async () => {
      // `AND revoked_at IS NULL` in the statement: a second revocation must not
      // move the timestamp, because the first one is when the session actually
      // stopped being usable and that is what an audit reads.
      const auth = store();
      await auth.createSession(session("session-two"));
      await auth.revokeSession("session-two", "2026-06-01T12:30:00.000Z");
      await auth.revokeSession("session-two", "2026-06-01T18:00:00.000Z");
      expect((await auth.findSession("session-two"))?.revokedAt).toBe(
        "2026-06-01T12:30:00.000Z",
      );
    });

    it("revokes every session for one account and nobody else's", async () => {
      // What signing in and changing a password both rely on: a stolen session
      // on another machine stops working.
      const auth = store();
      await auth.createSession(session("mine-one"));
      await auth.createSession(session("mine-two"));
      await auth.createSession(session("theirs", ADMIN_USER));

      await auth.revokeSessionsForUser(COLLEGE_USER, "2026-06-01T12:30:00.000Z");

      expect((await auth.findSession("mine-one"))?.revokedAt).not.toBeNull();
      expect((await auth.findSession("mine-two"))?.revokedAt).not.toBeNull();
      expect((await auth.findSession("theirs"))?.revokedAt).toBeNull();
    });
  });

  describe("the second factor", () => {
    const enrolment = (secret: string) => ({
      userId: ADMIN_USER,
      secret,
      createdAt: "2026-06-01T12:00:00.000Z",
      confirmedAt: null,
      lastCounter: null,
    });

    it("round-trips a secret and confirms it", async () => {
      const auth = store();
      await auth.putTotpEnrolment(enrolment("JBSWY3DPEHPK3PXP"));
      expect((await auth.findTotpEnrolment(ADMIN_USER))?.secret).toBe("JBSWY3DPEHPK3PXP");

      await auth.confirmTotpEnrolment(ADMIN_USER, "2026-06-01T12:01:00.000Z", 55_000_000);
      const confirmed = await auth.findTotpEnrolment(ADMIN_USER);
      expect(confirmed?.confirmedAt).toBe("2026-06-01T12:01:00.000Z");
      // A bigint column. Returned as a string by the driver unless it is
      // converted, and a counter compared as a string is a replay guard that
      // does not guard.
      expect(confirmed?.lastCounter).toBe(55_000_000);
      expect(typeof confirmed?.lastCounter).toBe("number");
    });

    it("replaces an abandoned enrolment and refuses to replace a live one", async () => {
      const auth = store();
      await auth.putTotpEnrolment(enrolment("AAAAAAAAAAAAAAAA"));
      // Started and never finished: fair game.
      await auth.putTotpEnrolment(enrolment("BBBBBBBBBBBBBBBB"));
      expect((await auth.findTotpEnrolment(ADMIN_USER))?.secret).toBe("BBBBBBBBBBBBBBBB");

      await auth.confirmTotpEnrolment(ADMIN_USER, "2026-06-01T12:01:00.000Z", 1);
      // Now somebody is relying on it. A stray call must not swap their
      // authenticator out from under them.
      await auth.putTotpEnrolment(enrolment("CCCCCCCCCCCCCCCC"));
      const after = await auth.findTotpEnrolment(ADMIN_USER);
      expect(after?.secret).toBe("BBBBBBBBBBBBBBBB");
      expect(after?.confirmedAt).not.toBeNull();
    });

    it("takes the recovery codes with the enrolment when it goes", async () => {
      const auth = store();
      await auth.putTotpEnrolment(enrolment("JBSWY3DPEHPK3PXP"));
      await auth.putRecoveryCodes([
        {
          id: "rc-1",
          userId: ADMIN_USER,
          codeHash: "hash-one",
          createdAt: "2026-06-01T12:00:00.000Z",
          usedAt: null,
        },
      ]);

      await auth.removeTotpEnrolment(ADMIN_USER);
      expect(await auth.findTotpEnrolment(ADMIN_USER)).toBeNull();
      // A recovery code that opens an account with no second factor left to
      // recover is just a password nobody remembers issuing.
      expect(await auth.unusedRecoveryCodes(ADMIN_USER)).toHaveLength(0);
    });

    it("replaces the whole batch of recovery codes rather than half of it", async () => {
      const auth = store();
      const batch = (ids: string[]) =>
        ids.map((id) => ({
          id,
          userId: ADMIN_USER,
          codeHash: `hash-${id}`,
          createdAt: "2026-06-01T12:00:00.000Z",
          usedAt: null,
        }));

      await auth.putRecoveryCodes(batch(["rc-1", "rc-2", "rc-3"]));
      await auth.putRecoveryCodes(batch(["rc-4", "rc-5"]));

      const live = await auth.unusedRecoveryCodes(ADMIN_USER);
      expect(live.map((c) => c.id).sort()).toEqual(["rc-4", "rc-5"]);
    });

    it("spends a recovery code once, in the database rather than the caller", async () => {
      const auth = store();
      await auth.putRecoveryCodes([
        {
          id: "rc-1",
          userId: ADMIN_USER,
          codeHash: "hash-one",
          createdAt: "2026-06-01T12:00:00.000Z",
          usedAt: null,
        },
      ]);

      await auth.useRecoveryCode("rc-1", "2026-06-01T12:05:00.000Z");
      expect(await auth.unusedRecoveryCodes(ADMIN_USER)).toHaveLength(0);

      // `AND used_at IS NULL` in the statement, so a second spend cannot move
      // the timestamp — two requests racing the same code cannot both find it
      // unused.
      await auth.useRecoveryCode("rc-1", "2026-06-01T18:00:00.000Z");
      const [row] = await client.query<{ used_at: Date }>(
        "SELECT used_at FROM user_recovery_codes WHERE id = $1",
        ["rc-1"],
      );
      expect(row.used_at.toISOString()).toBe("2026-06-01T12:05:00.000Z");
    });

    it("holds a challenge that is not a session, and counts its attempts", async () => {
      // A separate table rather than a flag on `sessions`, so a half-finished
      // sign-in is never one missed predicate away from a working login.
      const auth = store();
      await auth.createMfaChallenge({
        id: "challenge-one",
        userId: ADMIN_USER,
        createdAt: "2026-06-01T12:00:00.000Z",
        expiresAt: "2026-06-01T12:05:00.000Z",
        attempts: 0,
      });

      expect((await auth.findMfaChallenge("challenge-one"))?.userId).toBe(ADMIN_USER);
      await auth.recordMfaAttempt("challenge-one", 3);
      expect((await auth.findMfaChallenge("challenge-one"))?.attempts).toBe(3);

      await auth.deleteMfaChallenge("challenge-one");
      expect(await auth.findMfaChallenge("challenge-one")).toBeNull();

      // And nothing in `sessions` came of any of it.
      const [{ count }] = await client.query<{ count: string }>(
        "SELECT count(*) AS count FROM sessions",
      );
      expect(Number(count)).toBe(0);
    });
  });

  describe("who signs in how", () => {
    it("has the board on codes and everybody else on passwords", async () => {
      // The policy the whole feature rests on, read back out of the database
      // the deployment actually runs on rather than out of the fixtures.
      const rows = await client.query<{ kind: string; identity_mode: string }>(
        "SELECT DISTINCT kind, identity_mode FROM organizations ORDER BY kind",
      );
      const modes = Object.fromEntries(rows.map((r) => [r.kind, r.identity_mode]));
      expect(modes.board).toBe("email_code");
      expect(modes.college).toBe("password");
      expect(modes.business).toBe("password");
    });

    it("has no password row for a public employee", async () => {
      // Not "has an empty one" — has none. The seed puts no credential in this
      // table for a board officer, and there is nowhere else to put one.
      const [{ count }] = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM user_passwords p
           JOIN memberships m ON m.user_id = p.user_id
          WHERE m.role = 'board'`,
      );
      expect(Number(count)).toBe(0);
    });
  });
});

/**
 * What a re-seed is allowed to destroy.
 *
 * The statements are checkable against a recording client and are, in
 * `seed.test.ts`. What is not checkable there is whether Postgres agrees:
 * whether `<> ALL($1)` over a text array actually finds the foreign rows,
 * whether `SELECT *` hands back the column names the restore rebuilds its
 * INSERT from, and — the one that matters most — whether an administrator put
 * back after a `TRUNCATE ... CASCADE` still satisfies `admin_is_cross_market`
 * and the foreign keys. A fake client says yes to all of that regardless.
 *
 * The scenario is the one a deployment actually meets: `db:admin` created an
 * administrator, and somebody then re-ran `db:seed` to refresh the fixtures.
 */
withDatabase("re-seeding a database somebody is already using", () => {
  const ADMIN = { id: "u-realadmin", name: "A Real Administrator", email: "real@a-real-domain.org" };

  /**
   * A raw `pg` pool, deliberately, rather than the `PostgresClient` the rest of
   * this file uses.
   *
   * The operator scripts do not go through the Store — that is the
   * application's write path and is read-only by default — so they see the
   * driver's own result shape, `{ rows, fields }`, where `PostgresClient`
   * unwraps to `Row[]`. The restore rebuilds its INSERT from `fields`, so a
   * client that discarded them would test something this script never meets.
   */
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 2 });
  });

  afterAll(async () => {
    await pool.end();
    // The fixtures every other file in this suite reads are left as they were.
    await reseed();
  });

  async function makeRealAdmin(): Promise<void> {
    await client.query(`INSERT INTO users (id, name, email) VALUES ($1,$2,$3)`, [
      ADMIN.id,
      ADMIN.name,
      ADMIN.email,
    ]);
    await client.query(
      `INSERT INTO memberships (id, user_id, organization_id, market_id, role)
       VALUES ('mem-realadmin',$1,NULL,NULL,'admin')`,
      [ADMIN.id],
    );
    await client.query(
      `INSERT INTO user_passwords (user_id, password_hash, must_change) VALUES ($1,$2,true)`,
      [ADMIN.id, "scrypt$131072$8$1$salt$key"],
    );
    await client.query(
      `INSERT INTO user_totp (user_id, secret, confirmed_at, last_counter)
       VALUES ($1,'JBSWY3DPEHPK3PXP', now(), 99)`,
      [ADMIN.id],
    );
  }

  /** Exactly what `scripts/seed.mjs` `main()` wraps around it. */
  async function runSeed(options?: { force?: boolean; replaceAdmins?: boolean }) {
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      const outcome = await reseedInto(connection, options);
      await connection.query("COMMIT");
      return outcome;
    } catch (error) {
      await connection.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  beforeEach(async () => {
    await client.transaction(async (tx) => {
      await tx.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
      await seedInto(tx as { query(text: string, params?: unknown[]): Promise<unknown> });
    });
  });

  it("carries the administrator, their password and their authenticator through", async () => {
    await makeRealAdmin();

    const outcome = await runSeed();
    expect(outcome.preserved).toHaveLength(1);
    expect(outcome.preserved[0].email).toBe(ADMIN.email);

    const [row] = await client.query<{
      email: string;
      password_hash: string;
      must_change: boolean;
      secret: string;
      last_counter: string;
      role: string;
      market_id: string | null;
    }>(
      `SELECT u.email, p.password_hash, p.must_change, t.secret, t.last_counter,
              m.role, m.market_id
         FROM users u
         JOIN memberships m    ON m.user_id = u.id
         JOIN user_passwords p ON p.user_id = u.id
         JOIN user_totp t      ON t.user_id = u.id
        WHERE u.id = $1`,
      [ADMIN.id],
    );

    // Not "an administrator exists" — *this* credential, unchanged. A restore
    // that re-hashed or reset `must_change` would leave them holding a password
    // that no longer opens the door.
    expect(row).toBeDefined();
    expect(row.password_hash).toBe("scrypt$131072$8$1$salt$key");
    expect(row.must_change).toBe(true);
    expect(row.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(Number(row.last_counter)).toBe(99);
    expect(row.role).toBe("admin");
    expect(row.market_id).toBeNull();

    // And the fixtures landed alongside them rather than instead of them.
    const [{ count }] = await client.query<{ count: string }>(
      "SELECT count(*) AS count FROM markets",
    );
    expect(Number(count)).toBeGreaterThan(0);
  });

  it("revokes the session it did not carry", async () => {
    await makeRealAdmin();
    await client.query(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES ('sess-real',$1, now() + interval '1 day')`,
      [ADMIN.id],
    );

    await runSeed();

    // The password survives so they can sign in again; the session does not,
    // because it was issued against a database that no longer exists.
    const [{ count }] = await client.query<{ count: string }>(
      "SELECT count(*) AS count FROM sessions",
    );
    expect(Number(count)).toBe(0);
  });

  it("refuses, and destroys nothing, when a row is not the fixtures'", async () => {
    await client.query(
      `INSERT INTO users (id, name, email) VALUES ('u-realperson','A Real Learner','learner@a-real-school.edu')`,
    );

    await expect(runSeed()).rejects.toThrow(/users/);

    // The refusal is only worth anything if the transaction took nothing with
    // it on the way out.
    const [{ count }] = await client.query<{ count: string }>(
      "SELECT count(*) AS count FROM users WHERE id = 'u-realperson'",
    );
    expect(Number(count)).toBe(1);
  });

  it("refuses over a county list recorded against a seeded market", async () => {
    // The case this is really for: a board's WIOA counties are a phone call,
    // recorded through the admin console against a market that came from the
    // fixtures. Nothing else about that row looks real.
    await makeRealAdmin();
    await client.query(
      `INSERT INTO region_definitions
         (id, market_id, state, counties, effective_from, recorded_by, recorded_on)
       VALUES ('rd-real','mkt-pittsburg','KS',ARRAY['Crawford','Cherokee'],'2026-01-01',$1,'2026-01-01')`,
      [ADMIN.id],
    );

    await expect(runSeed()).rejects.toThrow(/region_definitions/);

    const [{ count }] = await client.query<{ count: string }>(
      "SELECT count(*) AS count FROM region_definitions WHERE id = 'rd-real'",
    );
    expect(Number(count)).toBe(1);
  });

  it("does not carry an account that also holds a market role", async () => {
    // Carrying the user while the truncate took the membership anchoring their
    // other role would leave half an account. It has to refuse instead.
    await makeRealAdmin();
    const [org] = await client.query<{ id: string }>(
      "SELECT id FROM organizations WHERE kind = 'college' LIMIT 1",
    );
    await client.query(
      `INSERT INTO memberships (id, user_id, organization_id, market_id, role)
       VALUES ('mem-alsocollege',$1,$2,'mkt-pittsburg','college')`,
      [ADMIN.id, org.id],
    );

    await expect(runSeed()).rejects.toThrow(/users/);
  });

  it("proceeds under --force, and still keeps the administrator", async () => {
    await makeRealAdmin();
    await client.query(
      `INSERT INTO users (id, name, email) VALUES ('u-realperson','A Real Learner','learner@a-real-school.edu')`,
    );

    const outcome = await runSeed({ force: true });

    expect(outcome.foreign).toContainEqual({ table: "users", count: 1 });
    expect(outcome.preserved).toHaveLength(1);

    const [gone] = await client.query<{ count: string }>(
      "SELECT count(*) AS count FROM users WHERE id = 'u-realperson'",
    );
    expect(Number(gone.count)).toBe(0);
    const [kept] = await client.query<{ count: string }>(
      "SELECT count(*) AS count FROM user_passwords WHERE user_id = $1",
      [ADMIN.id],
    );
    expect(Number(kept.count)).toBe(1);
  });

  it("drops the administrator under --replace-admins", async () => {
    await makeRealAdmin();

    const outcome = await runSeed({ replaceAdmins: true });

    expect(outcome.preserved).toEqual([]);
    expect(outcome.replaced).toHaveLength(1);
    const [{ count }] = await client.query<{ count: string }>(
      "SELECT count(*) AS count FROM users WHERE id = $1",
      [ADMIN.id],
    );
    expect(Number(count)).toBe(0);
  });

  it("is a no-op on a database holding only fixtures", async () => {
    const outcome = await runSeed();
    expect(outcome.foreign).toEqual([]);
    expect(outcome.preserved).toEqual([]);
  });
});

/**
 * The administrator sees one world at a time.
 *
 * `marketScope` returned `TRUE` for an administrator, which is right about
 * tenancy and wrong about truth: the console sums every market it can see, so
 * a deployment holding the demonstration beside a real programme reported
 * invented placements and invented money inside figures somebody takes to a
 * funder.
 *
 * Asserted here rather than only against generated text, because this is the
 * assertion a recording client cannot make: whether Postgres agrees that the
 * subquery excludes what it claims to.
 */
withDatabase("an administrator's world", () => {
  const admin = contextFor("admin");
  const viewingReal = { ...admin, viewingDemoData: false };

  beforeEach(async () => {
    await reseed();
  });

  it("sees the demonstration's markets when asking for the demonstration", async () => {
    const markets = await postgresRepositories(client).markets.list(admin);
    expect(markets.length).toBeGreaterThan(0);
    expect(markets.every((m) => m.isDemoData)).toBe(true);
  });

  it("sees nothing when asking for real programmes, because there are none", async () => {
    // Every seeded market is the demonstration, so this is the whole fixture
    // set correctly withheld. The number that matters is zero.
    const repositories = postgresRepositories(client);
    expect(await repositories.markets.list(viewingReal)).toEqual([]);
    expect(await repositories.organizations.list(viewingReal)).toEqual([]);
    expect(await repositories.students.list(viewingReal)).toEqual([]);
    expect(await repositories.applications.list(viewingReal)).toEqual([]);
    expect(await repositories.fundingSources.list(viewingReal)).toEqual([]);
  });

  it("agrees with the in-memory layer about both worlds", async () => {
    // Parity is the assertion everywhere else in this file, and it has to hold
    // for the new predicate too — the two layers disagreeing about which rows
    // are fictional is exactly how an invented figure reaches a real report.
    const pg = postgresRepositories(client);
    for (const actor of [admin, viewingReal]) {
      const fromSql = await pg.markets.list(actor);
      const fromMemory = await memoryRepositories.markets.list(actor);
      expect(fromSql.map((m) => m.id).sort()).toEqual(
        fromMemory.map((m) => m.id).sort(),
      );
    }
  });

  it("shows a real market to the system context and to nobody else by default", async () => {
    // The regression this guards: `systemContext()` is `contextFor("admin")`,
    // which views the demonstration — so narrowing the administrator quietly
    // narrowed every pre-auth lookup too, and a real workforce board's address
    // stopped resolving to the one-time code its officers sign in with.
    await client.query(
      "UPDATE markets SET is_demo_data = false WHERE id = 'mkt-emporia'",
    );
    const pg = postgresRepositories(client);

    const bySystem = await pg.markets.list(systemContext());
    expect(bySystem.map((m) => m.id)).toContain("mkt-emporia");
    // And it still sees the demonstration's, which is the point of "both".
    expect(bySystem.map((m) => m.id)).toContain("mkt-pittsburg");

    const byDemoAdmin = await pg.markets.list(admin);
    expect(byDemoAdmin.map((m) => m.id)).not.toContain("mkt-emporia");

    const byRealAdmin = await pg.markets.list(viewingReal);
    expect(byRealAdmin.map((m) => m.id)).toEqual(["mkt-emporia"]);
  });

  it("does not consult the flag for a role anchored to one market", async () => {
    // Every other role is pinned by their membership, so the question is
    // already answered for them. Flipping the field must change nothing.
    const college = contextFor("college");
    const pg = postgresRepositories(client);
    const asIs = await pg.students.list(college);
    const flipped = await pg.students.list({ ...college, viewingDemoData: false });
    expect(flipped.map((s) => s.id)).toEqual(asIs.map((s) => s.id));
    expect(asIs.length).toBeGreaterThan(0);
  });
});
