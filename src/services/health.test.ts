import { describe, expect, it } from "vitest";
import { healthReport, worstOf, EXPECTED_MIGRATION, STUCK_AFTER_MS } from "./health";
import * as seed from "@/data/seed";

describe("an overall verdict", () => {
  it("is the worst of its parts, not an average", () => {
    // A system with nine working checks and one broken one is broken. Averaging
    // is how a dashboard stays green through an incident.
    expect(worstOf(["ok", "ok", "ok"])).toBe("ok");
    expect(worstOf(["ok", "degraded", "ok"])).toBe("degraded");
    expect(worstOf(["ok", "degraded", "failing"])).toBe("failing");
    expect(worstOf([])).toBe("ok");
  });
});

describe("the report", () => {
  it("covers the things that have actually failed quietly here", async () => {
    const report = await healthReport();
    expect(report.checks.map((c) => c.name).sort()).toEqual([
      "data",
      "notifications",
      "schema",
      "sign-on",
      "uploads",
    ]);
  });

  it("is honest that the demo persists nothing", async () => {
    // Not a fault, and the check says so rather than reporting a healthy
    // database that does not exist. "Why did my change disappear" has this as
    // its answer.
    const report = await healthReport();
    const data = report.checks.find((c) => c.name === "data")!;
    expect(data.status).toBe("ok");
    expect(data.detail).toMatch(/fixtures/i);
  });

  it("has nothing to migrate without a database", async () => {
    const report = await healthReport();
    expect(report.checks.find((c) => c.name === "schema")!.status).toBe("ok");
  });

  it("calls a message that has waited too long stuck, not a queue that is deep", async () => {
    // Depth was a proxy while the queue carried no timestamp, and it answers
    // the wrong question: thirty draining steadily are healthy, one sitting
    // since Tuesday is not, and a count cannot tell them apart.
    const { pendingNotifications } = await import("@/data/memory-store");
    const intent = {
      marketId: "mkt-pittsburg",
      recipientUserId: "u-marcia",
      kind: "interview.booked.board",
      payload: {},
    };

    // Forty fresh ones: deep, and entirely fine.
    for (let i = 0; i < 40; i++) {
      pendingNotifications.push({
        intent,
        queuedAt: new Date().toISOString(),
        attempts: 0,
        lastError: null,
      });
    }
    try {
      expect(
        (await healthReport()).checks.find((c) => c.name === "notifications")!.status,
      ).toBe("ok");

      // One old one: shallow, and the thing worth waking somebody for.
      pendingNotifications.push({
        intent,
        queuedAt: new Date(Date.now() - 2 * STUCK_AFTER_MS).toISOString(),
        attempts: 3,
        lastError: "connection reset",
      });
      const check = (await healthReport()).checks.find(
        (c) => c.name === "notifications",
      )!;
      expect(check.status).toBe("degraded");
      expect(check.detail).toMatch(/waited \d+ minutes/);
    } finally {
      pendingNotifications.length = 0;
    }
  });

  it("says sending is off before it says the queue is fine", async () => {
    // The failure this exists for: an outbox full of "delivered" rows and a
    // mailbox nobody is filling look identical from a queue depth.
    const report = await healthReport();
    const notifications = report.checks.find((c) => c.name === "notifications")!;
    expect(notifications.detail).toMatch(/^Sending is (on|off)/);
  });

  it("names the stand-in scanner as a stand-in", async () => {
    const report = await healthReport();
    const uploads = report.checks.find((c) => c.name === "uploads")!;
    expect(uploads.detail).toMatch(/EICAR/);
  });

  it("stamps when it ran, because a cached verdict is a lie", async () => {
    const at = new Date("2026-03-04T05:06:07.000Z");
    expect((await healthReport(at)).checkedAt).toBe(at.toISOString());
  });

  it("expects a migration whose name it can state", () => {
    // The constant exists because this cannot list the migrations directory at
    // runtime. `migrations.test.ts` is what keeps it matching the last file.
    expect(EXPECTED_MIGRATION).toMatch(/^\d{4}_[a-z_]+\.sql$/);
  });
});

describe("what a health report may say", () => {
  it("never names a person, an address, or a record", async () => {
    // The rule the whole module is written around. This report is read by a
    // monitor, a status page and whoever is on call — none of which have the
    // access controls the database has, and under FERPA a log holding a
    // participant's details inherits the handling rules of the data itself.
    //
    // Asserted against every seeded person rather than a sample, because the
    // leak that matters is the one nobody thought to check for.
    const text = JSON.stringify(await healthReport());

    const people = [
      ...seed.users.map((u) => u.name),
      ...seed.users.map((u) => u.email),
      ...seed.students.map((s) => s.name),
      ...seed.students.map((s) => s.email),
    ].filter((value): value is string => Boolean(value));

    expect(people.length).toBeGreaterThan(10);
    for (const person of people) {
      expect(text).not.toContain(person);
    }
  });

  it("reports counts and settings rather than free text", async () => {
    // Free text is where a record's contents end up. Every detail here is a
    // sentence this codebase wrote, so none of them can quote one.
    const report = await healthReport();
    for (const check of report.checks) {
      expect(check.detail.length).toBeGreaterThan(0);
      expect(check.detail.length).toBeLessThan(200);
    }
  });
});
