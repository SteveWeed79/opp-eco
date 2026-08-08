/**
 * Scoping tests against generated SQL.
 *
 * A scoping rule that is right in TypeScript and wrong in SQL fails silently —
 * the query still returns rows, just too many. These assert on the statement
 * text so a missing predicate is caught without a database.
 */

import { describe, it, expect } from "vitest";
import { sql, joinSql } from "./client";
import {
  applicationScope,
  marketScope,
  postingOwnershipScope,
  studentScope,
} from "./scoping";
import { contextFor } from "@/data/session";

const admin = contextFor("admin");
const business = contextFor("business");
const college = contextFor("college");
const board = contextFor("board");
const student = contextFor("student");

describe("sql template", () => {
  it("parameterises every interpolated value", () => {
    const q = sql`SELECT * FROM markets WHERE id = ${"mkt-1"} AND stage = ${"live"}`;
    expect(q.text).toBe("SELECT * FROM markets WHERE id = $1 AND stage = $2");
    expect(q.params).toEqual(["mkt-1", "live"]);
  });

  it("never lets a value reach the statement text", () => {
    const hostile = "'; DROP TABLE applications; --";
    const q = sql`SELECT * FROM markets WHERE id = ${hostile}`;
    expect(q.text).not.toContain("DROP");
    expect(q.params).toEqual([hostile]);
  });

  it("renumbers a nested fragment so the placeholders stay aligned", () => {
    const inner = sql`market_id = ${"mkt-1"}`;
    const outer = sql`SELECT * FROM applications WHERE status = ${"cleared"} AND ${inner}`;
    expect(outer.text).toBe(
      "SELECT * FROM applications WHERE status = $1 AND market_id = $2",
    );
    expect(outer.params).toEqual(["cleared", "mkt-1"]);
  });

  it("renumbers across joined fragments", () => {
    const joined = joinSql(
      [sql`a = ${1}`, sql`b = ${2}`, sql`c = ${3}`],
      " AND ",
    );
    expect(joined.text).toBe("a = $1 AND b = $2 AND c = $3");
    expect(joined.params).toEqual([1, 2, 3]);
  });
});

describe("market scope", () => {
  it("does not restrict an administrator", () => {
    expect(marketScope(admin, "applications").text).toBe("TRUE");
  });

  it("pins every other role to their own market", () => {
    for (const actor of [business, college, board, student]) {
      const scope = marketScope(actor, "applications");
      expect(scope.text).toBe("applications.market_id = $1");
      expect(scope.params).toEqual([actor.membership.marketId]);
    }
  });
});

describe("posting ownership", () => {
  it("restricts a business to its own postings", () => {
    const scope = postingOwnershipScope(business);
    expect(scope.text).toContain("postings.business_id = $1");
    expect(scope.params).toEqual([business.membership.organizationId]);
  });

  it("does not restrict a college, which operates the whole market", () => {
    expect(postingOwnershipScope(college).text).toBe("TRUE");
  });

  it("does not restrict the board", () => {
    expect(postingOwnershipScope(board).text).toBe("TRUE");
  });
});

describe("application scope", () => {
  it("restricts a business to applications against its own postings", () => {
    const scope = applicationScope(business);
    expect(scope.text).toContain("applications.market_id = $1");
    expect(scope.text).toContain("SELECT id FROM postings WHERE business_id = $2");
    expect(scope.params).toEqual([
      business.membership.marketId,
      business.membership.organizationId,
    ]);
  });

  it("restricts a student to their own applications", () => {
    const scope = applicationScope(student);
    expect(scope.text).toContain("SELECT id FROM students WHERE user_id = $2");
    expect(scope.params[1]).toBe(student.user.id);
  });

  it("gives a college market scope without ownership scope", () => {
    const scope = applicationScope(college);
    expect(scope.text).toBe("applications.market_id = $1");
    expect(scope.text).not.toContain("business_id");
  });

  it("leaves an administrator unrestricted", () => {
    expect(applicationScope(admin).text).toBe("TRUE");
  });

  it("always emits at least one predicate for a non-admin", () => {
    // Guards against a future role falling through every branch and
    // silently producing an unscoped query.
    for (const actor of [business, college, board, student]) {
      expect(applicationScope(actor).text).not.toBe("TRUE");
    }
  });
});

describe("student scope", () => {
  it("restricts a student to their own record", () => {
    const scope = studentScope(student);
    expect(scope.text).toContain("students.user_id = $2");
  });

  it("lets a college see its market's roster", () => {
    expect(studentScope(college).text).toBe("students.market_id = $1");
  });
});

describe("identifier interpolation", () => {
  it("refuses a table name that is not a plain identifier", () => {
    const hostile = { membership: { role: "college", marketId: "m" }, user: { id: "u" } };
    expect(() =>
      marketScope(hostile as never, "applications; DROP TABLE users"),
    ).toThrow(/Refusing to interpolate/);
  });
});
