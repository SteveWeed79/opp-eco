/**
 * Funding — many sources, one placement.
 *
 * Until this file there was exactly one way money reached a student: a
 * workforce board reimbursing $20 an hour, written on the market as
 * `subsidyBudget` and `subsidyRatePerHour`. That is the mechanic the Southeast
 * Kansas pilot runs on and it is not the thing the venture sells. What it sells
 * is **funding coordination** — workforce dollars, a foundation grant toward
 * the cost of internship credit, a college fee waiver, an employer's own
 * contribution — layered on one placement, and none of the second, third or
 * fourth was expressible.
 *
 * The concrete cost of that: the 177-student survey's top barrier is the
 * tuition a student pays to receive credit for work the board is already
 * subsidising. The nonprofit arm exists partly to pay it. There was nowhere to
 * record either the cost or the grant that covered it.
 *
 * Two entities and one rule. A `FundingSource` is a pot of money with a
 * sponsor, a purpose and an allocation; a `FundingCommitment` is one draw
 * against it. **Every balance anywhere in the product is derived from those
 * two** — nothing caches a total, because a cached total is a number that can
 * disagree with the ledger, and a funder asking where their money went is the
 * worst audience for two answers.
 */

import type {
  ActorContext,
  Application,
  FundKind,
  FundPurpose,
  FundingCommitment,
  FundingSource,
} from "./types";
import { hasExited } from "./outcome";
import { isTerminal } from "./workflow";

// ---------------------------------------------------------------------------
// The vocabularies
// ---------------------------------------------------------------------------

export const FUND_KINDS: {
  value: FundKind;
  label: string;
  description: string;
}[] = [
  {
    value: "workforce",
    label: "Workforce board",
    description:
      "WIOA and equivalent public dollars. Eligibility-gated, and the only kind that pays by the hour today.",
  },
  {
    value: "philanthropic",
    label: "Foundation or grantmaker",
    description:
      "The CCLN foundation and other grantmakers. The arm that can pay a barrier no public formula covers.",
  },
  {
    value: "institutional",
    label: "Education institution",
    description:
      "A college's own scholarship, fee waiver, or departmental fund.",
  },
  {
    value: "employer",
    label: "Employer contribution",
    description:
      "The employer's own wage or project fee, recorded so a placement's full cost is visible rather than only the subsidised part.",
  },
];

export const FUND_PURPOSES: {
  value: FundPurpose;
  label: string;
  description: string;
}[] = [
  {
    value: "wage_subsidy",
    label: "Wage subsidy",
    description:
      "Reimburses an employer for hours a student worked. The mechanic the pilot runs on.",
  },
  {
    value: "credit_cost",
    label: "Cost of internship credit",
    description:
      "The tuition a student pays to receive academic credit for the placement. The top barrier in the student survey, and the one nothing could record before.",
  },
  {
    value: "transportation",
    label: "Transportation",
    description:
      "Getting to the placement. In a four-county market this is frequently the whole obstacle.",
  },
  {
    value: "stipend",
    label: "Learner stipend",
    description:
      "Paid to the student directly rather than through an employer — what an unpaid or micro experience needs to be viable.",
  },
  {
    value: "employer_support",
    label: "Employer support",
    description:
      "Offsets the cost of supervising, which is what a small employer actually spends.",
  },
];

const KIND_LABELS = new Map(FUND_KINDS.map((k) => [k.value, k.label]));
const PURPOSE_LABELS = new Map(FUND_PURPOSES.map((p) => [p.value, p.label]));

export function fundKindLabel(kind: FundKind): string {
  return KIND_LABELS.get(kind) ?? kind;
}

export function fundPurposeLabel(purpose: FundPurpose): string {
  return PURPOSE_LABELS.get(purpose) ?? purpose;
}

const PURPOSE_RANK = new Map(FUND_PURPOSES.map((p, i) => [p.value, i]));

/**
 * Funds in purpose order, then newest first.
 *
 * Purpose order rather than size, so the wage subsidy — the fund every existing
 * screen was about — stays at the top of every list, and the assistance funds
 * read as what they are: the things layered beside it.
 *
 * This matches the declaration order of the `fund_purpose` enum in the schema,
 * which is not a coincidence: Postgres sorts an enum in declaration order, so
 * `ORDER BY purpose` on the SQL side produces exactly this sequence. The parity
 * test compares the two layers row by row, and an order that agrees only by
 * luck is one that stops agreeing the day a purpose is inserted in the middle.
 */
