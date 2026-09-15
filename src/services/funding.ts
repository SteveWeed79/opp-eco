/**
 * Moving money: opening a fund, changing what it holds, and drawing on it.
 *
 * The write side of `domain/funding.ts`. Three operations, and the first one is
 * the reason this file exists at all — **an allocation is expected to change.**
 * A supplemental award arrives, a rescission takes some back, a foundation adds
 * to the pot mid-year. That is ordinary program administration, not a
 * correction, so it gets a real write path with a reason and an audit entry
 * rather than a fixture edit and a redeploy.
 *
 * Everything here goes through a Store transaction, so the change and its audit
 * record commit together or not at all — the same contract every other write in
 * this codebase holds to.
 */

import type {
  ActorContext,
  FundingCommitment,
  FundingSource,
} from "@/domain/types";
import {
  adjustBlockReason,
  balanceOf,
  commitBlockReason,
  isHourly,
  spendBlockReason,
} from "@/domain/funding";
import { repositories, store } from "@/data/backend";
import type { Store } from "@/data/store";

export type FundingResult<T> =
  | { ok: true; updated: T }
  | { ok: false; error: string; code: "forbidden" | "not_found" | "conflict" };

export interface FundingDeps {
  store: Store;
  now: () => Date;
  id: (prefix: string) => string;
}

let sequence = 0;
const defaultDeps: FundingDeps = {
  store,
  now: () => new Date(),
  id: (prefix) => `${prefix}-${Date.now().toString(36)}${(++sequence).toString(36)}`,
};

// ---------------------------------------------------------------------------
// Changing the numbers
// ---------------------------------------------------------------------------

export interface AdjustFundingInput {
  allocated?: number;
  ratePerHour?: number;
  /** Required. An allocation that moved with no recorded why is unauditable. */
  reason: string;
}

/**
 * Change what a fund holds, or what it pays per hour.
 *
 * The reason is not optional, and that is the whole design. A board's
 * allocation moving from $240,000 to $198,000 is a fact somebody will have to
 * explain to a funder eighteen months later, and "the number in the database is
 * different now" is not an explanation. It goes in the audit log beside who did
 * it and when.
 *
 * **Reducing an allocation below what is already committed is allowed.** See
 * `adjustBlockReason` — a rescission is a real thing that happens to public
 * money, and refusing the edit would leave the software showing a figure the
 * board knows is wrong. The overcommitment surfaces on the console instead.
 */
export async function adjustFundingSource(
  actor: ActorContext,
  sourceId: string,
  input: AdjustFundingInput,
  deps: FundingDeps = defaultDeps,
): Promise<FundingResult<FundingSource>> {
  const source = await repositories.fundingSources.find(actor, sourceId);
  if (!source) {
    return { ok: false, error: "Fund not found.", code: "not_found" };
  }

  const blocked = spendBlockReason(actor, source);
  if (blocked) return { ok: false, error: blocked, code: "forbidden" };

  const next = {
    allocated: input.allocated,
    // A rate on a fund that is not hourly is refused rather than ignored, so a
    // caller who sent one learns that it meant nothing.
    ratePerHour: input.ratePerHour,
  };
  const refusal = adjustBlockReason(source, next);
  if (refusal) return { ok: false, error: refusal, code: "forbidden" };

  const reason = input.reason.trim();
  if (!reason) {
    return {
      ok: false,
      error: "Say why the allocation is changing.",
      code: "forbidden",
    };
  }

  const updated: FundingSource = {
    ...source,
    allocated: next.allocated ?? source.allocated,
    ratePerHour: isHourly(source)
      ? next.ratePerHour ?? source.ratePerHour
      : undefined,
  };

  const at = deps.now().toISOString();
  await deps.store.transaction((uow) => {
    uow.saveFundingSource(updated, source.version);
    uow.appendAuditEvent({
      marketId: source.marketId,
      at,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "funding_source",
      entityId: source.id,
      // The figures themselves, because an audit entry reading "allocation
      // changed" answers none of the questions anyone asks of it.
      from: describe(source),
      to: describe(updated),
      reason,
      viaOverride: false,
    });
  });

  return { ok: true, updated: { ...updated, version: source.version + 1 } };
}

function describe(source: FundingSource): string {
  const rate = source.ratePerHour ? ` @ $${source.ratePerHour}/hr` : "";
  return `$${source.allocated.toLocaleString()}${rate}`;
}

// ---------------------------------------------------------------------------
// Drawing on a fund
// ---------------------------------------------------------------------------

export interface CommitFundsInput {
  sourceId: string;
  studentId: string;
  /** Null where the help reaches a learner who has not been placed yet. */
  applicationId: string | null;
  amount: number;
  note?: string;
}

/**
 * Promise money from a fund to a learner.
 *
 * Unlike an adjustment, a commitment that would not fit is **refused**. The
 * difference is who is surprised: an allocation moving is news arriving from
 * outside and the platform's job is to show it, while a commitment is the
 * platform's own act — and knowingly promising money the fund does not hold is
 * how a student is told they have a grant that will not arrive.
 */
