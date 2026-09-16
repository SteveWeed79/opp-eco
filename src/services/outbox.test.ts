import { describe, it, expect, beforeEach, vi } from "vitest";
import { drainPending, deliveredNotifications, outboxFor } from "./outbox";
import { pendingNotifications } from "@/data/memory-store";
import type { NotificationIntent } from "@/data/store";

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

/**
 * A queue entry as the queue now holds one.
 *
 * The intent alone is no longer the whole row: a waiting message also carries
 * when it arrived, how many attempts have failed, and why — which is what lets
 * anything say "this has been stuck since Tuesday" rather than only "there are
 * four of them".
 */
const waiting = (intent: NotificationIntent, queuedAt = new Date().toISOString()) => ({
  intent,
  queuedAt,
  attempts: 0,
  lastError: null,
});

describe("the notification outbox", () => {
  beforeEach(reset);

  it("sends what a transaction queued", async () => {
    pendingNotifications.push(waiting(bookedForBoard));

    const result = await drainPending();

    expect(result.sent).toBe(1);
    expect(pendingNotifications).toHaveLength(0);
  });

  it("keeps a record of what it sent, which dispatch alone does not", async () => {
    pendingNotifications.push(waiting(bookedForBoard));
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
    pendingNotifications.push(
      waiting({
        marketId: "mkt-pittsburg",
        recipientUserId: "contact:org-frontier",
        recipientOrganizationId: "org-frontier",
        kind: "funding.authorized",
        payload: { studentName: "Nina Kowalski", hours: 240, rate: 20 },
      }),
    );

    const result = await drainPending();

    expect(result.sent).toBe(1);
    expect(deliveredNotifications[0].recipientEmail).toContain("@");
    expect(deliveredNotifications[0].recipientEmail).not.toBe("unknown");
  });

  it("records an unknown template as undeliverable rather than retrying forever", async () => {
    pendingNotifications.push(
      waiting({
        marketId: "mkt-pittsburg",
        recipientUserId: "u-marcia",
        kind: "nothing.like.this",
        payload: {},
      }),
    );

    await drainPending();

    // Not requeued: a missing template will never succeed, and a poison
    // message that retries forever blocks everything behind it.
    expect(pendingNotifications).toHaveLength(0);
    expect(deliveredNotifications[0].state).toBe("undeliverable");
  });

  it("scopes the outbox to one market", async () => {
    pendingNotifications.push(
      waiting(bookedForBoard),
      waiting({ ...bookedForBoard, marketId: "mkt-elsewhere" }),
    );
    await drainPending();

    expect((await outboxFor("mkt-pittsburg")).delivered).toHaveLength(1);
    expect((await outboxFor(null)).delivered).toHaveLength(2);
  });

  it("requeues a transient failure so it is retried", async () => {
    // The queue handed to `dispatch` is a throwaway single-element array, so
    // its own requeue lands somewhere that is never drained again. If this
    // stops holding, transient failures are silently dropped and the outbox
    // reports a message as failed that nothing will ever retry.
    const boom = vi
      .spyOn(console, "info")
      .mockImplementationOnce(() => {
        throw new Error("transient");
      });
    pendingNotifications.push(waiting(bookedForBoard));

    await drainPending();

    expect(pendingNotifications).toHaveLength(1);
    expect(deliveredNotifications[0].state).toBe("failed");
    boom.mockRestore();
  });

  it("does not requeue a permanent failure", async () => {
    // A reserved-domain address will never accept mail. Retrying it on every
    // subsequent drain would block the queue behind it forever.
    const permanent = Object.assign(new Error("reserved domain"), {
      name: "UndeliverableAddress",
    });
    const boom = vi.spyOn(console, "info").mockImplementationOnce(() => {
      throw permanent;
    });
    pendingNotifications.push(waiting(bookedForBoard));

    await drainPending();

    expect(pendingNotifications).toHaveLength(0);
    expect(deliveredNotifications[0].state).toBe("undeliverable");
    boom.mockRestore();
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
    pendingNotifications.push(waiting(bookedForBoard));

    await expect(drainPending()).resolves.toBeDefined();

    boom.mockRestore();
  });
});

describe("what a waiting message remembers", () => {
  beforeEach(reset);

  /** Force a transient failure the way the suite already does. */
  const failOnce = () =>
    vi.spyOn(console, "info").mockImplementationOnce(() => {
      throw new Error("transient");
    });

  it("keeps its original queued time across a retry", async () => {
    // The property that makes age worth measuring. Resetting the clock on
    // requeue would make a message that has failed for three days look like one
    // that arrived a minute ago — precisely the message an operator most needs
    // to see.
    const queuedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    pendingNotifications.push({
      intent: bookedForBoard,
      queuedAt,
      attempts: 0,
      lastError: null,
    });

    const boom = failOnce();
    await drainPending();
    boom.mockRestore();

    expect(pendingNotifications).toHaveLength(1);
    expect(pendingNotifications[0].queuedAt).toBe(queuedAt);
    expect(pendingNotifications[0].attempts).toBe(1);
    expect(pendingNotifications[0].lastError).toContain("transient");
  });

  it("counts attempts up rather than starting over", async () => {
    pendingNotifications.push({
      intent: bookedForBoard,
      queuedAt: new Date().toISOString(),
      attempts: 2,
      lastError: "earlier failure",
    });

    const boom = failOnce();
    await drainPending();
    boom.mockRestore();

    expect(pendingNotifications[0].attempts).toBe(3);
  });

  it("stamps a freshly queued message with now", async () => {
    const { store } = await import("@/data/backend");
    await store.transaction((uow) => {
      uow.enqueueNotification(bookedForBoard);
    });

    const [queued] = pendingNotifications;
    expect(queued.attempts).toBe(0);
    expect(queued.lastError).toBeNull();
    expect(Date.now() - new Date(queued.queuedAt).getTime()).toBeLessThan(5_000);
  });
});
