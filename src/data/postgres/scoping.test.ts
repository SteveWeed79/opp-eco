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
  hostOfferScope,
  marketScope,
  ownMarketScope,
  outcomeScope,
  postingOwnershipScope,
  studentScope,
} from "./scoping";
import { contextFor } from "@/data/session";
import { systemContext } from "@/auth/system";
import { canReadOutcomes } from "@/domain/outcome";
import type { ActorRole } from "@/domain/types";

const admin = contextFor("admin");
const business = contextFor("business");
const college = contextFor("college");
const board = contextFor("board");
const student = contextFor("student");
const system = systemContext();

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
  it("restricts an administrator to one world, not to one market", () => {
    // This was `TRUE`, which is right about tenancy and wrong about truth: an
    // administrator's console sums every market it can see, so a deployment
    // holding the demonstration beside a real programme reported invented
    // money inside a figure somebody takes to a funder.
    const scope = marketScope(admin, "applications");
    expect(scope.text).toContain("applications.market_id IN");
    expect(scope.text).toContain("is_demo_data = $1");
    expect(scope.params).toEqual([true]);
  });

  it("leaves the system context across both worlds", () => {
    // `systemContext` resolves an address to a sign-in method before anybody is
    // authenticated and dispatches queued notifications. Narrowed to the
    // demonstration it stopped finding a real workforce board, whose officers
    // then resolved to a password they do not have instead of the one-time code
    // they sign in with. It is not a viewer and renders no figure.
    expect(marketScope(system, "applications").text).toBe("TRUE");
    expect(ownMarketScope(system).text).toBe("TRUE");
  });

  it("puts an administrator with no preference on real programmes", () => {
    // The column's default, mirrored. A context that never set the field must
    // not be shown fixtures — forgetting shows an empty console rather than
    // somebody's learners.
    const real = { ...admin, viewingDemoData: undefined };
    expect(marketScope(real, "applications").params).toEqual([false]);
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

  it("restricts an administrator to one world", () => {
    const scope = applicationScope(admin);
    expect(scope.text).toContain("is_demo_data");
    expect(scope.text).not.toBe("TRUE");
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

describe("host offer scope", () => {
  it("lets an employer read its own, which outcome scope refuses outright", () => {
    // The asymmetry this record exists to create. An employer may not read
    // where somebody else's intern ended up, but it is the author here, and a
    // statement it cannot read back is one it cannot correct.
    const scope = hostOfferScope(business);
    expect(scope.text).not.toBe("FALSE");
    expect(scope.text).toContain("host_offers.business_id = $2");
    expect(scope.params[1]).toBe(business.membership.organizationId);
  });

  it("still narrows an employer by market as well as by itself", () => {
    // Belt and braces, and not redundant: the organization id is the client's
    // to be wrong about long before it is the database's.
    expect(hostOfferScope(business).text).toContain("host_offers.market_id = $1");
  });

  it("restricts a learner to their own", () => {
    const scope = hostOfferScope(student);
    expect(scope.text).toContain("host_offers.market_id = $1");
    expect(scope.text).toContain("SELECT id FROM students WHERE user_id = $2");
    expect(scope.params[1]).toBe(student.user.id);
  });

  it("gives the college and the board their market", () => {
    // Both read the answer; the note is stripped on the way out for the board
    // and the learner, which is a projection rather than a filter.
    expect(hostOfferScope(college).text).toBe("host_offers.market_id = $1");
    expect(hostOfferScope(board).text).toBe("host_offers.market_id = $1");
  });

  it("restricts an administrator to one world", () => {
    const scope = hostOfferScope(admin);
    expect(scope.text).toContain("is_demo_data");
    expect(scope.text).not.toBe("TRUE");
  });

  it("always emits at least one predicate for a non-admin", () => {
    for (const actor of [business, college, board, student]) {
      expect(hostOfferScope(actor).text).not.toBe("TRUE");
    }
  });
});

describe("outcome scope", () => {
  it("refuses an employer outright", () => {
    // FALSE rather than an omitted clause, so the refusal is in the statement
    // where a reviewer can see it.
    expect(outcomeScope(business).text).toBe("FALSE");
  });

  it("restricts a student to their own", () => {
    const scope = outcomeScope(student);
    expect(scope.text).toContain("outcomes.market_id = $1");
    expect(scope.text).toContain("SELECT id FROM students WHERE user_id = $2");
    expect(scope.params[1]).toBe(student.user.id);
  });

  it("gives a board its market, because the narrowing it needs is a projection", () => {
    // Unlike an introduction, which a board may not read at all: it has a
    // statutory interest in how many learners were employed. What it does not
    // get is the free text, and that is stripped on the way out rather than
    // filtered here.
    expect(outcomeScope(board).text).toBe("outcomes.market_id = $1");
  });

  it("gives a college its market", () => {
    expect(outcomeScope(college).text).toBe("outcomes.market_id = $1");
  });

  it("restricts an administrator to one world", () => {
    const scope = outcomeScope(admin);
    expect(scope.text).toContain("is_demo_data");
    expect(scope.text).not.toBe("TRUE");
  });

  it("always emits at least one predicate for a non-admin", () => {
    for (const actor of [business, college, board, student]) {
      expect(outcomeScope(actor).text).not.toBe("TRUE");
    }
  });

  it("refuses exactly the roles the domain says cannot read one", () => {
    // `canReadOutcomes` is what every derived view consults to tell "no outcome
    // exists" from "you may not see one". If it and this scope disagree, the
    // follow-up queue starts reporting finished work as outstanding — which is
    // the bug it was written for.
    const roles: ActorRole[] = ["admin", "student", "business", "college", "board"];
    for (const role of roles) {
      const refused = outcomeScope(contextFor(role)).text === "FALSE";
      expect(refused, role).toBe(!canReadOutcomes(role));
    }
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
