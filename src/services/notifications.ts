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

/**
 * Message templates.
 *
 * Every message names what happened, who it concerns, and what the recipient
 * should do — a notification that only reports a state change makes the reader
 * work out their own next step, which is how queues stall.
 */
const TEMPLATES: Record<
  string,
  (payload: Record<string, unknown>) => { subject: string; body: string }
> = {
  "interview.booked.board": (p) => ({
    subject: `Interview booked: ${p.studentName}`,
    body:
      `${p.studentName} booked a clearance interview for ${p.postingTitle}, ` +
      `on ${formatWhen(p.startsAt)}. Nothing else is needed until then.`,
  }),
  "interview.booked.employer": (p) => ({
    subject: `Your candidate has booked their board interview`,
    body:
      `The clearance interview for ${p.postingTitle} is on ${formatWhen(p.startsAt)}. ` +
      `Once the board authorizes funding, the placement can start.`,
  }),
  "application.stalled": (p) => ({
    subject: `${p.postingTitle} has been waiting ${p.days} days`,
    body:
      `This application has sat at "${p.status}" for ${p.days} days and is ` +
      `waiting on you. Placements that stall here are the ones most likely to fall through.`,
  }),
  "funding.authorized": (p) => ({
    subject: `Funding approved for ${p.studentName}`,
    body:
      `The board authorized up to ${p.hours} hours at $${p.rate}/hour. ` +
      `You can start the placement and log hours against it.`,
  }),
  "credit.granted": (p) => ({
    subject: `${p.creditHours} credit granted`,
    body: `${p.collegeName} granted ${p.creditHours} credit for ${p.courseMapping}.`,
  }),
};

function formatWhen(value: unknown): string {
  if (typeof value !== "string") return "a scheduled time";
  return new Date(value).toLocaleString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function render(intent: NotificationIntent): RenderedNotification | null {
  const template = TEMPLATES[intent.kind];
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

export interface DispatchResult {
  sent: number;
  failed: { intent: NotificationIntent; error: string }[];
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
      });
    }
  }

  // Anything that failed goes back for the next run; anything undeliverable
  // does not, because retrying a missing template will never succeed.
  queue.push(...result.failed.map((f) => f.intent));

  return result;
}
