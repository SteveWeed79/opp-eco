/**
 * Who can get into an organization, and under what address.
 *
 * Two operations, both the administrator's, both about identity rather than
 * work: adding a colleague to an organization, and moving somebody's work
 * address when their mailbox changes.
 *
 * **One account is one person.** Everything this platform can say about who
 * determined an eligibility or signed off on funding rests on that, and on
 * nothing else — the audit entry records `actorUserId`, and that is a named
 * individual precisely as long as nobody shares a login. A workforce board with
 * four officers is four accounts on four work addresses, not one office account
 * four people know the password to. The schema cannot tell the difference, so
 * the rule lives here: adding a colleague is adding an account.
 *
 * That is also why neither of these is a general "edit a user". Adding a person
 * cannot rename an existing one, and moving an address cannot touch a name. A
 * determination signed by Marcia Delgado in March must still say so in October,
 * whatever has happened to her mailbox in between.
 */

import type { ActorContext, Membership, Organization, User } from "@/domain/types";
import { addressMatchesOrganization, normaliseEmail } from "@/domain/identity";
import { repositories, store } from "@/data/backend";
import { authStore } from "@/auth/backend";
import type { Store } from "@/data/store";
import { logger } from "@/services/logging";

export type AccessResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: string; code: "forbidden" | "not_found" | "duplicate" | "invalid" };

export interface AccessDeps {
  store: Store;
  now: () => Date;
  id: (prefix: string) => string;
  /**
   * Tell somebody their address was moved.
   *
   * Sent to the **old** address, which is the only one that proves anything: if
   * the change was legitimate the person already knows, and if it was not, the
   * warning reaches whoever still holds the mailbox. Sent directly rather than
   * through the notification outbox, like a sign-in code and for a weaker
   * version of the same reason — the outbox renders every payload on a screen
   * an administrator can open, and this is a message specifically about what an
   * administrator just did.
   */
  warn: (to: string, message: string) => Promise<void>;
}

let sequence = 0;
const defaultDeps: AccessDeps = {
  store,
  now: () => new Date(),
  id: (prefix) => `${prefix}-${Date.now().toString(36)}${(++sequence).toString(36)}`,
  async warn(to, message) {
    // Delivery is wired at the call site, which knows the deployment's mail
    // configuration. Logged rather than dropped so that a deployment without
    // one does not silently stop warning people.
    logger.warn("access.warning_undelivered", { to, message });
  },
};

const MAX_NAME_LENGTH = 120;

function refuse<T>(
  error: string,
  code: "forbidden" | "not_found" | "duplicate" | "invalid",
): AccessResult<T> {
  return { ok: false, error, code };
}

/**
 * The address checks both operations share.
 *
 * The domain rule is the one that carries weight. An organization that has
 * declared its work domains can only be given addresses on them, which means an
 * administrator cannot move a public employee's account — or add a new one — to
 * a mailbox they control themselves. For an organization that has declared no
 * domains there is no such control, and the audit entry is all there is; that is
 * the argument for every organization declaring them at onboarding.
 */
async function checkAddress(
  email: string,
  organization: Organization,
): Promise<{ ok: true; address: string } | { ok: false; error: string; code: "invalid" | "duplicate" }> {
  const address = normaliseEmail(email);

  if (!address.includes("@") || address.startsWith("@") || address.endsWith("@")) {
    return { ok: false, error: "That is not an email address.", code: "invalid" };
  }
  if (!addressMatchesOrganization(address, organization)) {
    const domains = organization.emailDomains.join(", ");
    return {
      ok: false,
      error: `A ${organization.name} address is required — ${domains}. A personal address cannot be used for a work account.`,
      code: "invalid",
    };
  }
  if (await authStore().findUserByEmail(address)) {
    // Said plainly. This is an administrator looking at their own organization's
    // people, not a stranger probing the sign-in form, so the reason the
    // enumeration rules exist does not apply.
    return {
      ok: false,
      error: "Somebody already has that address.",
      code: "duplicate",
    };
  }
  return { ok: true, address };
}

// ---------------------------------------------------------------------------
// Adding somebody
// ---------------------------------------------------------------------------

export interface AddMemberInput {
  organizationId: string;
  name: string;
  email: string;
}

/**
 * Add a colleague to an organization, with their own account.
 *
 * The role comes from the organization rather than from the caller. An
 * administrator adding somebody to a workforce board is adding a board officer;
 * there is no form field for "and make them an administrator", because a way to
 * mint a cross-market account from a member form is a privilege escalation with
 * a friendly label.
 */
