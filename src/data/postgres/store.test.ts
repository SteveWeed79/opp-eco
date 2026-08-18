/**
 * The write side, without a database.
 *
 * Two things matter here and neither is the SQL text. First, that everything a
 * unit of work stages lands in **one** transaction — a state change without its
 * audit record is unauditable, and a notification for a change that rolled back
 * is a lie. Second, that a versioned write which matches no row raises
 * `ConcurrencyError` rather than passing silently, because that is the only
 * thing standing between two board officers and a double-authorized placement.
 */

import { describe, it, expect } from "vitest";
import { postgresStore } from "./store";
import type { PostgresClient } from "./neon";
import { ConcurrencyError } from "../store";
import type { Application, AuditEvent, InterviewSlot } from "@/domain/types";

/**
 * A client that records what ran and lets a test decide what each statement
 * returns — which is how a version conflict is provoked exactly.
 */
function fakeClient(options: { rowsFor?: (text: string) => unknown[] } = {}) {
  const statements: { text: string; params: readonly unknown[] }[] = [];
  let transactions = 0;
  let committed = false;

  const client = {
    async query() {
      throw new Error("the store must not write outside a transaction");
    },
    async transaction<T>(work: (tx: { query: PostgresClient["query"] }) => Promise<T>) {
      transactions++;
      const result = await work({
        query: (async (text: string, params: readonly unknown[] = []) => {
          statements.push({ text, params });
          return (options.rowsFor?.(text) ?? [{ id: "ok" }]) as never;
        }) as PostgresClient["query"],
      });
      committed = true;
      return result;
    },
    async end() {},
  } as unknown as PostgresClient;

  return {
    store: postgresStore(client),
    statements,
    transactionCount: () => transactions,
    didCommit: () => committed,
    text: () => statements.map((s) => s.text).join("\n"),
  };
}

const application: Application = {
  id: "app-1",
  marketId: "mkt-1",
  postingId: "post-1",
  studentId: "stu-1",
  track: "standard",
  status: "funding_authorized",
  submittedOn: "2026-06-12T00:00:00.000Z",
  statusSince: "2026-07-01T00:00:00.000Z",
  matchScore: { score: 65, algorithmVersion: "match-v1", factors: [] },
  fundingAuthorizedHours: 210,
  fundingAuthorizedRate: 20,
  version: 4,
};

const auditEvent: Omit<AuditEvent, "id"> = {
  marketId: "mkt-1",
  at: "2026-08-18T09:00:00.000Z",
  actorUserId: "usr-board",
  actorRole: "board",
  entityType: "application",
  entityId: "app-1",
  from: "cleared",
  to: "funding_authorized",
  viaOverride: false,
};

describe("one transaction, or none", () => {
  it("puts the change, its audit record, and its message in a single transaction", async () => {
    const fake = fakeClient();

    await fake.store.transaction((uow) => {
      uow.saveApplication(application, 4);
      uow.appendAuditEvent(auditEvent);
      uow.enqueueNotification({
        marketId: "mkt-1",
        recipientUserId: "usr-1",
        kind: "funding_authorized",
        payload: { hours: 210 },
      });
    });

    expect(fake.transactionCount()).toBe(1);
    expect(fake.statements).toHaveLength(3);
    expect(fake.text()).toContain("UPDATE applications");
    expect(fake.text()).toContain("INSERT INTO audit_events");
    expect(fake.text()).toContain("INSERT INTO notification_outbox");
  });

  it("runs the work function before taking a connection", async () => {
    // Guards raise inside `work`. Opening a transaction first would hold a
    // connection open for writes that were never going to happen.
    const fake = fakeClient();

    await expect(
      fake.store.transaction(() => {
        throw new Error("guard refused the transition");
      }),
    ).rejects.toThrow("guard refused the transition");

    expect(fake.transactionCount()).toBe(0);
  });

  it("opens no transaction when nothing was staged", async () => {
    const fake = fakeClient();
    const result = await fake.store.transaction(() => "read-only work");

    expect(result).toBe("read-only work");
    expect(fake.transactionCount()).toBe(0);
  });

  it("returns what the unit of work returned", async () => {
    const fake = fakeClient();
    const result = await fake.store.transaction((uow) => {
      uow.appendAuditEvent(auditEvent);
      return { moved: true };
    });
    expect(result).toEqual({ moved: true });
  });
});