export function byFundOrder(a: FundingSource, b: FundingSource): number {
  return (
    (PURPOSE_RANK.get(a.purpose) ?? 99) - (PURPOSE_RANK.get(b.purpose) ?? 99) ||
    b.openedOn.localeCompare(a.openedOn) ||
    a.id.localeCompare(b.id)
  );
}

/** Draws newest first, with the id as the final tie-break. */
export function byCommitmentOrder(
  a: FundingCommitment,
  b: FundingCommitment,
): number {
  return b.authorizedOn.localeCompare(a.authorizedOn) || a.id.localeCompare(b.id);
}

/** Whether this fund pays by the hour, which decides if a rate is meaningful. */
export function isHourly(source: FundingSource): boolean {
  return source.purpose === "wage_subsidy";
}

// ---------------------------------------------------------------------------
// Balances — derived, never stored
// ---------------------------------------------------------------------------

/**
 * Commitments that are still spending the fund.
 *
 * `authorized` and `disbursed` both count; `released` does not. The released
 * row is kept rather than deleted, because "what did we commit and not spend"
 * is a question a board asks at the end of a program year and a missing row
 * cannot answer.
 */
export function isLive(commitment: FundingCommitment): boolean {
  return commitment.status !== "released";
}

export interface FundingBalance {
  source: FundingSource;
  /** Authorized plus disbursed, in dollars. */
  committed: number;
  /** The part already paid out. */
  disbursed: number;
  /** Allocation minus committed. **Negative when overcommitted.** */
  remaining: number;
  /** 0-1, and can exceed 1. Callers cap it for display; the number stays true. */
  burn: number;
  /**
   * True when more has been committed than the fund now holds.
   *
   * Reachable, and deliberately not prevented — see `adjustBlockReason`. A
   * board whose allocation was cut mid-year is overcommitted whether or not the
   * software admits it, and the same argument applies here as to approved hours
   * exceeding an authorized cap: naming it is the only honest option.
   */
  overcommitted: boolean;
  liveCommitments: number;
}

export function balanceOf(
  source: FundingSource,
  commitments: FundingCommitment[],
): FundingBalance {
  const mine = commitments.filter((c) => c.fundingSourceId === source.id);
  const live = mine.filter(isLive);
  const committed = live.reduce((sum, c) => sum + c.amount, 0);
  const disbursed = mine
    .filter((c) => c.status === "disbursed")
    .reduce((sum, c) => sum + c.amount, 0);

  return {
    source,
    committed,
    disbursed,
    remaining: source.allocated - committed,
    burn: source.allocated > 0 ? committed / source.allocated : committed > 0 ? Infinity : 0,
    overcommitted: committed > source.allocated,
    liveCommitments: live.length,
  };
}

/** Every balance in a market, newest-opened first within a stable order. */
export function balancesFor(
  sources: FundingSource[],
  commitments: FundingCommitment[],
): FundingBalance[] {
  return sources.map((source) => balanceOf(source, commitments));
}

/**
 * The market's wage-subsidy fund, which is the one the board's console is about
 * and the one every existing budget figure used to mean.
 *
 * Returns null rather than throwing for a market that has none — Beloit has a
 * board in conversation and no allocation, and a market being unfunded is a
 * stage rather than an error.
 */
export function wageSubsidySource(
  sources: FundingSource[],
): FundingSource | null {
  return (
    sources.find((s) => s.purpose === "wage_subsidy" && s.status !== "closed") ??
    null
  );
}

/** What the board pays per hour here, or zero where nothing funds wages. */
export function wageSubsidyRate(sources: FundingSource[]): number {
  return wageSubsidySource(sources)?.ratePerHour ?? 0;
}

// ---------------------------------------------------------------------------
// Who may move money
// ---------------------------------------------------------------------------

/**
 * A sponsor spends its own fund; an administrator can spend any of them.
 *
 * Deliberately not a role list. "The board may commit" would be wrong the
 * moment a second board joined a market, and "the college may commit" would let
 * one college draw on another institution's scholarship. The rule that survives
 * both is ownership: the organization whose money it is.
 *
 * The administrator is included for the reason they are included everywhere
 * else here — a market whose sponsor has not acted is what an operator exists
 * to unstick — and, unlike a state-machine override, this one is not an
 * exception to anything: the administrator operates the foundation whose fund
 * it usually is.
 */
export function canSpendFrom(actor: ActorContext, source: FundingSource): boolean {
  if (actor.membership.role === "admin") return true;
  if (actor.membership.marketId !== source.marketId) return false;
  return actor.membership.organizationId === source.sponsorOrgId;
}

