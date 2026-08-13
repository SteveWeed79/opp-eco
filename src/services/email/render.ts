/**
 * HTML email.
 *
 * Hand-written rather than a component library, because email HTML is not web
 * HTML: no flexbox in Outlook, no external stylesheets, no `<style>` blocks
 * that survive Gmail, and everything inline. A React renderer would produce
 * markup that looks right in a browser preview and breaks in a client, and the
 * templates here are simple enough that the abstraction would cost more than
 * it saved.
 *
 * Deliberately plain: one column, system fonts, a single accent colour, one
 * button. A message that has to be *read* — "book your interview or this
 * placement dies" — is not helped by a masthead.
 *
 * Every message carries a text part too. Some clients prefer it, some people
 * force it, and a text-only fallback that says "please view in HTML" is a
 * message that failed.
 */

import type { Message } from "../templates";
import { brand } from "@/brand";

/** The one accent, matching `brand-700` — the contrast-safe interactive tone. */
const BRAND = "#0369a1";
const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e2e8f0";

export interface EmailParts {
  subject: string;
  html: string;
  text: string;
}

export function renderEmail(
  message: Message,
  options: {
    appUrl: string;
    /** Stated in the body when mail has been redirected away from its target. */
    intendedFor?: string;
  },
): EmailParts {
  const actionUrl = message.action
    ? `${options.appUrl}${message.action.path}`
    : null;

  return {
    subject: message.subject,
    html: htmlBody(message, actionUrl, options.intendedFor),
    text: textBody(message, actionUrl, options.intendedFor),
  };
}

function htmlBody(
  message: Message,
  actionUrl: string | null,
  intendedFor?: string,
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(message.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;">
<!-- Preheader: the grey line clients show next to the subject. Without it
     they scrape the first body text, which reads as a duplicate subject. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(
    firstSentence(message.body),
  )}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:12px;">
<tr><td style="padding:24px 28px 8px 28px;">
  <span style="display:inline-block;font:700 13px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND};letter-spacing:.08em;text-transform:uppercase;">${escape(brand.name)}</span>
</td></tr>
${
  intendedFor
    ? `<tr><td style="padding:8px 28px 0 28px;">
  <p style="margin:0;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font:600 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#92400e;">
    Redirected. This was addressed to ${escape(intendedFor)}.
  </p>
</td></tr>`
    : ""
}
<tr><td style="padding:12px 28px 0 28px;">
  <h1 style="margin:0;font:700 20px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">${escape(
    message.subject,
  )}</h1>
</td></tr>
<tr><td style="padding:12px 28px 0 28px;">
  <p style="margin:0;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#334155;">${escape(
    message.body,
  )}</p>
</td></tr>
${
  actionUrl && message.action
    ? `<tr><td style="padding:20px 28px 0 28px;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${BRAND};border-radius:8px;">
    <a href="${escape(actionUrl)}" style="display:inline-block;padding:11px 20px;font:700 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;">${escape(
      message.action.label,
    )}</a>
  </td></tr></table>
</td></tr>`
    : ""
}
<tr><td style="padding:24px 28px 24px 28px;">
  <hr style="border:none;border-top:1px solid ${LINE};margin:0 0 12px 0;">
  <p style="margin:0;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
    Demonstration prototype. Every organization, student, and figure is fictional &mdash;
    this is not a live program and nothing here can be applied for.
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function textBody(
  message: Message,
  actionUrl: string | null,
  intendedFor?: string,
): string {
  const lines = [
    intendedFor ? `[Redirected — addressed to ${intendedFor}]\n` : "",
    message.subject,
    "",
    message.body,
    actionUrl && message.action ? `\n${message.action.label}: ${actionUrl}` : "",
    "",
    "—",
    "Demonstration prototype. Every organization, student, and figure is",
    "fictional — this is not a live program and nothing here can be applied for.",
  ];
  return lines.filter((line) => line !== "").join("\n");
}

function firstSentence(text: string): string {
  const end = text.indexOf(". ");
  return end === -1 ? text.slice(0, 140) : text.slice(0, end + 1);
}

/**
 * Escapes into HTML text content.
 *
 * Template payloads carry names an employer typed — a posting title is
 * user-supplied — so this is a real injection boundary, not a formality.
 */
function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
