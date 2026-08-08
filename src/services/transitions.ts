/**
 * The write path.
 *
 * Every state change in the system goes through `executeTransition`. It is
 * transport-agnostic on purpose — a Server Action, a route handler, a
 * scheduled job, and a future API all call the same function, so none of them
 * can invent their own rules.
 *
 * The sequence is fixed:
 *
 *   1. load the transition context (application, student, posting, budget)
 *   2. ask the state machine whether the actor may make this move
 *   3. apply the change, its audit record, and its notifications atomically
 *
 * Step 2 is not optional and not skippable. Server Actions are reachable by
 * direct POST, not only through the UI, so a button being absent from the page
 * proves nothing about what a caller can attempt.
 */

import type {
  ActorContext,
  Application,
  ApplicationStatus,
  AuditEvent,
} from "@/domain/types";
import { attemptTransition, isTerminal } from "@/domain/workflow";
import { repositories } from "@/data/memory";
import { marketRemainingBudget } from "@/lib/queries";
import {
  ConcurrencyError,
  type NotificationIntent,
  type Store,
  type UnitOfWork,
} from "@/data/store";
import { memoryStore } from "@/data/memory-store";
import { notificationsFor } from "./notification-policy";

export interface TransitionCommand {
  applicationId: string;
  to: ApplicationStatus;
  /** Required when an administrator overrides a role or guard check. */
  reason?: string;
  /**
   * Fields the transition itself sets — a funding authorization's hour cap, a
   * booked slot id. Applied before the guard runs so guards see what they are
   * being asked to approve.
   */
  patch?: Partial<Application>;
  /** Extra writes belonging to the same transaction, e.g. claiming a slot. */
  sideEffects?: (uow: UnitOfWork, application: Application) => void;
  /**
   * Extra messages beyond what the notification policy already sends.
   *
   * Most transitions need none: `notificationsFor` decides who hears about a
   * status from one table, so a caller does not repeat it. This is for the
   * rare message that depends on something only the caller knows — a booked
   * slot's start time, say.
   *
   * `marketId` is filled in from the application rather than accepted, so a
   * notification cannot be addressed into another market. Everything else is
   * passed through — an earlier version rebuilt the intent field by field
   * here, which silently dropped `recipientOrganizationId` and made every
   * message to an employer or board undeliverable.
   */
  notifications?: (
    application: Application,
  ) => (Omit<NotificationIntent, "marketId" | "payload"> & {
    payload?: Record<string, unknown>;
  })[];
  /**
   * Extra payload fields merged into the policy's messages — an interview
   * time, a reason. Templates read them; policy does not need to know they
   * exist.
   */
  payload?: Record<string, unknown>;
  /** Escape hatch for a transition that must not notify. Rare; say why. */
  suppressPolicyNotifications?: boolean;
}

export type TransitionResult =
  | { ok: true; application: Application }
  | { ok: false; error: string; code: "forbidden" | "conflict" | "not_found" };

export interface TransitionDeps {
  store: Store;
  now: () => Date;
}

const defaultDeps: TransitionDeps = {
  store: memoryStore,
  now: () => new Date(),
};

export async function executeTransition(
  actor: ActorContext,
  command: TransitionCommand,
  deps: TransitionDeps = defaultDeps,
): Promise<TransitionResult> {
  // Read through the actor's own scope. A caller who cannot see an application
  // cannot move it, and this is where that is decided.
  const existing = repositories.applications.find(actor, command.applicationId);
  if (!existing) {
    return { ok: false, error: "Application not found", code: "not_found" };
  }

  const student = repositories.students.find(actor, existing.studentId);
  const posting = repositories.postings.find(actor, existing.postingId);
  if (!student || !posting) {
    return {
      ok: false,
      error: "Application is missing its student or posting",
      code: "not_found",
    };
  }

  const market = repositories.markets.find(actor, existing.marketId);
  if (!market) {
    return { ok: false, error: "Market not found", code: "not_found" };
  }

  const proposed: Application = { ...existing, ...command.patch };

  const verdict = attemptTransition(
    actor,
    {
      application: proposed,
      student,
      remainingBudget: marketRemainingBudget(actor, market),
      postingOwnerId: posting.businessId,
    },
    command.to,
    command.reason,
  );

  if (!verdict.ok) {
    return { ok: false, error: verdict.error ?? "Transition refused", code: "forbidden" };
  }

  const at = deps.now().toISOString();
  const updated: Application = {
    ...proposed,
    status: command.to,
    statusSince: at,
    // Preserve how far this application ever got, so closing it does not erase
    // its progress from funnel reporting.
    furthestStatus: furthestOf(existing, command.to),
    version: existing.version,
  };

  const event: Omit<AuditEvent, "id"> = {
    marketId: existing.marketId,
    at,
    actorUserId: actor.user.id,
    actorRole: actor.membership.role,
    entityType: "application",
    entityId: existing.id,
    from: existing.status,
    to: command.to,
    reason: command.reason,
    viaOverride: verdict.viaOverride ?? false,
  };

  try {
    await deps.store.transaction((uow) => {
      uow.saveApplication(updated, existing.version);
      uow.appendAuditEvent(event);
      command.sideEffects?.(uow, updated);

      // Policy first, caller second, deduplicated on recipient and kind so a
      // caller adding a message the table already covers cannot send it twice.
      const policyIntents = command.suppressPolicyNotifications
        ? []
        : notificationsFor(command.to, {
            application: updated,
            posting,
            student,
            market,
            college: repositories.organizations.find(actor, student.collegeId),
            employer: repositories.organizations.find(actor, posting.businessId),
            board: market.boardId
              ? repositories.organizations.find(actor, market.boardId)
              : null,
          });

      const seen = new Set<string>();
      for (const intent of [...policyIntents, ...(command.notifications?.(updated) ?? [])]) {
        const key = `${intent.recipientUserId}:${intent.kind}`;
        if (seen.has(key)) continue;
        seen.add(key);

        uow.enqueueNotification({
          ...intent,
          // Not from the caller: a message belongs to the market of the thing
          // that caused it.
          marketId: existing.marketId,
          payload: { ...intent.payload, ...command.payload },
        });
      }
    });
  } catch (error) {
    if (error instanceof ConcurrencyError) {
      return { ok: false, error: error.message, code: "conflict" };
    }
    throw error;
  }

  return { ok: true, application: { ...updated, version: existing.version + 1 } };
}

/**
 * The furthest status an application has reached.
 *
 * Only terminal states can move *backwards* in funnel terms, so anything else
 * simply advances the marker.
 */
function furthestOf(existing: Application, to: ApplicationStatus): ApplicationStatus {
  if (isTerminal(to)) return existing.furthestStatus ?? existing.status;
  return to;
}
