/**
 * The notification outbox.
 *
 * `dispatch` drains its queue — that is correct for a sender, and useless for
 * oversight. Once a message is sent it is gone, so nobody can answer the
 * question an administrator actually asks: *was the board told, and when?*
 *
 * This wraps the dispatcher in a channel that records what it sends, so the
 * queue keeps its drain semantics and the record outlives it. In Postgres the
 * two are one outbox table with a `delivered_at` column; here they are a
 * pending array and a delivered array, which is the same shape with the
 * durability removed.
 *
 * Deliberately in-memory, and therefore per server instance and lost on
 * restart — the same caveat the rate limiter carries. Saying so is better than
 * implying a demo has a durable outbox.
 */

import { dispatch, render, type NotificationChannel } from "./notifications";
import { pendingNotifications } from "@/data/memory-store";
import type { NotificationIntent } from "@/data/store";
import { logger } from "./logging";

export type DeliveryState = "sent" | "failed" | "undeliverable";

export interface DeliveredNotification {
  recipientUserId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  kind: string;
  marketId: string;
  at: string;
  state: DeliveryState;
  /** Why it failed. Present only when `state` is not "sent". */
  error?: string;
}

/**
 * Newest first, and capped.
 *
 * An unbounded log in a long-lived process is a slow memory leak, and the
 * oversight value of the ten-thousandth message is nil.
 */
const MAX_RECORDS = 500;
export const deliveredNotifications: DeliveredNotification[] = [];

function record(entry: DeliveredNotification) {
  deliveredNotifications.unshift(entry);
  if (deliveredNotifications.length > MAX_RECORDS) {
    deliveredNotifications.length = MAX_RECORDS;
  }
}

/**
 * Sends, and remembers having sent.
 *
 * Still writes to the console, because a developer running the demo should see
 * the message without opening a portal.
 */
export function recordingChannel(marketId: string, kind: string): NotificationChannel {
  return {
    name: "recording",
    async send(notification) {
      record({
        ...notification,
        kind,
        marketId,
        at: new Date().toISOString(),
        state: "sent",
      });
      console.info(
        `[notify:${notification.recipientEmail}] ${notification.subject}\n  ${notification.body}`,
      );
    },
  };
}

/**
 * Drain the pending queue, recording the outcome of each message.
 *
 * Called after a transition commits, never inside it. A send that succeeded
 * before a rollback would have told someone about work that did not happen.
 *
 * Never throws. The state change is already durable by the time this runs, so
 * failing the caller's action because an email bounced would report a
 * successful transition as a failure.
 */
export async function drainPending(): Promise<{ sent: number; failed: number }> {
  // One at a time, because the channel needs each intent's kind and market to
  // record it and `NotificationChannel.send` only receives the rendered form.
  let sent = 0;
  let failed = 0;

  const batch = pendingNotifications.splice(0, pendingNotifications.length);

  for (const intent of batch) {
    try {
      const result = await dispatch([intent], recordingChannel(intent.marketId, intent.kind));
      sent += result.sent;
      failed += result.failed.length;

      for (const failure of result.failed) {
        recordFailure(failure.intent, "failed", failure.error);
        // Requeue, so a transient failure is retried on the next drain.
        pendingNotifications.push(failure.intent);
      }
      for (const dead of result.undeliverable) {
        // Not requeued: an unknown template or a missing recipient will never
        // succeed on a retry, and a poison message would block the queue.
        recordFailure(dead, "undeliverable", "No template or unknown recipient");
        logger.warn("notification.undeliverable", { kind: dead.kind });
      }
    } catch (error) {
      failed += 1;
      recordFailure(
        intent,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
      pendingNotifications.push(intent);
    }
  }

  if (sent > 0 || failed > 0) {
    logger.info("notifications.dispatched", { sent, failed });
  }
  return { sent, failed };
}

function recordFailure(intent: NotificationIntent, state: DeliveryState, error: string) {
  const rendered = render(intent);
  record({
    recipientUserId: intent.recipientUserId,
    recipientEmail: rendered?.recipientEmail ?? "unknown",
    subject: rendered?.subject ?? `(${intent.kind})`,
    body: rendered?.body ?? "",
    kind: intent.kind,
    marketId: intent.marketId,
    at: new Date().toISOString(),
    state,
    error,
  });
}

/** Everything an administrator can see, newest first. Scoped by the caller. */
export function outboxFor(marketId: string | null): {
  delivered: DeliveredNotification[];
  pending: NotificationIntent[];
} {
  return {
    delivered: marketId
      ? deliveredNotifications.filter((n) => n.marketId === marketId)
      : [...deliveredNotifications],
    pending: marketId
      ? pendingNotifications.filter((n) => n.marketId === marketId)
      : [...pendingNotifications],
  };
}
