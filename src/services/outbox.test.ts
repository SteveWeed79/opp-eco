import { describe, it, expect, beforeEach, vi } from "vitest";
import { drainPending, deliveredNotifications, outboxFor } from "./outbox";
import { pendingNotifications } from "@/data/memory-store";

function reset() {
  pendingNotifications.length = 0;
  deliveredNotifications.length = 0;
}

const bookedForBoard = {
  marketId: "mkt-pittsburg",
  recipientUserId: "u-marcia",
  kind: "interview.booked.board",
  payload: { studentName: "Omar Haddad", postingTitle: "QA audit", startsAt: null },
};

describe("the notification outbox", () => {
  beforeEach(reset);

  it("sends what a transaction queued", async () => {
    pendingNotifications.push(bookedForBoard);

    const result = await drainPending();

    expect(result.sent).toBe(1);
    expect(pendingNotifications).toHaveLength(0);
  });

  it("keeps a record of what it sent, which dispatch alone does not", async () => {
    pendingNotifications.push(bookedForBoard);
    await drainPending();

    // The whole reason this module exists: `dispatch` drains its queue, so
    // without recording, nobody can answer "was the board actually told?".
    expect(deliveredNotifications).toHaveLength(1);
    expect(deliveredNotifications[0]).toMatchObject({
      state: "sent",
      kind: "interview.booked.board",
      recipientEmail: "mdelgado@sekwp.example.org",
    });
  });

  it("addresses an organization's contact when the recipient has no user", async () => {
    // The real case: an employer is a name and an email long before anyone
    // there has an account. Before this, every such message was undeliverable.
    pendingNotifications.push({
      marketId: "mkt-pittsburg",
      recipientUserId: "contact:org-frontier",
      recipientOrganizationId: "org-frontier",
      kind: "funding.authorized",
      payload: { studentName: "Nina Kowalski", hours: 240, rate: 20 },
    });

    const result = await drainPending();

    expect(result.sent).toBe(1);
    expect(deliveredNotifications[0].recipientEmail).toContain("@");
    expect(deliveredNotifications[0].recipientEmail).not.toBe("unknown");
  });

  it("records an unknown template as undeliverable rather than retrying forever", async () => {
    pendingNotifications.push({
      marketId: "mkt-pittsburg",
      recipientUserId: "u-marcia",
      kind: "nothing.like.this",
      payload: {},
    });

    await drainPending();

    // Not requeued: a missing template will never succeed, and a poison
    // message that retries forever blocks everything behind it.
    expect(pendingNotifications).toHaveLength(0);
    expect(deliveredNotifications[0].state).toBe("undeliverable");
  });

  it("scopes the outbox to one market", async () => {
    pendingNotifications.push(bookedForBoard, {
      ...bookedForBoard,
      marketId: "mkt-elsewhere",
    });
    await drainPending();

    expect(outboxFor("mkt-pittsburg").delivered).toHaveLength(1);
    expect(outboxFor(null).delivered).toHaveLength(2);
  });

  it("never throws, because the state change already committed", async () => {
    // A send that fails must not report a durable transition as a failure —
    // `drainPending` is awaited *after* the transaction commits.
    //
    // Breaking `console.info` breaks both the channel and the logger, which is
    // the point: this pins the whole function, not just the send loop. An
    // earlier version only guarded the loop and threw from the closing log.
    const boom = vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("channel exploded");
    });
    pendingNotifications.push(bookedForBoard);

    await expect(drainPending()).resolves.toBeDefined();

    boom.mockRestore();
  });
});
