/**
 * Scoping, expressed as SQL.
 *
 * This is the file most likely to reintroduce the authorization bugs the
 * review found, because a scoping rule that is correct in TypeScript and wrong
 * in SQL fails silently — the query returns rows, just too many of them.
 *
 * So the rules live in one place and every query composes them, rather than
 * each query hand-writing its own WHERE clause. Tests assert on the generated
 * text, which is how a missing predicate gets caught without a database.
 */

import { viewsDemoData } from "@/domain/identity";
import type { ActorContext } from "@/domain/types";
import { joinSql, sql, type Sql } from "./client";

/**
 * Restrict a table to the actor's market.
 *
 * Administrators are the only cross-market role, and that exception is
 * deliberate — but it is also the one that turns a scoping bug into a
 * cross-tenant leak, so it is written once and never inlined.
 */
export function marketScope(actor: ActorContext, table: string): Sql {
  if (actor.membership.role === "admin") {
    // The system reads on nobody's behalf and is narrowed by neither world.
    if (actor.systemWide) return sql`TRUE`;
    // Cross-market, but not across both worlds. This used to be `TRUE`, which
    // is right about tenancy and wrong about truth: the administrator's console
    // sums every market it can see, so a deployment holding the demonstration
    // beside a real programme would report invented placements and invented
    // money inside a figure somebody takes to a funder.
    //
    // A subquery rather than a join, because this fragment is composed into
    // queries that already join what they need and cannot have a table added
    // underneath them.
    return sql`${raw(table)}.market_id IN (
      SELECT id FROM markets WHERE is_demo_data = ${viewsDemoData(actor)}
    )`;
  }
  return sql`${raw(table)}.market_id = ${actor.membership.marketId}`;
}

/**
 * Restrict the `markets` table to the actor's market.
 *
 * Separate from `marketScope` because a market has no `market_id`: its own id
 * *is* the market. Composing the generic rule here produced
 * `markets.market_id = $1`, which is not a column — so every market read by a
 * college, a board, a business or a student failed outright against a real
 * database while passing every test that only inspected the generated text.
 */
export function ownMarketScope(actor: ActorContext): Sql {
  // The `markets` table answers it directly rather than through a subquery
  // against itself.
  if (actor.membership.role === "admin") {
    if (actor.systemWide) return sql`TRUE`;
    return sql`markets.is_demo_data = ${viewsDemoData(actor)}`;
  }
  return sql`markets.id = ${actor.membership.marketId}`;
}

/**
 * Restrict postings to the ones a business owns.
 *
 * Colleges are absent on purpose: a college operates its market and must see
 * every posting in it to review and help draft them. Its narrowing is by
 * market, not by ownership — the same asymmetry the in-memory layer encodes.
 */
export function postingOwnershipScope(actor: ActorContext): Sql {
  if (actor.membership.role !== "business") return sql`TRUE`;
  return sql`postings.business_id = ${actor.membership.organizationId}`;
}

/**
 * Restrict applications to those against the actor's own postings.
 *
 * The in-memory version applied this only in `list`, leaving `find`,
 * `forStudent`, and `forPosting` open. Here it is a fragment every application
 * query must include, so the same omission is visible in review.
 */
export function applicationScope(actor: ActorContext): Sql {
  const parts: Sql[] = [marketScope(actor, "applications")];
  if (actor.membership.role === "business") {
    parts.push(
      sql`applications.posting_id IN (
        SELECT id FROM postings WHERE business_id = ${actor.membership.organizationId}
      )`,
    );
  }
  if (actor.membership.role === "student") {
    parts.push(
      sql`applications.student_id IN (
        SELECT id FROM students WHERE user_id = ${actor.user.id}
      )`,
    );
  }
  return joinSql(parts, " AND ");
}

/**
 * Restrict introductions to the parties with a reason to read one.
 *
 * The employer's own, the student's own, the market's for a college or an
 * administrator — and **nothing at all for the board**, which reimburses
 * placements and has no workflow reason to know who was introduced to whom.
 * `FALSE` rather than an omitted clause, so the refusal is in the statement
 * where a reviewer can see it.
 */
export function mentorshipPairingScope(actor: ActorContext): Sql {
  if (actor.membership.role === "board") return sql`FALSE`;

  const parts: Sql[] = [marketScope(actor, "mentorship_pairings")];
  if (actor.membership.role === "business") {
    parts.push(
      sql`mentorship_pairings.business_id = ${actor.membership.organizationId}`,
    );
  }
  if (actor.membership.role === "student") {
    parts.push(
      sql`mentorship_pairings.student_id IN (
        SELECT id FROM students WHERE user_id = ${actor.user.id}
      )`,
    );
  }
  return joinSql(parts, " AND ");
}

/**
 * Restrict follow-up observations to the parties with a reason to read one.
 *
 * The market's, for a college or an administrator, because they record them; a
 * learner's own, because a record held about someone they cannot see is the
 * kind of thing a privacy regime asks about. **Nothing at all for an employer**
 * — no surface it has reads one, and where a different employer's intern ended
 * up is not its business.
 *
 * The board is *not* narrowed here, and that is the asymmetry with
 * `mentorshipPairingScope`: a board has a statutory interest in how many
 * learners were employed and how many stayed, which is exactly what the kind
 * says. What it does not get is the free text — stripped by `redactOutcome` on
 * the way out, the same way a work summary is.
 */
export function outcomeScope(actor: ActorContext): Sql {
  if (actor.membership.role === "business") return sql`FALSE`;

  const parts: Sql[] = [marketScope(actor, "outcomes")];
  if (actor.membership.role === "student") {
    parts.push(
      sql`outcomes.student_id IN (
        SELECT id FROM students WHERE user_id = ${actor.user.id}
      )`,
    );
  }
  return joinSql(parts, " AND ");
}