/**
 * Why this actor cannot move money in this fund, or null.
 *
 * A sentence rather than a boolean, on the same argument the override refusals
 * make: a guard that declines without naming itself asks someone to justify a
 * decision the product would not describe.
 */
export function spendBlockReason(
  actor: ActorContext,
  source: FundingSource,
): string | null {
  if (!canSpendFrom(actor, source)) {
    return "This fund belongs to another organization.";
  }
  if (source.status === "closed") {
    return "This fund is closed for the program year.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Changing the numbers
// ---------------------------------------------------------------------------

/**
 * Why an allocation cannot be set to this figure, or null.
 *
 * **Reducing it below what is already committed is allowed**, and that is the
 * decision worth arguing. A rescission is a real thing that happens to public
 * money, and a board that has committed $180,000 and just had its award cut to
 * $150,000 is overcommitted in fact. Refusing the edit would leave the software
 * showing a number the board knows is wrong, which is worse than showing an
 * uncomfortable one — the same reasoning that surfaces approved hours over an
 * authorized cap rather than preventing them. `FundingBalance.overcommitted`
 * is what makes it visible, and the board's console leads with it.
 *
 * What is refused is a figure that cannot mean anything: negative money, and a
 * rate on a fund that does not pay by the hour.
 */
export function adjustBlockReason(
  source: FundingSource,
  next: { allocated?: number; ratePerHour?: number },
): string | null {
  if (source.status === "closed") {
    return "This fund is closed. Reopen it before changing the allocation.";
  }
  if (next.allocated !== undefined) {
    if (!Number.isFinite(next.allocated) || next.allocated < 0) {
      return "An allocation cannot be negative.";
    }
  }
  if (next.ratePerHour !== undefined) {
    if (!isHourly(source)) {
      return `${fundPurposeLabel(source.purpose)} is not paid by the hour, so it has no rate.`;
    }
    if (!Number.isFinite(next.ratePerHour) || next.ratePerHour <= 0) {
      return "An hourly rate must be a positive figure.";
    }
  }
  if (next.allocated === undefined && next.ratePerHour === undefined) {
    return "Nothing to change.";
  }
  return null;
}

/**
 * Why this fund cannot cover this amount, or null.
 *
 * Unlike an adjustment, a *new* commitment that would not fit is refused. The
 * difference is who is surprised: an allocation moving is news arriving from
 * outside, and the platform's job is to show it; a commitment is the platform's
 * own act, and knowingly promising money the fund does not hold is how a
 * student is told they have a grant that will not arrive.
 */
export function commitBlockReason(
  balance: FundingBalance,
  amount: number,
): string | null {
  if (!Number.isFinite(amount) || amount <= 0) {
    return "A commitment must be a positive amount.";
  }
  if (balance.source.status === "closed") {
    return "This fund is closed for the program year.";
  }
  if (amount > balance.remaining) {
    return `$${amount.toLocaleString()} exceeds the $${Math.max(0, balance.remaining).toLocaleString()} remaining in ${balance.source.name}.`;
  }
  return null;
}

/**
 * What a placement costs the wage-subsidy fund, at a given cap and rate.
 *
 * One definition so the board's console, the state machine's guard and the
 * commitment written on authorization cannot compute three different figures
 * for the same placement.
 */
export function wageCommitmentFor(hours: number, ratePerHour: number): number {
  return Math.max(0, Math.round(hours * ratePerHour));
}

// ---------------------------------------------------------------------------
// Settling a commitment when the placement it paid for ends
// ---------------------------------------------------------------------------

/**
 * What should happen to a live draw, given where its placement has got to.
 *
 * Returns null to leave it alone, which is the answer for anything still
 * running. The two real answers are the difference the old model could not
 * make:
 *
 *   disbursed   the placement ran and finished. The money was **spent**, and it
 *               does not come back into the fund.
 *   released    it ended before anyone started. The money returns, and the row
 *               stays so "what did we commit and not spend" has an answer.
 *
 * Before this existed, `marketRemainingBudget` simply stopped counting any
 * terminal application — which silently treated a completed, fully reimbursed
 * placement and an application withdrawn on day one as the same event. For a
 * board reconciling a program year they are opposites.
 */
export function settlementFor(
  application: Application,
  commitment: FundingCommitment,
): FundingCommitment["status"] | null {
  if (!isLive(commitment)) return null;
  if (hasExited(application)) {
    return commitment.status === "disbursed" ? null : "disbursed";
  }
  if (isTerminal(application.status)) return "released";
  return null;
}
