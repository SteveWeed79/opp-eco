/**
 * The Resend channel.
 *
 * `NotificationChannel` was written with the comment "replacing it with a real
 * sender is one class". This is that class.
 *
 * Uses `fetch` rather than the `resend` SDK. The call is one POST with a
 * bearer token, and this project has just spent effort pinning its supply
 * chain to commit SHAs — adding a dependency and its transitive tree to avoid
 * forty lines of `fetch` is the wrong trade here. The cost is that the request
 * shape is written by hand and has to be checked against Resend's docs if
 * their API changes.
 *
 * Failures **throw**. The dispatcher catches them, records the message as
 * failed, and requeues it, which is the retry semantics the outbox already
 * implements. Swallowing an error here would mark an unsent message as sent.
 */

import type { NotificationChannel, RenderedNotification } from "../notifications";
import { emailConfig, resolveRecipient, type EmailConfig } from "./config";
import { renderEmail } from "./render";
import { templateFor } from "../templates";
import { logger } from "../logging";

const ENDPOINT = "https://api.resend.com/emails";

/** Raised when Resend refuses a message. Carries the status for triage. */
export class ResendError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ResendError";
  }
}

/**
 * Sends through Resend.
 *
 * `kind` and `payload` are needed because `RenderedNotification` carries only
 * a subject and a plain-text body — enough for a console channel, not enough
 * to build an HTML message with a call to action. Rather than widen that
 * interface for every channel, this re-renders from the template.
 */
export function resendChannel(
  kind: string,
  payload: Record<string, unknown>,
  config: EmailConfig = emailConfig(),
  fetchImpl: typeof fetch = fetch,
): NotificationChannel {
  return {
    name: "resend",
    async send(notification: RenderedNotification) {
      const recipient = resolveRecipient(notification.recipientEmail, config);
      if ("refuse" in recipient) {
        // Not an error to retry — a reserved domain will never accept mail.
        // Throwing a plain Error would requeue it forever.
        throw new UndeliverableAddress(recipient.refuse);
      }

      const template = templateFor(kind);
      const message = template
        ? template(payload)
        : { subject: notification.subject, body: notification.body };

      const { subject, html, text } = renderEmail(message, {
        appUrl: config.appUrl,
        intendedFor: recipient.redirectedFrom,
      });

      const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          // Resend deduplicates on this, so a retry after a timeout cannot
          // deliver the same message twice.
          "Idempotency-Key": idempotencyKey(kind, notification),
        },
        body: JSON.stringify({
          from: config.from,
          to: [recipient.to],
          subject,
          html,
          text,
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        // Never log the body: it contains the recipient address and the
        // message, and this project's logs are deliberately PII-free.
        logger.warn("email.send_failed", {
          status: response.status,
          kind,
        });
        throw new ResendError(
          response.status,
          `Resend rejected the message (${response.status})${detail ? `: ${truncate(detail)}` : ""}`,
        );
      }

      logger.info("email.sent", { kind });
    },
  };
}

/** A permanent failure. The dispatcher must record it, not retry it. */
export class UndeliverableAddress extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndeliverableAddress";
  }
}

/**
 * Stable across retries of the same message, distinct between messages.
 *
 * Recipient plus kind plus application is the natural key — the same person is
 * told about the same event once.
 */
function idempotencyKey(kind: string, notification: RenderedNotification): string {
  const application =
    typeof notification.recipientUserId === "string" ? notification.recipientUserId : "";
  return `${kind}:${application}:${notification.subject}`.slice(0, 256);
}

function truncate(value: string): string {
  return value.length > 200 ? `${value.slice(0, 200)}…` : value;
}
