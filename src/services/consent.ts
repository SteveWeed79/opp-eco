/**
 * Recording and withdrawing consent.
 *
 * The write side of `domain/consent.ts`. Short, because the hard parts are
 * decisions rather than code: who may assert that a learner agreed (the
 * institution whose records it covers), what happens when they change their
 * mind (a status change, never a deletion), and what the platform declines to
 * work out for itself (whose signature was required).
 */

import type { ActorContext, ConsentRecord } from "@/domain/types";
import {
  canRecordConsent,
  recordBlockReason,
  type CONSENT_SCOPES,
} from "@/domain/consent";
import { repositories, store } from "@/data/backend";
import type { Store } from "@/data/store";

export type ConsentResult =
  | { ok: true; updated: ConsentRecord }
  | { ok: false; error: string; code: "forbidden" | "not_found" | "conflict" };

export interface ConsentDeps {
  store: Store;
  now: () => Date;
  id: (prefix: string) => string;
}

let sequence = 0;
const defaultDeps: ConsentDeps = {
  store,
  now: () => new Date(),
  id: (prefix) => `${prefix}-${Date.now().toString(36)}${(++sequence).toString(36)}`,
};

export interface RecordConsentInput {
  studentId: string;
  /** The institution whose records this covers. */
  sourceOrgId: string;
  scope: ConsentRecord["scope"];
  grantedBy: ConsentRecord["grantedBy"];
  /** Null for open-ended, which most institutional forms are. */
  expiresOn: string | null;
  note?: string;
}

/**
 * Record that a learner — or their parent — agreed to a disclosure.
 *
 * The institution is taken from the input rather than from the actor, because
 * an administrator can record on a college's behalf and the record has to name
 * the college either way. Who may do it is then checked against that
 * institution, not against the caller's role.
 */
export async function recordConsent(
  actor: ActorContext,
  input: RecordConsentInput,
  deps: ConsentDeps = defaultDeps,
): Promise<ConsentResult> {
  const isAdmin = actor.membership.role === "admin";
  if (!canRecordConsent(actor.membership.organizationId, isAdmin, input.sourceOrgId)) {
    return {
      ok: false,
      error: "Only the institution whose records these are can record consent for them.",
      code: "forbidden",
    };
  }

  const student = await repositories.students.find(actor, input.studentId);
  if (!student) {
    return { ok: false, error: "Learner not found.", code: "not_found" };
  }

  const now = deps.now();
  const refusal = recordBlockReason({
    scope: input.scope,
    grantedBy: input.grantedBy,
    expiresOn: input.expiresOn,
    now,
  });
  if (refusal) return { ok: false, error: refusal, code: "forbidden" };

  const existing = await repositories.consents.forStudent(actor, student.id);
  if (
    existing.some(
      (c) =>
        c.sourceOrgId === input.sourceOrgId &&
        c.scope === input.scope &&
        c.status === "granted",
    )
  ) {
    // The schema's partial unique index says the same thing. Checked here so
    // the caller gets a sentence rather than a constraint violation.
    return {
      ok: false,
      error: "That consent is already on file and in force.",
      code: "conflict",
    };
  }

  const consent: ConsentRecord = {
    id: deps.id("consent"),
    marketId: student.marketId,
    studentId: student.id,
    sourceOrgId: input.sourceOrgId,
    scope: input.scope,
    grantedBy: input.grantedBy,
    grantedOn: now.toISOString(),
    expiresOn: input.expiresOn,
    status: "granted",
    recordedByUserId: actor.user.id,
    note: input.note?.trim() || undefined,
    version: 1,
  };

  await deps.store.transaction((uow) => {
    uow.createConsent(consent);
    uow.appendAuditEvent({
      marketId: consent.marketId,
      at: consent.grantedOn,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "consent",
      entityId: consent.id,
      from: null,
      // The scope and the grantor, because "consent recorded" answers none of
      // the questions anyone asks of a consent later.
      to: `${input.scope} · granted by ${input.grantedBy}`,
      reason: consent.note,
      viaOverride: false,
    });
  });

  return { ok: true, updated: consent };
}

/**
 * A learner changes their mind.
 *
 * A status change rather than a deletion, and the reason is not squeamishness:
 * an institution that disclosed records while the consent stood may have to
 * account for having done so, and a deleted row cannot say what was permitted
 * when. The employer's view narrows on the next read either way.
 */
export async function withdrawConsent(
  actor: ActorContext,
  consentId: string,
  reason: string,
  deps: ConsentDeps = defaultDeps,
): Promise<ConsentResult> {
  const consent = await repositories.consents.find(actor, consentId);
  if (!consent) {
    return { ok: false, error: "Consent not found.", code: "not_found" };
  }

  const isAdmin = actor.membership.role === "admin";
  if (!canRecordConsent(actor.membership.organizationId, isAdmin, consent.sourceOrgId)) {
    return {
      ok: false,
      error: "Only the institution whose records these are can withdraw this consent.",
      code: "forbidden",
    };
  }
  if (consent.status !== "granted") {
    return { ok: false, error: "That consent is not in force.", code: "conflict" };
  }

  const note = reason.trim();
  if (!note) {
    return { ok: false, error: "Say why it is being withdrawn.", code: "forbidden" };
  }

  const updated: ConsentRecord = { ...consent, status: "withdrawn", note };
  const at = deps.now().toISOString();

  await deps.store.transaction((uow) => {
    uow.saveConsent(updated, consent.version);
    uow.appendAuditEvent({
      marketId: consent.marketId,
      at,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "consent",
      entityId: consent.id,
      from: "granted",
      to: "withdrawn",
      reason: note,
      viaOverride: false,
    });
  });

  return { ok: true, updated: { ...updated, version: consent.version + 1 } };
}

export type ConsentScopeOption = (typeof CONSENT_SCOPES)[number];
