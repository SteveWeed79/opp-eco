"use server";

import { runTransition, type ActionResult } from "@/app/_actions/transition";

/**
 * Employer-side transitions.
 *
 * The role is fixed here rather than taken from the request. Everything else —
 * whether this employer owns the posting, whether the move is legal from the
 * current status — is decided by the state machine, not by which buttons the
 * page happened to render.
 */
export async function businessTransition(
  applicationId: unknown,
  to: unknown,
  reason?: unknown,
): Promise<ActionResult> {
  return runTransition("business", { applicationId, to, reason });
}
