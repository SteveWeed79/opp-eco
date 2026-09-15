/**
 * The seed script's SQL, without a database.
 *
 * Three classes of bug are cheap to make here and expensive to find on a live
 * connection: a placeholder count that disagrees with its parameter array,
 * rows inserted before the rows they reference, and a fixture that quietly
 * stops being written at all. All three are checkable against a recording
 * client, so none of them needs a round trip to Neon to catch.
 */

import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- plain JS operator script, which cannot import TypeScript
import { seedInto, TABLES } from "../../../scripts/seed.mjs";

interface Recorded {
  text: string;
  params: unknown[];
}

async function run(): Promise<Recorded[]> {
  const statements: Recorded[] = [];
  await seedInto({
    async query(text: string, params: unknown[] = []) {
      statements.push({ text, params });
      return { rows: [] };
    },
  });
  return statements;
}

const statements = await run();

/** Which table a statement writes to, for order checks. */
function target(text: string): string {
  return (
    text.match(/INSERT INTO (\w+)/)?.[1] ?? text.match(/UPDATE (\w+)/)?.[1] ?? "?"
  );
}

const firstIndexOf = (table: string) =>
  statements.findIndex((s) => target(s.text) === table);

describe("statement shape", () => {
  it("gives every placeholder a parameter, and every parameter a placeholder", async () => {
    for (const { text, params } of statements) {
      const highest = Math.max(
        0,
        ...[...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
      );
      expect(highest, `placeholders vs params: ${text.slice(0, 70)}`).toBe(
        params.length,
      );
    }
  });

  it("never interpolates a value into the statement text", async () => {
    // Every fixture value travels as a parameter. A seed that concatenated
    // would break on the first apostrophe in a description.
    for (const { text } of statements) {
      expect(text).not.toMatch(/VALUES\s*\([^$)]*'[^']*'\s*[,)]/);
    }
  });
});

describe("referential order", () => {
  it("writes markets before the organizations that belong to them", () => {
    expect(firstIndexOf("markets")).toBeLessThan(firstIndexOf("organizations"));
  });

  it("names a market's board only after the board exists", () => {
    // The circular reference: a market names its board, and every organization
    // belongs to a market. Markets land pre-live and are corrected afterwards.
    const firstMarketInsert = statements.findIndex((s) =>
      s.text.startsWith("INSERT INTO markets"),
    );
    const boardUpdate = statements.findIndex((s) => s.text.includes("UPDATE markets SET board_id"));
    expect(firstMarketInsert).toBeLessThan(firstIndexOf("organizations"));
    expect(boardUpdate).toBeGreaterThan(firstIndexOf("organizations"));
  });

  it("inserts markets in a stage that does not yet require a board", () => {
    // `live_market_has_board` would refuse a live market with a null board.
    const inserts = statements.filter((s) => s.text.startsWith("INSERT INTO markets"));
    expect(inserts.length).toBeGreaterThan(0);
    for (const insert of inserts) {
      expect(insert.text).toContain("'configuring'");
      expect(insert.text).toContain("NULL");
    }
  });

  it("writes users before the students and memberships that reference them", () => {
    expect(firstIndexOf("users")).toBeLessThan(firstIndexOf("students"));
    expect(firstIndexOf("users")).toBeLessThan(firstIndexOf("memberships"));
  });

  it("writes postings and students before the applications joining them", () => {
    expect(firstIndexOf("postings")).toBeLessThan(firstIndexOf("applications"));
    expect(firstIndexOf("students")).toBeLessThan(firstIndexOf("applications"));
  });

  it("writes applications before the hours and credit that reference them", () => {
    expect(firstIndexOf("applications")).toBeLessThan(firstIndexOf("time_entries"));
    expect(firstIndexOf("credit_awards")).toBeLessThan(
      firstIndexOf("credit_award_applications"),
    );
  });
});

describe("coverage", () => {
  it("writes every table the truncation clears", () => {
    // A fixture that stops being seeded leaves an empty table nobody notices
    // until a portal renders blank.
    const written = new Set(statements.map((s) => target(s.text)));
    const expected = TABLES.filter(
      // Produced by the running application, not by fixtures. The outbox fills
      // as transactions commit; sessions and codes only exist once somebody
      // signs in, and a seeded session would be a working credential shipped in
      // the repository.
      (t: string) =>
        !["notification_outbox", "sessions", "sign_in_codes"].includes(t),
    );
    expect([...expected].filter((t) => !written.has(t))).toEqual([]);
  });

  it("converts money to cents on the way in", () => {
    // The allocation moved off the market and onto its wage-subsidy fund, which
    // is where the conversion now has to happen. $240,000 is 24,000,000 cents;
    // writing dollars here would read back as $2,400 through `rows.ts`.
    const wageFund = statements.find(
      (s) =>
        s.text.startsWith("INSERT INTO funding_sources") &&
        s.params.includes("wage_subsidy") &&
        s.params.includes("mkt-pittsburg"),
    )!;
    expect(wageFund.params).toContain(24_000_000);
    expect(wageFund.params).toContain(2_000);
  });

  it("leaves a market carrying no money of its own", () => {
    // Pinned so a well-meaning re-add is caught here rather than by two screens
    // disagreeing about the same allocation.
    const marketInsert = statements.find((s) =>
      s.text.startsWith("INSERT INTO markets"),
    )!;
    expect(marketInsert.text).not.toContain("subsidy_budget_cents");
    expect(marketInsert.text).not.toContain("subsidy_rate_cents");
  });

  it("seeds no session and no sign-in code", () => {
    // Worth asserting rather than assuming. A fixture session would be a
    // credential anyone could read out of this repository and present.
    const auth = statements.filter(
      (s) =>
        s.text.startsWith("INSERT INTO sessions") ||
        s.text.startsWith("INSERT INTO sign_in_codes"),
    );
    expect(auth).toEqual([]);
  });

  it("records how each organization signs in", () => {
    // Boards default to federated, which is the seeded claim: a government
    // organization is locked to its own identity provider.
    const board = statements.find(
      (s) =>
        s.text.startsWith("INSERT INTO organizations") && s.params.includes("board"),
    )!;
    expect(board.params).toContain("federated");
  });

  it("writes no rate on a fund that is not paid by the hour", () => {
    // The schema refuses one, and a rate on a grant is a number nothing would
    // ever multiply.
    const grant = statements.find(
      (s) =>
        s.text.startsWith("INSERT INTO funding_sources") &&
        s.params.includes("credit_cost"),
    )!;
    // Position 8 is rate_cents in the insert's column list.
    expect(grant.params[8]).toBeNull();
  });

  it("attributes a verified student, which the schema requires", () => {
    const verified = statements.filter(
      (s) => s.text.startsWith("INSERT INTO students") && s.params[13] !== null,
    );
    expect(verified.length).toBeGreaterThan(0);
    for (const statement of verified) {
      // `verification_is_attributable` refuses a verified student with no
      // verifier, and the domain's Student does not carry one.
      expect(statement.params[14]).not.toBeNull();
    }
  });
});