describe("optimistic concurrency", () => {
  it("raises when a versioned update matches no row", async () => {
    // The row moved under the caller: someone else wrote it first.
    const fake = fakeClient({ rowsFor: (text) => (text.includes("UPDATE applications") ? [] : [{}]) });

    await expect(
      fake.store.transaction((uow) => {
        uow.saveApplication(application, 4);
      }),
    ).rejects.toThrow(ConcurrencyError);
  });

  it("names the entity so the message can be shown to a person", async () => {
    const fake = fakeClient({ rowsFor: () => [] });

    await expect(
      fake.store.transaction((uow) => {
        uow.saveApplication(application, 4);
      }),
    ).rejects.toThrow(/Application app-1 was changed by someone else/);
  });

  it("takes the whole batch down with it", async () => {
    // The audit entry must not survive a change that did not happen.
    const fake = fakeClient({
      rowsFor: (text) => (text.includes("UPDATE applications") ? [] : [{}]),
    });

    await expect(
      fake.store.transaction((uow) => {
        uow.saveApplication(application, 4);
        uow.appendAuditEvent(auditEvent);
      }),
    ).rejects.toThrow(ConcurrencyError);

    // It failed on the first statement, so the audit insert never ran — and
    // the surrounding transaction rolls back regardless.
    expect(fake.text()).not.toContain("INSERT INTO audit_events");
  });

  it("checks the version in the statement, not before it", async () => {
    const fake = fakeClient();
    await fake.store.transaction((uow) => uow.saveApplication(application, 4));

    const update = fake.statements[0];
    expect(update.text).toMatch(/WHERE id = \$\d+ AND version = \$\d+/);
    expect(update.text).toContain("RETURNING id");
    expect(update.params).toContain(4);
  });

  it("guards an interview slot the same way", async () => {
    // Two students racing for the last slot: the loser is told, not overwritten.
    const slot: InterviewSlot = {
      id: "slot-1",
      marketId: "mkt-1",
      boardId: "org-board",
      startsAt: "2026-08-19T19:00:00.000Z",
      durationMinutes: 30,
      officerName: "Marcia Delgado",
      bookedByStudentId: "stu-1",
      bookedAt: "2026-08-18T00:00:00.000Z",
      meetingUrl: null,
      version: 1,
    };
    const fake = fakeClient({ rowsFor: () => [] });

    await expect(
      fake.store.transaction((uow) => uow.saveInterviewSlot(slot, 1)),
    ).rejects.toThrow(/Interview slot slot-1/);
  });

  it("does not version-check writes with a single desk", async () => {
    // A posting is reviewed by one college and an offer written by one
    // employer, so there is no second writer for a version check to catch.
    const fake = fakeClient({ rowsFor: () => [] });

    await expect(
      fake.store.transaction((uow) => {
        uow.savePosting({
          id: "post-1",
          marketId: "mkt-1",
          businessId: "org-apex",
          track: "standard",
          title: "Software Engineering Intern",
          description: "",
          county: "Crawford",
          skillsRequired: [],
          skillsPreferred: [],
          status: "published",
          openings: 1,
          createdOn: "2026-05-01T00:00:00.000Z",
        });
      }),
    ).resolves.toBeUndefined();
  });
});

describe("money crosses the boundary as cents", () => {
  it("writes an authorized rate in cents, not dollars", async () => {
    const fake = fakeClient();
    await fake.store.transaction((uow) => uow.saveApplication(application, 4));

    // $20/hour is 2000 cents. Writing 20 would understate every claim in the
    // program by a factor of a hundred.
    expect(fake.statements[0].params).toContain(2000);
    expect(fake.statements[0].params).not.toContain(20);
  });

  it("keeps an unset amount null rather than zero", async () => {
    const fake = fakeClient();
    await fake.store.transaction((uow) =>
      uow.saveApplication({ ...application, fundingAuthorizedRate: undefined }, 4),
    );
    // Zero would read back as an authorized rate of $0, which the funding
    // guard would treat as a real authorization.
    expect(fake.statements[0].params).toContain(null);
  });
});
