/**
 * The shared body of the two access actions.
 *
 * Not Server Actions themselves, for the reason `privacy.ts` is not: the
 * portal exports its own `"use server"` wrapper with the role **hardcoded**, so
 * a direct POST cannot name a role it does not hold.
 *
 * Both of these are the administrator's alone, and both are refused again in
 * the service — the role here decides which portal's session is resolved, and
 * the service decides who may act. A guard in one place is a guard somebody can
 * route around.
 */

import { revalidatePath } from "next/cache";
import { actorForPortal } from "@/auth/session";
import { attemptWrite, type ActionResult } from "@/app/_actions/transition";
import { addOrganizationMember, changeWorkAddress } from "@/services/access";
import { addMemberInput, changeAddressInput, validate } from "@/services/validation";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import { resendChannel } from "@/services/email/resend";
import { emailConfig } from "@/services/email/config";
import { authConfig } from "@/auth/config";
import { logger } from "@/services/logging";
import { store } from "@/data/backend";
import { PORTAL_PATH } from "@/routes";

let sequence = 0;

/**
 * How a warning reaches the address being left behind.
 *
 * Sent directly rather than through the notification outbox, like a sign-in
 * code and for a weaker version of the same reason: the outbox persists every
 * payload and renders it on a screen an administrator can open, and this is a
 * message specifically about what an administrator just did.
 */
function accessDeps() {
  return {
    store,
    now: () => new Date(),
    id: (prefix: string) =>
      `${prefix}-${Date.now().toString(36)}${(++sequence).toString(36)}`,
    async warn(to: string, message: string) {
      if (authConfig().echoCodes) {
        logger.warn("access.warning_echoed", { to, message });
        return;
      }
      const channel = resendChannel("access.address_changed", {}, emailConfig());
      await channel.send({
        recipientUserId: "access",
        recipientEmail: to,
        subject: "Your work address on this platform was changed",
        body: message,
      });
    },
  };
}

async function guard(bucket: string) {
  const actor = await actorForPortal("admin");
  const limit = checkRateLimit(callerKey(bucket, actor.user.id), LIMITS.mutation);
  if (!limit.ok) {
    logger.warn("rate_limit.exceeded", { action: bucket, userId: actor.user.id });
    return {
      actor,
      refusal: {
        ok: false as const,
        error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
      },
    };
  }
  return { actor, refusal: null };
}

/** Adding somebody changes who the board portal can be, so it is revalidated too. */
const AFFECTED = [PORTAL_PATH.admin, PORTAL_PATH.board];

export async function addMember(
  organizationId: unknown,
  name: unknown,
  email: unknown,
): Promise<ActionResult> {
  const input = validate(addMemberInput, { organizationId, name, email });
  if (!input.ok) return { ok: false, error: input.error };

  const { actor, refusal } = await guard("access.addMember");
  if (refusal) return refusal;

  const result = await attemptWrite(() =>
    addOrganizationMember(actor, input.data, accessDeps()).then((r) =>
      r.ok ? { ok: true as const, created: r.result } : r,
    ),
  );

  if (!result.ok) {
    logger.warn("access.add_refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}

export async function changeAddress(
  currentEmail: unknown,
  newEmail: unknown,
  reason: unknown,
): Promise<ActionResult> {
  const input = validate(changeAddressInput, { currentEmail, newEmail, reason });
  if (!input.ok) return { ok: false, error: input.error };

  const { actor, refusal } = await guard("access.changeAddress");
  if (refusal) return refusal;

  const result = await attemptWrite(() =>
    changeWorkAddress(actor, input.data, accessDeps()).then((r) =>
      r.ok ? { ok: true as const, created: r.result } : r,
    ),
  );

  if (!result.ok) {
    logger.warn("access.address_change_refused", { code: result.code });
    return { ok: false, error: result.error };
  }

  for (const path of AFFECTED) revalidatePath(path);
  return { ok: true };
}
