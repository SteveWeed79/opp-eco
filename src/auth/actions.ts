"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, SESSION_COOKIE, isActorRole } from "./session";
import { authConfig } from "./config";
import { sessionLifetimeFor } from "@/domain/identity";
import {
  endSession,
  requestSignInCode,
  verifySignInCode,
} from "@/services/auth";
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
  // The role picker is a demonstration affordance. Under real sign-on it is not
  // a convenience, it is an authentication bypass — so it refuses rather than
  // being hidden, because a hidden control is still a reachable Server Action.
  if (authConfig().mode !== "demo") {
    return { ok: false, error: "This deployment requires a sign-in code." };
  }

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

/**
 * Ask for a sign-in code.
 *
 * Always reports success for an address the platform does not hold, so the form
 * cannot be used to enumerate who takes part in this programme — including
 * which public employees work on it. A *federated* organization is told plainly,
 * because the person needs to know to use their agency's login and an
 * institution's identity arrangement is not a secret about a person.
 */
export async function requestCode(
  email: unknown,
): Promise<{ ok: boolean; error?: string }> {
  if (typeof email !== "string") return { ok: false, error: "Enter your work email." };

  const store = await cookies();
  const limit = checkRateLimit(
    callerKey("signIn", store.get(AUTH_COOKIE)?.value ?? null),
    LIMITS.signIn,
  );
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", { action: "requestCode" });
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  return requestSignInCode(email);
}

/**
 * Present a code and become somebody.
 *
 * The cookie holds a random token and the database holds its hash, so this is
 * the only moment the token exists anywhere it could be read. `maxAge` follows
 * the role's absolute lifetime — an administrator's browser should forget the
 * cookie on the same schedule the server forgets the session.
 */
export async function submitCode(
  email: unknown,
  code: unknown,
): Promise<{ ok: boolean; error?: string }> {
  if (typeof email !== "string" || typeof code !== "string") {
    return { ok: false, error: "Enter the code from your email." };
  }

  const store = await cookies();
  const limit = checkRateLimit(
    callerKey("signInVerify", store.get(AUTH_COOKIE)?.value ?? null),
    LIMITS.signIn,
  );
  if (!limit.ok) {
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const result = await verifySignInCode(email, code);
  if (!result.ok) return { ok: false, error: result.error };

  const { absoluteMs } = sessionLifetimeFor(result.actor.membership.role);
  store.set(AUTH_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(absoluteMs / 1000),
  });

  redirect(PORTAL_PATH[result.actor.membership.role]);
}

export async function signOut(): Promise<void> {
  const store = await cookies();

  // Revoked server-side, not just dropped from the browser. A cookie deleted
  // on one machine does nothing about the session it named, which is the whole
  // difference between a real session and a claim in a header.
  const token = store.get(AUTH_COOKIE)?.value;
  if (token) await endSession(token);

  store.delete(AUTH_COOKIE);
  store.delete(SESSION_COOKIE);
  // Back to the prototype's index rather than the venture's front page.
  // Somebody signing out was walking through the demo, and dropping them onto
  // a marketing page loses the thing they were in the middle of doing.
  redirect(DEMO_ROOT);
}
