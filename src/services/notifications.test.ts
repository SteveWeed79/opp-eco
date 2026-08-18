import { describe, it, expect } from "vitest";
import {
  dispatch,
  render,
  type NotificationChannel,
  type RenderedNotification,
} from "./notifications";
import type { NotificationIntent } from "@/data/store";

function intent(over: Partial<NotificationIntent> = {}): NotificationIntent {
  return {
    marketId: "mkt-pittsburg",
    recipientUserId: "u-marcia",
    kind: "interview.booked.board",
    payload: {
      studentName: "Omar Haddad",
      postingTitle: "Web Developer Trainee",
      startsAt: "2026-08-09T19:00:00Z",
    },
    ...over,
  };
}

function recordingChannel(): NotificationChannel & { sent: RenderedNotification[] } {
  const sent: RenderedNotification[] = [];
  return {
    name: "recording",
    sent,
    async send(notification) {
      sent.push(notification);
    },
  };
}

describe("rendering", () => {
  it("resolves the recipient's real address", async () => {
    const rendered = (await render(intent()))!;
    expect(rendered.recipientEmail).toContain("@");
  });

  it("names what happened and who it concerns", async () => {
    const rendered = (await render(intent()))!;
    expect(rendered.subject).toContain("Omar Haddad");
    expect(rendered.body).toContain("Web Developer Trainee");
  });

  it("returns nothing for an unknown template rather than sending an empty message", async () => {
    expect(await render(intent({ kind: "nonsense.kind" }))).toBeNull();
  });

  it("returns nothing for a recipient who does not exist", async () => {
    expect(await render(intent({ recipientUserId: "u-ghost" }))).toBeNull();
  });
});

describe("dispatch", () => {
  it("sends every queued intent and empties the queue", async () => {
    const channel = recordingChannel();
    const queue = [intent(), intent({ recipientUserId: "u-dana", kind: "interview.booked.employer" })];

    const result = await dispatch(queue, channel);

    expect(result.sent).toBe(2);
    expect(channel.sent).toHaveLength(2);
    expect(queue).toHaveLength(0);
  });

  it("requeues a failed send rather than losing it", async () => {
    const failing: NotificationChannel = {
      name: "failing",
      async send() {
        throw new Error("SMTP unavailable");
      },
    };
    const queue = [intent()];

    const result = await dispatch(queue, failing);

    expect(result.sent).toBe(0);
    expect(result.failed[0].error).toContain("SMTP unavailable");
    // Back on the queue for the next run.
    expect(queue).toHaveLength(1);
  });

  it("does not requeue something it can never deliver", async () => {
    const channel = recordingChannel();
    const queue = [intent({ kind: "nonsense.kind" })];

    const result = await dispatch(queue, channel);

    expect(result.undeliverable).toHaveLength(1);
    // Retrying a missing template would fail forever.
    expect(queue).toHaveLength(0);
  });

  it("lets one bad recipient through without blocking the rest", async () => {
    const channel = recordingChannel();
    const queue = [
      intent({ recipientUserId: "u-ghost" }),
      intent(),
      intent({ recipientUserId: "u-dana", kind: "interview.booked.employer" }),
    ];

    const result = await dispatch(queue, channel);

    expect(result.sent).toBe(2);
    expect(result.undeliverable).toHaveLength(1);
  });

  it("does not resend an intent enqueued while a batch was in flight", async () => {
    const queue = [intent()];
    const slow: NotificationChannel = {
      name: "slow",
      async send() {
        // Something else queues work mid-dispatch, as a concurrent request would.
        queue.push(intent({ recipientUserId: "u-dana", kind: "interview.booked.employer" }));
      },
    };

    const result = await dispatch(queue, slow);

    expect(result.sent).toBe(1);
    // The late arrival is still waiting, not swallowed by the drain.
    expect(queue).toHaveLength(1);
  });
});
