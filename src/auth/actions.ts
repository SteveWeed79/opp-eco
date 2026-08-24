"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, isActorRole } from "./session";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { DEMO_ROOT, PORTAL_PATH } from "@/routes";

/**
 * Sign on and sign out.
 *
 * Establishing the session is a server concern even when the credential check
 * is simulated — the client asks to become someone, and the server decides.
 * Doing it in the browser would mean the role were client state, which is
 * exactly the mistake the original mockup made when it let a dropdown pick
 * the portal.
 */

export async function signInAs(role: unknown): Promise<{ ok: boolean; error?: string }> {
  if (typeof role !== "string" || !isActorRole(role)) {
    return { ok: false, error: "Unknown account." };
  }

  const store = await cookies();

  // Sign-on is the brute-force target. Nothing identifies the caller before a
  // session exists, so this is a shared bucket — blunt, but it fails closed.
  const existing = store.get(SESSION_COOKIE)?.value ?? null;
  const limit = checkRateLimit(callerKey("signIn", existing), LIMITS.signIn);
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", { action: "signIn" });
    return {
      ok: false,
      error: `Too many sign-on attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  store.set(SESSION_COOKIE, role, {
    httpOnly: true,
    sameSite: "lax",
    // Not readable from JavaScript and not sent cross-site. The cookie carries
    // no secret here, but the habits should survive the demo.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  // `PORTAL_PATH`, not a path built from the role name. The two agreed right
  // up until the portals moved under `/demo`, at which point this quietly
  // sent every sign-on through a redirect to reach the page it meant.
  redirect(PORTAL_PATH[role]);
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  // Back to the prototype's index rather than the venture's front page.
  // Somebody signing out was walking through the demo, and dropping them onto
  // a marketing page loses the thing they were in the middle of doing.
  redirect(DEMO_ROOT);
}
