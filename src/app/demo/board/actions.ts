"use server";

import { runTransition, type ActionResult } from "@/app/_actions/transition";
import { changeAllocation } from "@/app/_actions/funding";
import { actorForPortal } from "@/auth/session";
import { repositories } from "@/data/backend";
import { postingTotalHours } from "@/domain/types";
import { fundingAuthorizationInput, validate } from "@/services/validation";
import { marketFunding } from "@/lib/queries";
import { wageCommitmentFor } from "@/domain/funding";
import { nextCommitmentId } from "@/services/funding";
import type { FundingCommitment } from "@/domain/types";

/**
 * Workforce-board transitions: recording an interview outcome, determining
 * eligibility, authorizing funding.
 */
export async function boardTransition(
  applicationId: unknown,
  to: unknown,
  reason?: unknown,
): Promise<ActionResult> {
  return runTransition("board", { applicationId, to, reason });
}

/**
 * Authorize funding for one placement.
 *
 * Separate from `boardTransition` because it writes an hour cap and a rate,
 * and those commit money against a finite annual allocation. Two rules follow
 * from that:
 *
 *  1. The numbers are validated as whole positive integers with a ceiling
 *     before they reach the domain — `NaN`, a negative, or a typo with an
 *     extra zero must not become a budget commitment.
 *  2. The rate is taken from the **market**, never from the request. The
 *     caller may propose an hour cap; they may not propose what the board pays
 *     per hour.
 *
 * The affordability check itself lives in the state machine's guard, so it
 * cannot be bypassed by calling this directly.
 */
export async function authorizeFunding(
  applicationId: unknown,
  hours: unknown,
): Promise<ActionResult> {
  const actor = await actorForPortal("board");

  const application =
    typeof applicationId === "string"
      ? await repositories.applications.find(actor, applicationId)
      : null;
  if (!application) return { ok: false, error: "Application not found." };

  const market = await repositories.markets.find(actor, application.marketId);
  const posting = await repositories.postings.find(actor, application.postingId);
  if (!market || !posting) {
    return { ok: false, error: "Application is missing its market or posting." };
  }

  // The rate comes from the market's wage-subsidy fund, which is where it lives
  // now that a market carries no money of its own. A market with no fund cannot
  // authorize anything, and saying so beats authorizing at $0 an hour.
  const funding = await marketFunding(actor, market.id);
  if (!funding.wage) {
    return {
      ok: false,
      error: "This market has no wage reimbursement fund yet.",
    };
  }
  const wage = funding.wage;

  // An omitted hour cap means "the whole posting", which is what the board
  // portal shows as the default commitment.
  const proposedHours = hours ?? postingTotalHours(posting);

  const input = validate(fundingAuthorizationInput, {
    applicationId,
    hours: proposedHours,
    ratePerHour: wage.source.ratePerHour ?? 0,
  });
  if (!input.ok) return { ok: false, error: input.error };

  const amount = wageCommitmentFor(input.data.hours, input.data.ratePerHour);

  /**
   * The draw against the fund, assembled here so it can be written inside the
   * transition's own transaction.
   *
   * The application's `fundingAuthorizedHours` and `fundingAuthorizedRate` stay
   * beside it as the cache the transition guards read — a guard takes an
   * `Application` and no repository — and this row is the ledger entry those
   * two numbers describe. `funding.test.ts` pins them against each other.
   */
  const existing = await repositories.fundingCommitments.forApplication(
    actor,
    application.id,
  );
  const alreadyDrawn = existing.some(
    (c) => c.fundingSourceId === wage.source.id && c.status !== "released",
  );

  const commitment: FundingCommitment = {
    id: nextCommitmentId(),
    marketId: application.marketId,
    fundingSourceId: wage.source.id,
    studentId: application.studentId,
    applicationId: application.id,
    amount,
    hours: input.data.hours,
    ratePerHour: input.data.ratePerHour,
    status: "authorized",
    authorizedOn: new Date().toISOString(),
    authorizedByUserId: actor.user.id,
    version: 1,
  };

  return runTransition(
    "board",
    { applicationId, to: "funding_authorized" },
    {
      label: "funding.authorize",
      patch: {
        fundingAuthorizedHours: input.data.hours,
        fundingAuthorizedRate: input.data.ratePerHour,
      },
      // Skipped when a live draw already exists, which an administrator
      // re-authorizing an override would otherwise turn into a double
      // commitment. The schema's partial unique index says the same thing.
      sideEffects: alreadyDrawn
        ? undefined
        : (uow) => uow.createFundingCommitment(commitment),
    },
  );
}

/**
 * Change what this board's fund holds.
 *
 * The role is hardcoded, as everywhere. Who may actually move the money is
 * decided in the domain by `canSpendFrom` — the organization that sponsors the
 * fund, or an administrator — and the service checks it again regardless of
 * which wrapper called, because a wrapper is a convenience and the domain is
 * the rule. A board cannot adjust a foundation's grant from here.
 */
export async function adjustAllocation(
  sourceId: string,
  allocated: unknown,
  ratePerHour: unknown,
  reason: string,
): Promise<ActionResult> {
  return changeAllocation("board", sourceId, allocated, ratePerHour, reason);
}
