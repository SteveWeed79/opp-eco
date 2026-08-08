"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, isActorRole } from "./session";

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
  store.set(SESSION_COOKIE, role, {
    httpOnly: true,
    sameSite: "lax",
    // Not readable from JavaScript and not sent cross-site. The cookie carries
    // no secret here, but the habits should survive the demo.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  redirect(`/${role}`);
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/");
}