export async function commitFunds(
  actor: ActorContext,
  input: CommitFundsInput,
  deps: FundingDeps = defaultDeps,
): Promise<FundingResult<FundingCommitment>> {
  const source = await repositories.fundingSources.find(actor, input.sourceId);
  if (!source) return { ok: false, error: "Fund not found.", code: "not_found" };

  const blocked = spendBlockReason(actor, source);
  if (blocked) return { ok: false, error: blocked, code: "forbidden" };

  const student = await repositories.students.find(actor, input.studentId);
  if (!student) {
    return { ok: false, error: "Learner not found.", code: "not_found" };
  }
  if (student.marketId !== source.marketId) {
    // Unreachable through the repositories, which scope both reads by market.
    // Stated anyway: this is the check that must not be the one nobody wrote.
    return {
      ok: false,
      error: "That learner is in another market.",
      code: "forbidden",
    };
  }

  if (input.applicationId) {
    const application = await repositories.applications.find(actor, input.applicationId);
    if (!application) {
      return { ok: false, error: "Placement not found.", code: "not_found" };
    }
    if (application.studentId !== student.id) {
      return {
        ok: false,
        error: "That placement belongs to a different learner.",
        code: "forbidden",
      };
    }
  }

  const existing = await repositories.fundingCommitments.forSource(actor, source.id);
  if (
    input.applicationId &&
    existing.some(
      (c) => c.applicationId === input.applicationId && c.status !== "released",
    )
  ) {
    // The schema's partial unique index says the same thing. Checked here so
    // the caller gets a sentence rather than a constraint violation.
    return {
      ok: false,
      error: `${source.name} already covers this placement.`,
      code: "conflict",
    };
  }

  const amount = Math.round(input.amount);
  const refusal = commitBlockReason(balanceOf(source, existing), amount);
  if (refusal) return { ok: false, error: refusal, code: "forbidden" };

  const commitment: FundingCommitment = {
    id: deps.id("commit"),
    marketId: source.marketId,
    fundingSourceId: source.id,
    studentId: student.id,
    applicationId: input.applicationId,
    amount,
    // The rate is copied from the fund rather than read through it later, so a
    // board changing next year's rate cannot rewrite what it already promised.
    ratePerHour: isHourly(source) ? source.ratePerHour : undefined,
    status: "authorized",
    authorizedOn: deps.now().toISOString(),
    authorizedByUserId: actor.user.id,
    note: input.note?.trim() || undefined,
    version: 1,
  };

  await deps.store.transaction((uow) => {
    uow.createFundingCommitment(commitment);
    uow.appendAuditEvent({
      marketId: commitment.marketId,
      at: commitment.authorizedOn,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "funding_commitment",
      entityId: commitment.id,
      from: null,
      to: `$${amount.toLocaleString()} from ${source.name}`,
      reason: commitment.note,
      viaOverride: false,
    });
  });

  return { ok: true, updated: commitment };
}

/**
 * Give a commitment back to its fund.
 *
 * The row is kept and its status changed, never deleted: "what did we commit
 * and not spend" is a question a board asks at the end of a program year, and a
 * deleted row cannot answer it. Most releases happen automatically when a
 * placement ends — see `settlementFor` — and this is the manual path for the
 * case a person has to make the call.
 */
export async function releaseCommitment(
  actor: ActorContext,
  commitmentId: string,
  reason: string,
  deps: FundingDeps = defaultDeps,
): Promise<FundingResult<FundingCommitment>> {
  const commitment = await repositories.fundingCommitments.find(actor, commitmentId);
  if (!commitment) {
    return { ok: false, error: "Commitment not found.", code: "not_found" };
  }

  const source = await repositories.fundingSources.find(
    actor,
    commitment.fundingSourceId,
  );
  if (!source) return { ok: false, error: "Fund not found.", code: "not_found" };

  const blocked = spendBlockReason(actor, source);
  if (blocked) return { ok: false, error: blocked, code: "forbidden" };

  if (commitment.status === "released") {
    return { ok: false, error: "That commitment is already released.", code: "conflict" };
  }
  if (commitment.status === "disbursed") {
    // Disbursed means the money left. Flipping it back to released would put
    // spent money back in the fund and overstate what is available.
    return {
      ok: false,
      error: "That money has already been paid out and cannot be released.",
      code: "conflict",
    };
  }

  const note = reason.trim();
  if (!note) {
    return { ok: false, error: "Say why the commitment is being released.", code: "forbidden" };
  }

  const updated: FundingCommitment = { ...commitment, status: "released", note };
  const at = deps.now().toISOString();

  await deps.store.transaction((uow) => {
    uow.saveFundingCommitment(updated, commitment.version);
    uow.appendAuditEvent({
      marketId: commitment.marketId,
      at,
      actorUserId: actor.user.id,
      actorRole: actor.membership.role,
      entityType: "funding_commitment",
      entityId: commitment.id,
      from: commitment.status,
      to: "released",
      reason: note,
      viaOverride: false,
    });
  });

  return { ok: true, updated: { ...updated, version: commitment.version + 1 } };
}

/**
 * A commitment id for a caller that must build the row *before* opening a
 * transaction.
 *
 * Authorizing funding is the case: the state change and the draw against the
 * fund have to commit together, so the board's action assembles the commitment
 * and hands it to the transition's `sideEffects`. Exported narrowly rather than
 * exposing the whole dependency object, so it cannot drift into a general
 * id factory.
 */
export function nextCommitmentId(): string {
  return defaultDeps.id("commit");
}
