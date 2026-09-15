"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, MFA_COOKIE, SESSION_COOKIE, isActorRole } from "./session";
import { authConfig } from "./config";
import { MFA_CHALLENGE_TTL_MS, sessionLifetimeFor } from "@/domain/identity";
import type { ActorRole, IdentityMode } from "@/domain/types";
import {
  completeChallenge,
  endSession,
  finishSignIn,
  requestSignInCode,
  verifySignInCode,
} from "@/services/auth";
import {
  requestPasswordReset,
  resetPassword,
  setOwnPassword,
  signInMethodForAddress,
  verifyPasswordSignIn,
} from "@/services/password-auth";
import { getActor } from "./session";
import { resendChannel } from "@/services/email/resend";
import { emailConfig } from "@/services/email/config";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { logger } from "@/services/logging";
import { DEMO_ROOT, PORTAL_PATH, SIGN_IN_PATH } from "@/routes";

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

  const limit = guardSignOn("requestCode", email, LIMITS.signIn);
  if (limit) return { ok: false, error: limit };

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
): Promise<{ ok: boolean; error?: string; secondFactor?: boolean }> {
  if (typeof email !== "string" || typeof code !== "string") {
    return { ok: false, error: "Enter the code from your email." };
  }

  const limit = guardSignOn("submitCode", email, LIMITS.signIn);
  if (limit) return { ok: false, error: limit };

  const store = await cookies();
  const result = await verifySignInCode(email, code);
  if (result.ok === false) return { ok: false, error: result.error };

  if (result.ok === "challenge") {
    // A cookie holding a challenge, not a session. It is deliberately a
    // different name from `oe_session`: one name for two meanings is how a
    // half-finished sign-in becomes a finished one.
    store.set(MFA_COOKIE, result.challenge, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: Math.floor(MFA_CHALLENGE_TTL_MS / 1000),
    });
    return { ok: true, secondFactor: true };
  }

  setSessionCookie(store, result.token, result.actor.membership.role);
  redirect(PORTAL_PATH[result.actor.membership.role]);
}

/** One place the session cookie is written, so its lifetime cannot drift. */
function setSessionCookie(
  store: Awaited<ReturnType<typeof cookies>>,
  token: string,
  role: ActorRole,
): void {
  const { absoluteMs } = sessionLifetimeFor(role);
  store.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(absoluteMs / 1000),
  });
}

/**
 * Answer the second factor.
 *
 * The challenge cookie is cleared whatever happens: on success it has been
 * spent, and on failure leaving it would let somebody keep guessing against a
 * challenge whose attempt count they cannot see.
 */