/**
 * Restrict a region definition to its market, and no further.
 *
 * The loosest scope in this file, and deliberately. A definition is a list of
 * counties and a date — it names nobody and holds no figure — and every role in
 * a market is entitled to know what "in region" means there. A learner asked
 * where they work, an employer deciding whether hosting counts locally, and a
 * board reading a retention rate all need it, and a boundary somebody cannot
 * see is a figure they cannot check.
 */
export function regionDefinitionScope(actor: ActorContext): Sql {
  return marketScope(actor, "region_definitions");
}

/**
 * Restrict a host's answer to the parties with a reason to read one.
 *
 * The asymmetry with `outcomeScope` is the whole point. An employer reads **no
 * outcomes at all** — where a different employer's intern ended up is not its
 * business — but it reads its own answers here, because it is the author, and a
 * statement somebody cannot read back is one they cannot correct.
 *
 * `business_id` is on the row so this needs no join through postings, and the
 * college, the board and the administrator are narrowed by market alone: the
 * queue of placements nobody has answered for is market-wide work.
 *
 * The learner is narrowed to their own, and what they and the board are kept
 * from is not the answer but the note — stripped by `redactHostOffer` on the
 * way out, the same way an outcome's detail is. A learner already knows whether
 * they were offered a job; hiding the answer from the person it happened to
 * would be theatre.
 */
export function hostOfferScope(actor: ActorContext): Sql {
  const parts: Sql[] = [marketScope(actor, "host_offers")];

  if (actor.membership.role === "business") {
    parts.push(sql`host_offers.business_id = ${actor.membership.organizationId}`);
  }
  if (actor.membership.role === "student") {
    parts.push(
      sql`host_offers.student_id IN (
        SELECT id FROM students WHERE user_id = ${actor.user.id}
      )`,
    );
  }
  return joinSql(parts, " AND ");
}

/**
 * Restrict draws against a fund to the parties with a reason to read one.
 *
 * An employer sees the commitments against placements it hosts — it is the
 * party being reimbursed, and a payment it cannot see is one it cannot
 * reconcile. A student sees their own, because a grant covering their tuition
 * is a fact about their own finances before it is a line in a board's report.
 *
 * There is no matching `fundingSourceScope`, and that absence is deliberate:
 * every actor in a market reads every fund in it. A student working out whether
 * they can afford the credit and an employer working out whether hosting is
 * viable are asking the same question, and a funding model visible only to its
 * sponsor would reproduce the gap this venture exists to close. Spending is
 * what is narrowed, by `canSpendFrom`, and the write paths check it again.
 */
export function fundingCommitmentScope(actor: ActorContext): Sql {
  const parts: Sql[] = [marketScope(actor, "funding_commitments")];

  if (actor.membership.role === "business") {
    parts.push(
      sql`funding_commitments.application_id IN (
        SELECT a.id FROM applications a
          JOIN postings p ON p.id = a.posting_id
         WHERE p.business_id = ${actor.membership.organizationId}
      )`,
    );
  }
  if (actor.membership.role === "student") {
    parts.push(
      sql`funding_commitments.student_id IN (
        SELECT id FROM students WHERE user_id = ${actor.user.id}
      )`,
    );
  }
  return joinSql(parts, " AND ");
}

/**
 * Restrict consents to the parties with standing.
 *
 * A learner sees their own, the recording institution sees the ones it holds,
 * an administrator sees the market's. **`FALSE` for an employer**, which is the
 * asymmetry worth naming: consent is what widens what an employer may see about
 * a learner, and it is still not a record the employer is party to.
 */
/**
 * Escalations: the raiser's own, or every one in the market for an
 * administrator.
 *
 * **The parties an escalation is about are deliberately not on this list** —
 * not the employer it may concern, not the college, not the board. The refusal
 * is the feature: a learner who knows their supervisor will read it does not
 * report an absent supervisor. Written as an explicit clause rather than an
 * omitted join so a reviewer sees the decision in the statement.
 *
 * Matches `visibleEscalations` clause for clause; the parity suite compares
 * them accessor by accessor and role by role.
 */
export function escalationScope(actor: ActorContext): Sql {
  const parts: Sql[] = [marketScope(actor, "escalations")];
  if (actor.membership.role !== "admin") {
    parts.push(sql`escalations.raised_by = ${actor.user.id}`);
  }
  return joinSql(parts, " AND ");
}

export function consentScope(actor: ActorContext): Sql {
  if (actor.membership.role === "business") return sql`FALSE`;

  const parts: Sql[] = [marketScope(actor, "consents")];
  if (actor.membership.role === "student") {
    parts.push(
      sql`consents.student_id IN (
        SELECT id FROM students WHERE user_id = ${actor.user.id}
      )`,
    );
  }
  if (actor.membership.role === "college") {
    parts.push(sql`consents.source_org_id = ${actor.membership.organizationId}`);
  }
  return joinSql(parts, " AND ");
}

export function studentScope(actor: ActorContext): Sql {
  const parts: Sql[] = [marketScope(actor, "students")];
  if (actor.membership.role === "student") {
    parts.push(sql`students.user_id = ${actor.user.id}`);
  }
  return joinSql(parts, " AND ");
}

/**
 * Interpolate an identifier the caller controls, never a value.
 *
 * Only ever used for table names written as literals in this file. Exposed
 * narrowly so it cannot become a general escape hatch.
 */
function raw(identifier: string): Sql {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Refusing to interpolate identifier: ${identifier}`);
  }
  return { text: identifier, params: [] };
}
