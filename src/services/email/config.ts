/**
 * Email configuration, and the guards around it.
 *
 * Sending is **off unless explicitly configured**. That is the opposite of how
 * this codebase treats its other secrets — the upload signing key throws in
 * production when missing, because a missing key there means broken security.
 * A missing email key means no email, which is the safe direction: this is a
 * demonstration whose organizations are invented, and the worst outcome is not
 * silence, it is mail arriving at a real person's inbox about a placement that
 * does not exist.
 *
 * Three guards, in order of how much they matter:
 *
 *  1. **No API key, no sending.** Falls back to the recording channel, which
 *     is exactly what the outbox already shows.
 *  2. **Redirect.** With `EMAIL_REDIRECT_TO` set, every message goes to that
 *     address instead of its real recipient, with the intended recipient
 *     stated in the body. This is how you test against real delivery without
 *     mailing anyone else, and it should stay set anywhere that is not
 *     production.
 *  3. **Reserved domains are never sent to.** The entire seed uses `.example`
 *     addresses, which RFC 2606 reserves precisely so they cannot be
 *     delivered. Sending to them would bounce every message, and a bounce rate
 *     like that is how a sending domain's reputation is destroyed. They are
 *     recorded undeliverable with a reason instead.
 */

export interface EmailConfig {
  apiKey: string | null;
  /** The From address. Must be on a domain verified with Resend. */
  from: string;
  /** Overrides every recipient when set. */
  redirectTo: string | null;
  /** Absolute base for links in messages. */
  appUrl: string;
  /** Set false to render and record without calling the API. */
  enabled: boolean;
}

/**
 * Reads a plain string map rather than `NodeJS.ProcessEnv`, because that is all
 * this needs and the narrower type makes it testable without inventing a whole
 * environment.
 */
export type EmailEnv = Record<string, string | undefined>;

export function emailConfig(env: EmailEnv = process.env): EmailConfig {
  const apiKey = env.RESEND_API_KEY?.trim() || null;
  return {
    apiKey,
    from: env.EMAIL_FROM?.trim() || "Opportunity Ecosystem <onboarding@resend.dev>",
    redirectTo: env.EMAIL_REDIRECT_TO?.trim() || null,
    appUrl: (env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000").replace(
      /\/$/,
      "",
    ),
    // Explicitly opt in. `EMAIL_ENABLED=false` turns it off even with a key
    // present, which is what you want the moment anything looks wrong.
    enabled: Boolean(apiKey) && env.EMAIL_ENABLED !== "false",
  };
}

/**
 * Domains reserved by RFC 2606 and RFC 6761 for documentation and testing.
 *
 * Nothing addressed to these can be delivered, by design. Every seeded
 * organization in this demo uses one.
 */
const RESERVED = [
  ".example",
  ".invalid",
  ".test",
  ".localhost",
  "@example.com",
  "@example.org",
  "@example.net",
];

export function isUndeliverableDomain(address: string): boolean {
  const lower = address.toLowerCase();
  return RESERVED.some((suffix) =>
    suffix.startsWith("@") ? lower.endsWith(suffix) : lower.includes(`${suffix}.`) || lower.endsWith(suffix),
  );
}

/**
 * Where a message actually goes, and why.
 *
 * Returns the redirect address when one is set, the original otherwise, or a
 * refusal the dispatcher records rather than attempts.
 */
export function resolveRecipient(
  intended: string,
  config: EmailConfig,
): { to: string; redirectedFrom?: string } | { refuse: string } {
  if (config.redirectTo) {
    return { to: config.redirectTo, redirectedFrom: intended };
  }
  if (isUndeliverableDomain(intended)) {
    return {
      refuse:
        `${intended} is on a reserved domain (RFC 2606) and cannot receive mail. ` +
        `Set EMAIL_REDIRECT_TO to send demo mail somewhere real.`,
    };
  }
  return { to: intended };
}