export async function submitSecondFactor(
  presented: unknown,
): Promise<{ ok: boolean; error?: string }> {
  if (typeof presented !== "string") {
    return { ok: false, error: "Enter the code from your authenticator." };
  }

  const store = await cookies();
  const challenge = store.get(MFA_COOKIE)?.value;
  if (!challenge) return { ok: false, error: "Start signing in again." };

  const limit = checkRateLimit(callerKey("mfa", challenge), LIMITS.signIn);
  if (!limit.ok) {
    return {
      ok: false,
      error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const result = await completeChallenge(challenge, presented);
  if (result.ok !== true) {
    return { ok: false, error: "error" in result ? result.error : "That code is not valid." };
  }

  store.delete(MFA_COOKIE);
  setSessionCookie(store, result.token, result.actor.membership.role);
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
  store.delete(MFA_COOKIE);
  store.delete(SESSION_COOKIE);
  // Back to the prototype's index rather than the venture's front page.
  // Somebody signing out was walking through the demo, and dropping them onto
  // a marketing page loses the thing they were in the middle of doing.
  redirect(DEMO_ROOT);
}

/**
 * Which door this address uses.
 *
 * Answered before anything is asked for, so nobody is shown a password field
 * they cannot use. The resolution happens in the service and is keyed on the
 * address's *domain* rather than on whether the account exists — see
 * `signInMethodForAddress`.
 */
export async function lookupSignInMethod(
  email: unknown,
): Promise<{ ok: boolean; method?: IdentityMode; error?: string }> {
  if (typeof email !== "string" || !email.includes("@")) {
    return { ok: false, error: "Enter your work email." };
  }

  const limit = guardSignOn("lookup", email, LIMITS.signInLookup);
  if (limit) return { ok: false, error: limit };

  return { ok: true, method: await signInMethodForAddress(email) };
}

/**
 * Present a password.
 *
 * The rate limit is keyed on the address rather than on a cookie, because an
 * attacker working through a password list does not keep the cookie — and the
 * account being attacked is the thing that needs protecting.
 */
export async function submitPassword(
  email: unknown,
  password: unknown,
): Promise<{ ok: boolean; error?: string; secondFactor?: boolean; mustChange?: boolean }> {
  if (typeof email !== "string" || typeof password !== "string") {
    return { ok: false, error: "Enter your email and password." };
  }

  const limit = guardSignOn("password", email, LIMITS.signIn);
  if (limit) return { ok: false, error: limit };

  const checked = await verifyPasswordSignIn(email, password, { now: () => new Date() });
  if (!checked.ok) return { ok: false, error: checked.error };

  const result = await finishSignIn(
    checked.actor.user,
    checked.actor.membership,
    new Date(),
  );
  if (result.ok === false) return { ok: false, error: result.error };

  const store = await cookies();
  if (result.ok === "challenge") {
    store.set(MFA_COOKIE, result.challenge, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: Math.floor(MFA_CHALLENGE_TTL_MS / 1000),
    });
    return { ok: true, secondFactor: true };
  }

  setSessionCookie(store, result.token, result.actor.membership.role);
  if (checked.mustChange) {
    // Signed in, and the first thing they will be asked for is a password of
    // their own. A temporary credential somebody else chose must not quietly
    // become a permanent one.
    return { ok: true, mustChange: true };
  }
  redirect(PORTAL_PATH[result.actor.membership.role]);
}

/** Ask for a reset code. Always reports success, for the usual reason. */
export async function requestReset(email: unknown): Promise<{ ok: boolean; error?: string }> {
  if (typeof email !== "string" || !email.includes("@")) {
    return { ok: false, error: "Enter your work email." };
  }

  const limit = guardSignOn("reset", email, LIMITS.signIn);
  if (limit) return { ok: false, error: limit };

  await requestPasswordReset(email, resetDeps());
  return { ok: true };
}

export async function submitReset(
  email: unknown,
  code: unknown,
  password: unknown,
): Promise<{ ok: boolean; error?: string }> {
  if (
    typeof email !== "string" ||
    typeof code !== "string" ||
    typeof password !== "string"
  ) {
    return { ok: false, error: "That form did not arrive intact." };
  }

  const limit = guardSignOn("resetSubmit", email, LIMITS.signIn);
  if (limit) return { ok: false, error: limit };

  const result = await resetPassword(email, code, password, { now: () => new Date() });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** Choose your own, when signed in. */
export async function changeOwnPassword(
  password: unknown,
): Promise<{ ok: boolean; error?: string }> {
  if (typeof password !== "string") {
    return { ok: false, error: "Enter a new password." };
  }

  const actor = await getActor();
  if (!actor) return { ok: false, error: "Sign in first." };

  const result = await setOwnPassword(actor, password, { now: () => new Date() });
  if (!result.ok) return { ok: false, error: result.error };

  // Every session went, including this one. They sign in again with the
  // password they just chose, which is also the proof that it works.
  const store = await cookies();
  store.delete(AUTH_COOKIE);
  redirect(SIGN_IN_PATH);
}


/**
 * How a reset code reaches somebody.
 *
 * Sent directly, never through the notification outbox — the outbox persists
 * every payload and renders it on a screen an administrator can open, and a
 * reset code is a bearer token for an account. The same rule the sign-in code
 * follows, for the same reason.
 */
function resetDeps() {
  return {
    now: () => new Date(),
    async deliver(to: string, code: string, expiresAt: Date) {
      const minutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
      if (authConfig().echoCodes) {
        logger.warn("auth.reset_code_echoed", { to, code });
        return;
      }
      const channel = resendChannel("auth.password_reset", {}, emailConfig());
      await channel.send({
        recipientUserId: "auth",
        recipientEmail: to,
        subject: `Your password reset code: ${code}`,
        body:
          `Use ${code} to choose a new password. It is good for ${minutes} minutes and can be used once.\n\n` +
          `If you did not ask to reset it, nothing has changed and you can ignore this.`,
      });
    },
  };
}


/**
 * The sign-on rate limit, in two layers.
 *
 * Per address, so one person working through a password list slows down their
 * own account and nobody else's; and a coarse global backstop, so a spray
 * across many addresses still hits something. The first is what protects an
 * account, the second is what protects the service, and keying only on the
 * second — which is what a null session cookie amounts to — protects neither
 * while locking out a busy morning.
 *
 * Returns the sentence to show, or null to proceed.
 */
function guardSignOn(
  action: string,
  email: string,
  limit: { limit: number; windowMs: number },
): string | null {
  const perAddress = checkRateLimit(
    callerKey(action, email.trim().toLowerCase()),
    limit,
  );
  if (!perAddress.ok) {
    logger.warn("rate_limit.exceeded", { action, scope: "address" });
    return `Too many attempts. Try again in ${perAddress.retryAfterSeconds} seconds.`;
  }

  const global = checkRateLimit(callerKey(action, null), LIMITS.signInGlobal);
  if (!global.ok) {
    logger.warn("rate_limit.exceeded", { action, scope: "global" });
    return `Too many attempts right now. Try again in ${global.retryAfterSeconds} seconds.`;
  }

  return null;
}
