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
  if (actor.membership.role === "admin") return sql`TRUE`;
  return sql`${raw(table)}.market_id = ${actor.membership.marketId}`;
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
