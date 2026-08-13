/**
 * The guarded state machine, without the entity.
 *
 * Four things in this product have a status and rules about who may change it:
 * an application, a student's enrolment standing, a posting, and an
 * organization's vetting. They differ in what they guard on and who owns them;
 * they do not differ at all in how a move is resolved.
 *
 * That resolution is the part worth having exactly once:
 *
 *  1. market isolation — you may not act outside your own market;
 *  2. ownership — an employer may not act on a competitor's record;
 *  3. the transition must exist from the current status, and apply here;
 *  4. the actor must hold a permitted role;
 *  5. any guard must pass;
 *  6. an administrator may override 4 and 5, but never 1, and never silently.
 *
 * Written four times it would be four things to keep in step, and the copy
 * that drifts is the one where a role check quietly stops applying. The
 * application machine had all of this inline first; this is that logic with
 * the application taken out of it, which is why the entity-specific parts
 * arrive as functions on a spec rather than as fields on a context.
 */

import type { ActorContext, ActorRole } from "./types";

/**
 * Admin can override role and guard checks, because unsticking stalled work is
 * the administrator's core job — but never market isolation, and never without
 * a reason. See `attempt`.
 */
const ADMIN_ROLE: ActorRole = "admin";

export interface StateTransition<Status extends string, Ctx> {
  from: Status;
  to: Status;
  /** Roles permitted to perform it. Admin is handled separately. */
  roles: ActorRole[];
  label: string;
  /** Extra precondition beyond role and current state. */
  guard?: (ctx: Ctx) => string | null;
}

export interface TransitionResult {
  ok: boolean;
  /** Why the transition was refused. Present only when `ok` is false. */
  error?: string;
  /** True when the move was only possible via administrator override. */
  viaOverride?: boolean;
}

export interface MachineSpec<
  Status extends string,
  Ctx,
  T extends StateTransition<Status, Ctx>,
> {
  /** Names the entity in refusal messages: "No transition from x to y on a posting". */
  subject: string;
  transitions: T[];
  statusOf: (ctx: Ctx) => Status;
  marketIdOf: (ctx: Ctx) => string;
  /**
   * Narrowing beyond market membership — an employer acting only on its own
   * postings, a student only on their own record. Returns the refusal, or null.
   *
   * Separate from `guard` because it is about the *actor's* relationship to
   * the record rather than the record's readiness to move, and because an
   * administrator overrides guards but never this.
   */
  ownership?: (actor: ActorContext, ctx: Ctx) => string | null;
  /**
   * Whether a transition exists at all in this context, regardless of who is
   * asking — the application machine uses it to filter by track. Absent means
   * every transition applies.
   */
  applies?: (transition: T, ctx: Ctx) => boolean;
  /**
   * How to say "that move does not exist here", when the default is too vague
   * to act on.
   *
   * The application machine uses it to name the track: a student told that
   * booking a board interview is not available needs to know it is unavailable
   * *for a micro-internship* — which is by design and permanent — rather than
   * unavailable from this status, which sounds like a matter of waiting.
   */
  explainMissing?: (from: Status, to: Status, ctx: Ctx) => string;
}

export interface Machine<Status extends string, Ctx, T> {
  /** Transitions defined from a status in this context, ignoring who is asking. */
  from(ctx: Ctx): T[];
  /**
   * What this actor may do right now — the source of truth for which buttons a
   * portal renders. A button that is not here does not exist for that actor.
   */
  available(actor: ActorContext, ctx: Ctx): T[];
  /** The only way the status changes. */
  attempt(
    actor: ActorContext,
    ctx: Ctx,
    to: Status,
    reason?: string,
  ): TransitionResult;
}

export function createMachine<
  Status extends string,
  Ctx,
  T extends StateTransition<Status, Ctx>,
>(spec: MachineSpec<Status, Ctx, T>): Machine<Status, Ctx, T> {
  const applies = (transition: T, ctx: Ctx) =>
    spec.applies ? spec.applies(transition, ctx) : true;

  const ownershipError = (actor: ActorContext, ctx: Ctx) =>
    spec.ownership ? spec.ownership(actor, ctx) : null;

  function from(ctx: Ctx): T[] {
    const status = spec.statusOf(ctx);
    return spec.transitions.filter((t) => t.from === status && applies(t, ctx));
  }

  function available(actor: ActorContext, ctx: Ctx): T[] {
    const candidates = from(ctx);

    // An administrator sees every move, including the ones they would have to
    // override to make. Hiding them would mean the person whose job is to
    // unstick things cannot see what is stuck.
    if (actor.membership.role === ADMIN_ROLE) return candidates;

    if (actor.membership.marketId !== spec.marketIdOf(ctx)) return [];
    if (ownershipError(actor, ctx)) return [];

    return candidates.filter(
      (t) => t.roles.includes(actor.membership.role) && !t.guard?.(ctx),
    );
  }

  function attempt(
    actor: ActorContext,
    ctx: Ctx,
    to: Status,
    reason?: string,
  ): TransitionResult {
    const isAdmin = actor.membership.role === ADMIN_ROLE;
    const status = spec.statusOf(ctx);

    // Market isolation is the one rule an administrator does not override,
    // because an administrator is already cross-market by design — there is
    // nothing here for the override to buy, and exempting it would mean the
    // check never runs for the only role that spans markets.
    if (!isAdmin && actor.membership.marketId !== spec.marketIdOf(ctx)) {
      return { ok: false, error: "Actor is not a member of this market" };
    }

    const ownership = ownershipError(actor, ctx);
    if (!isAdmin && ownership) return { ok: false, error: ownership };

    const transition = spec.transitions.find(
      (t) => t.from === status && t.to === to && applies(t, ctx),
    );

    if (!transition) {
      return {
        ok: false,
        error:
          spec.explainMissing?.(status, to, ctx) ??
          `No transition from ${status} to ${to} on this ${spec.subject}`,
      };
    }

    const roleAllowed = transition.roles.includes(actor.membership.role);
    const guardError = transition.guard?.(ctx) ?? null;

    if (isAdmin && (!roleAllowed || guardError)) {
      // The reason is the whole point. An override with no explanation is
      // indistinguishable in the audit log from the rule not existing.
      if (!reason) {
        return {
          ok: false,
          // Naming what is being overridden, because on an admin-only machine
          // the administrator is the *only* caller — so without this the guard
          // message has no audience at all, and they are asked to justify a
          // decision the product declined to describe.
          error: guardError
            ? `Administrator override requires a reason: ${guardError}`
            : "Administrator override requires a reason",
        };
      }
      return { ok: true, viaOverride: true };
    }

    if (!roleAllowed) {
      return {
        ok: false,
        error: `A ${actor.membership.role} may not perform "${transition.label}"`,
      };
    }

    if (guardError) return { ok: false, error: guardError };

    return { ok: true };
  }

  return { from, available, attempt };
}
