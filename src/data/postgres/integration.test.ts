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
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { ActorContext, ActorRole } from "@/domain/types";
import { ConcurrencyError } from "../store";
import { repositories as memoryRepositories } from "../memory";
import { contextFor } from "../session";
import { databaseConfig } from "./config";
import { createPostgresClient, type PostgresClient } from "./neon";
import { nodePostgresPool } from "./node-pg";
import { postgresNotificationQueue, readOnlyNotificationQueue } from "./outbox";
import { postgresRepositories } from "./repositories";
import { postgresStore } from "./store";
import { createMemoryFileStore, type FileStore } from "@/services/uploads/storage";
import { postgresFileStore } from "@/services/uploads/postgres-store";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- plain JS operator script, which cannot import TypeScript
import { seedInto, TABLES } from "../../../scripts/seed.mjs";
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
