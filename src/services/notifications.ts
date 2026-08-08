/**
 * Notification dispatch.
 *
 * The write path queues intents inside the transaction that caused them; this
 * drains that queue afterwards. Splitting the two is the whole point: a send
 * that fails after the state change has committed must be retryable, and a
 * send that succeeds before a rollback has told someone about work that never
 * happened.
 *
 * Nothing in this system moves unless people are told. The pause exists
 * because a student has to independently discover they need to contact a
 * workforce board — every notification here is an attempt to remove one of
 * those discoveries.
 */

import type { NotificationIntent } from "@/data/store";
import { repositories } from "@/data/memory";
import { systemContext } from "@/auth/system";
import { templateFor } from "./templates";

export interface RenderedNotification {
  recipientUserId: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

/**
 * Where a rendered notification goes. Email, SMS, and in-app all reduce to
 * this, and a failure must throw so the dispatcher can retry rather than
 * silently dropping it.
 */
export interface NotificationChannel {
  readonly name: string;
  send(notification: RenderedNotification): Promise<void>;
}

export function render(intent: NotificationIntent): RenderedNotification | null {
  const template = templateFor(intent.kind);
  // An unknown template is a bug, not a message. Better to drop it loudly in
  // the dispatcher's result than to send something empty.
  if (!template) return null;

  const email = addressFor(intent);
  if (!email) return null;

  const { subject, body } = template(intent.payload);
  return {
    recipientUserId: intent.recipientUserId,
    recipientEmail: email,
    subject,
    body,
  };
}

/**
 * Where a message actually goes.
 *
 * A user record wins when there is one. Failing that, an organization's
 * published contact — an employer is reachable long before anyone there has an
 * account, and refusing to tell them their candidate cleared because of that
 * would be the platform failing at its one job.
 */
function addressFor(intent: NotificationIntent): string | null {
  const user = repositories.users.find(intent.recipientUserId);
  if (user) return user.email;

  if (intent.recipientOrganizationId) {
    // Dispatch belongs to nobody — it runs after the acting user's request is
    // over, on behalf of the system. `systemContext` is the named seam for
    // that, rather than smuggling an admin session into a background read.
    const org = repositories.organizations.find(
      systemContext(),
      intent.recipientOrganizationId,
    );
    if (org) return org.contactEmail;
  }
  return null;
}

/** Stand-in channel. Replacing it with a real sender is one class. */
export const consoleChannel: NotificationChannel = {
  name: "console",
  async send(notification) {
    console.info(
      `[notify:${notification.recipientEmail}] ${notification.subject}\n  ${notification.body}`,
    );
  },
};

/**
 * The name a channel gives an error it will never succeed at retrying.
 *
 * A contract rather than a class import, so `dispatch` stays ignorant of what
 * any particular transport considers permanent — email has reserved domains,
 * an SMS channel would have unroutable numbers. Matching on the error *name*
 * beats matching on its message, which is prose and gets reworded.
 */
export const PERMANENT_FAILURE = "UndeliverableAddress";

export interface DispatchResult {
  sent: number;
  failed: {
    intent: NotificationIntent;
    error: string;
    /** True when retrying is pointless. The caller must not requeue these. */
    permanent: boolean;
  }[];
  undeliverable: NotificationIntent[];
}

/**
 * Drain the queue.
 *
 * Failures are collected rather than thrown so one bad recipient cannot block
 * the rest, and the intent is returned so the caller can requeue it. In
 * Postgres this becomes `SELECT ... FOR UPDATE SKIP LOCKED` over the outbox
 * table, with the same shape.
 */
export async function dispatch(
  queue: NotificationIntent[],
  channel: NotificationChannel = consoleChannel,
): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, failed: [], undeliverable: [] };

  // Drain rather than iterate, so a concurrent enqueue is not lost or resent.
  const batch = queue.splice(0, queue.length);

  for (const intent of batch) {
    const rendered = render(intent);
    if (!rendered) {
      result.undeliverable.push(intent);
      continue;
    }
    try {
      await channel.send(rendered);
      result.sent += 1;
    } catch (error) {
      result.failed.push({
        intent,
        error: error instanceof Error ? error.message : String(error),
        permanent: error instanceof Error && error.name === PERMANENT_FAILURE,
      });
    }
  }

  // Transient failures go back for the next run. Permanent ones do not, nor do
  // undeliverable ones — retrying a missing template or an address that cannot
  // receive mail will never succeed, and a poison message that requeues itself
  // forever blocks everything behind it.
  queue.push(...result.failed.filter((f) => !f.permanent).map((f) => f.intent));

  return result;
}
