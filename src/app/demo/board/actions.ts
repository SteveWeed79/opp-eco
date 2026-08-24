"use server";

import { runTransition, type ActionResult } from "@/app/_actions/transition";
import { actorForPortal } from "@/auth/session";
import { repositories } from "@/data/backend";
import { postingTotalHours } from "@/domain/types";
import { fundingAuthorizationInput, validate } from "@/services/validation";

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

  // An omitted hour cap means "the whole posting", which is what the board
  // portal shows as the default commitment.
  const proposedHours = hours ?? postingTotalHours(posting);

  const input = validate(fundingAuthorizationInput, {
    applicationId,
    hours: proposedHours,
    ratePerHour: market.subsidyRatePerHour,
  });
  if (!input.ok) return { ok: false, error: input.error };

  return runTransition(
    "board",
    { applicationId, to: "funding_authorized" },
    {
      label: "funding.authorize",
      patch: {
        fundingAuthorizedHours: input.data.hours,
        fundingAuthorizedRate: input.data.ratePerHour,
      },
    },
  );
}