export async function addOrganizationMember(
  actor: ActorContext,
  input: AddMemberInput,
  deps: AccessDeps = defaultDeps,
): Promise<AccessResult<User>> {
  if (actor.membership.role !== "admin") {
    return refuse("Only an administrator can add somebody to an organization.", "forbidden");
  }

  const name = input.name.trim();
  if (!name) return refuse("Enter the person's name.", "invalid");
  if (name.length > MAX_NAME_LENGTH) {
    return refuse(`Keep the name under ${MAX_NAME_LENGTH} characters.`, "invalid");
  }

  const organization = await repositories.organizations.find(actor, input.organizationId);
  if (!organization) return refuse("Organization not found.", "not_found");
  if (!organization.marketId) {
    return refuse("That organization has no market to anchor a membership to.", "invalid");
  }

  const checked = await checkAddress(input.email, organization);
  if (!checked.ok) return refuse(checked.error, checked.code);

  const user: User = { id: deps.id("u"), name, email: checked.address };
  const membership: Membership = {
    id: deps.id("mem"),
    userId: user.id,
    organizationId: organization.id,
    marketId: organization.marketId,
    // Derived, never accepted. See above.
    role: roleFor(organization),
  };

  await deps.store.transaction((uow) => {
    uow.addOrganizationMember(user, membership);
    uow.appendAuditEvent({
      marketId: organization.marketId!,
      at: deps.now().toISOString(),
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "user",
      entityId: user.id,
      from: null,
      // The name and the organization, because "account created" answers none
      // of the questions anybody asks of an account later.
      to: `${name} added to ${organization.name}`,
      viaOverride: false,
    });
  });

  logger.info("access.member_added", {
    organizationId: organization.id,
    userId: user.id,
    role: membership.role,
  });
  return { ok: true, result: user };
}

/** An organization's kind decides what its people are. */
function roleFor(organization: Organization): Membership["role"] {
  switch (organization.kind) {
    case "board":
      return "board";
    case "college":
      return "college";
    default:
      return "business";
  }
}

// ---------------------------------------------------------------------------
// Moving an address
// ---------------------------------------------------------------------------

export interface ChangeAddressInput {
  /** The address the account is known by now — how the person identifies it. */
  currentEmail: string;
  newEmail: string;
  reason: string;
}

/**
 * Move somebody's work address.
 *
 * The recovery path for a person whose mailbox is gone: an agency address that
 * changed, a college that migrated its mail. On the code path they have no
 * password to fall back on and no identity provider to ask, so without this they
 * are locked out permanently — which is the outcome this exists to prevent.
 *
 * It is also, unavoidably, the act of handing an account to whoever holds the
 * new mailbox, so it carries every control the rest of this file has: a
 * required reason, the declared-domain rule, an audit entry, every session and
 * outstanding code revoked, and a warning to the address being left behind.
 *
 * The account is named by its **current address** rather than picked from a
 * list, because a list of everybody is a directory, and the person on the phone
 * can always say what their address was.
 */
export async function changeWorkAddress(
  actor: ActorContext,
  input: ChangeAddressInput,
  deps: AccessDeps = defaultDeps,
): Promise<AccessResult<User>> {
  if (actor.membership.role !== "admin") {
    return refuse("Only an administrator can change a work address.", "forbidden");
  }

  const reason = input.reason.trim();
  if (!reason) {
    // The same rule an administrator override follows. This is the one write
    // that can hand an account to somebody else; an audit entry that cannot say
    // why is the entry nobody can act on a year later.
    return refuse("Changing an address requires a reason.", "invalid");
  }

  const auth = authStore();
  const existing = await auth.findUserByEmail(input.currentEmail);
  if (!existing) return refuse("No account has that address.", "not_found");

  const membership = await auth.membershipForUser(existing.id);
  if (!membership?.organizationId || !membership.marketId) {
    return refuse(
      "That account belongs to no organization, so there is no work domain to move it within.",
      "invalid",
    );
  }

  const organization = await repositories.organizations.find(
    actor,
    membership.organizationId,
  );
  if (!organization) return refuse("Organization not found.", "not_found");

  const checked = await checkAddress(input.newEmail, organization);
  if (!checked.ok) return refuse(checked.error, checked.code);
  if (checked.address === normaliseEmail(existing.email)) {
    return refuse("That is already the address on the account.", "invalid");
  }

  const at = deps.now().toISOString();
  const previous = existing.email;

  await deps.store.transaction((uow) => {
    uow.changeUserEmail(existing.id, checked.address);
    uow.appendAuditEvent({
      marketId: membership.marketId!,
      at,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "user",
      entityId: existing.id,
      // Both addresses, in the entry itself. An auditor asking who this account
      // was in March is asking exactly this, and a `from` that said only "an
      // address" would not answer it.
      from: previous,
      to: checked.address,
      reason,
      // Not an override — an administrator is the right person to do this — but
      // it is a privilege boundary being crossed, so it is recorded like one.
      viaOverride: false,
    });
  });

  // Every session, and every code in flight. A session opened from the old
  // mailbox must not survive the mailbox, and a sign-in code already sent there
  // is a key to a door that has just been rehung.
  await auth.revokeSessionsForUser(existing.id, at);
  await auth.consumeSignInCode(existing.id, "sign_in", at);
  await auth.consumeSignInCode(existing.id, "password_reset", at);

  await deps.warn(
    previous,
    `An administrator changed the work address on this account to ${checked.address}. ` +
      `Reason given: ${reason}. If you did not expect this, contact the program administrator now.`,
  );

  logger.info("access.address_changed", {
    userId: existing.id,
    organizationId: organization.id,
    by: actor.user.id,
  });
  return { ok: true, result: { ...existing, email: checked.address } };
}
