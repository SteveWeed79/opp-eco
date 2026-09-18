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
import {
  seedInto,
  reseedInto,
  parseArgs,
  DEMO_DELETES,
  CASCADED_TABLES,
  PRESERVED_TABLES,
  FIXTURE_IDS,
  RUNTIME_TABLES,
  TABLES,
} from "../../../scripts/seed.mjs";

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
    // The exclusions come from the seed script itself rather than from a copy
    // kept here. A second list is a list that goes stale, and this one did:
    // four credential tables were added to the truncation and this test failed
    // on tables it was never going to be right about.
    const runtime = new Set(RUNTIME_TABLES);
    const expected = TABLES.filter((t: string) => !runtime.has(t));
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

  it("seeds no uploaded file", () => {
    // The truncation clears the table, so it has to be listed; seeding it would
    // put somebody's document in the repository.
    expect(
      statements.filter((s) => s.text.startsWith("INSERT INTO uploaded_files")),
    ).toEqual([]);
  });

  it("seeds no credential of any kind", () => {
    // Worth asserting rather than assuming. A fixture session or password would
    // be a working credential anyone could read out of this repository and
    // present — and a seeded password is one that every checkout knows and
    // every deployment starts life with.
    const credentials = [
      "sessions",
      "sign_in_codes",
      "user_passwords",
      "user_totp",
      "user_recovery_codes",
      "mfa_challenges",
    ];
    const written = statements.filter((s) =>
      credentials.some((table) => s.text.startsWith(`INSERT INTO ${table}`)),
    );
    expect(written).toEqual([]);
  });

  it("records how each organization signs in", () => {
    // The board seeds onto codes rather than `federated`: it still holds no
    // password for a public employee — and no authenticator seed either, since
    // the factor is the agency's own mailbox — and it no longer locks the
    // agency out of a pilot for want of an SSO adapter.
    const board = statements.find(
      (s) =>
        s.text.startsWith("INSERT INTO organizations") && s.params.includes("board"),
    )!;
    expect(board.params).toContain("email_code");
    expect(board.params).not.toContain("password");

    // Colleges and employers get passwords, and their learners inherit it.
    const college = statements.find(
      (s) =>
        s.text.startsWith("INSERT INTO organizations") && s.params.includes("college"),
    )!;
    expect(college.params).toContain("password");
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

// ---------------------------------------------------------------------------
// What the truncate is allowed to destroy
// ---------------------------------------------------------------------------

/**
 * A database that answers, so the decision the seed makes before truncating can
 * be tested without one.
 *
 * `answer` is given each statement and returns the rows for it; anything it
 * does not recognise comes back empty, which is what every INSERT wants.
 */
function fakeDatabase(
  answer: (
    text: string,
    params: unknown[],
  ) => { rows: unknown[]; fields?: { name: string }[] } | undefined = () => undefined,
) {
  const statements: Recorded[] = [];
  return {
    statements,
    async query(text: string, params: unknown[] = []) {
      statements.push({ text, params });
      return answer(text, params) ?? { rows: [] };
    },
  };
}

const REAL_ADMIN = {
  id: "u-m1kf3a2",
  name: "A Real Administrator",
  email: "admin@a-real-domain.org",
};

/** Answers no administrators and nothing foreign — a freshly migrated database. */
const empty = (text: string) =>
  text.includes("count(*)") ? { rows: [{ count: 0 }] } : { rows: [] };

describe("what a re-seed is allowed to remove", () => {
  it("issues no TRUNCATE, anywhere", async () => {
    // The whole change. A truncate empties a table; these statements empty the
    // demonstration and leave whatever else is in there alone.
    const db = fakeDatabase(empty);
    await reseedInto(db);
    expect(db.statements.filter((s) => /TRUNCATE/i.test(s.text))).toEqual([]);
  });

  it("gives every placeholder in a delete a parameter, and every parameter a placeholder", () => {
    // The same check the inserts get, and for the same reason — except this one
    // is worse: a delete whose `$2` has no parameter does not return the wrong
    // rows, it throws mid-clear, halfway through emptying the demonstration.
    // Written after exactly that happened here.
    for (const entry of DEMO_DELETES) {
      const highest = Math.max(
        0,
        ...[...entry.sql.matchAll(/\$(\d+)/g)].map((m: RegExpMatchArray) => Number(m[1])),
      );
      const params = entry.params({ markets: [], users: [] });
      expect(highest, `${entry.table}: ${entry.sql}`).toBe(params.length);
    }
  });

  it("scopes every delete — none of them can empty a table", () => {
    // An unscoped DELETE is a TRUNCATE with extra steps, and it is the one
    // mistake in this list that would destroy a real market silently.
    for (const entry of DEMO_DELETES) {
      expect(entry.sql, `${entry.table} has no predicate`).toMatch(/\sWHERE\s/i);
    }
  });

  it("handles every table in the schema, explicitly or by cascade", () => {
    // A table added to the schema and forgotten here would keep its
    // demonstration rows through a re-seed and accumulate forever. The lists
    // come from the script rather than from a copy kept in this file, because a
    // second list is a list that goes stale.
    const handled = new Set([
      ...DEMO_DELETES.map((d: { table: string }) => d.table),
      ...CASCADED_TABLES,
      ...PRESERVED_TABLES,
    ]);
    expect(TABLES.filter((t: string) => !handled.has(t))).toEqual([]);
  });

  it("deletes no audit event, and so cannot delete a market or a user either", () => {
    // `audit_events` has a BEFORE UPDATE OR DELETE trigger that raises —
    // deliberately, since SECURITY.md names audit tampering as one of the most
    // serious findings here. The old TRUNCATE was getting around that guard
    // rather than respecting it, because truncation does not fire row triggers.
    //
    // `markets` and `users` follow: audit rows reference both ON DELETE
    // RESTRICT, so once the application has written one, neither can be
    // deleted at all. The fixtures upsert them instead.
    const tables = DEMO_DELETES.map((d: { table: string }) => d.table);
    expect(tables).not.toContain("audit_events");
    expect(tables).not.toContain("markets");
    expect(tables).not.toContain("users");
    expect(PRESERVED_TABLES.sort()).toEqual(["audit_events", "markets", "users"]);
  });

  it("removes the organizations last, because everything else restricts to them", () => {
    const tables = DEMO_DELETES.map((d: { table: string }) => d.table);
    expect(tables.at(-1)).toBe("organizations");
  });

  it("reaches the fixture administrator's membership, which has no market", () => {
    // `admin_is_cross_market` makes it null, so a market predicate alone never
    // matches it — and the `users` delete that follows would then fail on the
    // foreign key. This is the one entry where the second clause is load-bearing.
    const memberships = DEMO_DELETES.find(
      (d: { table: string }) => d.table === "memberships",
    )!;
    expect(memberships.sql).toMatch(/user_id = ANY/);
  });

  it("names the demonstration's markets and the fixtures' users, and nothing else", async () => {
    const db = fakeDatabase((text) =>
      text.includes("SELECT id FROM markets WHERE is_demo_data")
        ? { rows: [{ id: "mkt-pittsburg" }] }
        : empty(text),
    );
    await reseedInto(db);

    const deletes = db.statements.filter((s) => s.text.startsWith("DELETE"));
    expect(deletes.length).toBeGreaterThan(0);
    for (const statement of deletes) {
      for (const param of statement.params) {
        if (!Array.isArray(param)) continue;
        // Every array parameter is either the demonstration's markets or the
        // fixtures' own ids. A real market or a real account appearing here is
        // the failure this whole design exists to prevent.
        for (const value of param) {
          const known =
            value === "mkt-pittsburg" || FIXTURE_IDS.users.includes(value);
          expect(known, `${String(value)} is not the demonstration's`).toBe(true);
        }
      }
    }
  });

  it("reports what it left alone rather than refusing to run", async () => {
    // The refusal is gone: it existed because a truncate could not tell a
    // fixture from somebody's work. A guard that fires on every real deployment
    // is a guard whose override becomes the command everybody types.
    const db = fakeDatabase((text) =>
      text.includes("FROM students WHERE id <> ALL")
        ? { rows: [{ count: 12 }] }
        : empty(text),
    );
    const outcome = await reseedInto(db);
    expect(outcome.untouched).toContainEqual({ table: "students", count: 12 });
    expect(db.statements.some((s) => s.text.startsWith("DELETE"))).toBe(true);
  });
});

describe("administrators are simply not named", () => {
  /** A database holding one real administrator. */
  function withRealAdmin() {
    return fakeDatabase((text) => {
      if (text.includes("JOIN memberships m ON m.user_id = u.id AND m.role = 'admin'")) {
        return { rows: [REAL_ADMIN] };
      }
      return empty(text);
    });
  }

  it("never puts a real administrator's id in a delete", async () => {
    const db = withRealAdmin();
    const outcome = await reseedInto(db);

    expect(outcome.preserved).toEqual([REAL_ADMIN]);
    for (const statement of db.statements.filter((s) => s.text.startsWith("DELETE"))) {
      for (const param of statement.params.flat()) {
        expect(param).not.toBe(REAL_ADMIN.id);
      }
    }
  });

  it("captures and restores nothing, because nothing is destroyed", async () => {
    // The capture-and-restore this file used to do existed to carry an account
    // over a truncate. There is no truncate, so a real administrator's password
    // and authenticator are never read, never re-inserted, and never at risk of
    // a restore that half-worked.
    const db = withRealAdmin();
    await reseedInto(db);
    expect(db.statements.some((s) => s.text.startsWith("SELECT * FROM user_passwords"))).toBe(
      false,
    );
    expect(db.statements.some((s) => s.text.startsWith("INSERT INTO user_passwords"))).toBe(
      false,
    );
  });

  it("names them only when --replace-admins asks", async () => {
    const db = withRealAdmin();
    const outcome = await reseedInto(db, { replaceAdmins: true });

    expect(outcome.preserved).toEqual([]);
    expect(outcome.replaced).toEqual([REAL_ADMIN]);
    // Their memberships go, which is what takes their access. The `users` row
    // itself cannot be deleted while any audit event names them as the actor,
    // so it is left and the account is left unable to sign in.
    const memberships = db.statements.find((s) =>
      s.text.startsWith("DELETE FROM memberships"),
    )!;
    expect(memberships.params[1]).toContain(REAL_ADMIN.id);
  });
});

describe("arguments", () => {
  it("reads the one flag it has", () => {
    expect(parseArgs([])).toEqual({ replaceAdmins: false });
    expect(parseArgs(["--replace-admins"])).toEqual({ replaceAdmins: true });
  });

  it("tells somebody following an old note that --force is gone", () => {
    // It was documented, so a stale README or a remembered command deserves the
    // reason rather than "unrecognised argument".
    expect(() => parseArgs(["--force"])).toThrow(/no longer destroys anything/);
  });

  it("refuses one it does not, rather than ignoring it", () => {
    // A misspelled `--force` that silently did nothing would be read as a
    // refusal to seed; a misspelled `--replace-admins` that silently did
    // nothing would be read as having dropped an account it kept.
    expect(() => parseArgs(["--forse"])).toThrow(/--forse/);
    expect(() => parseArgs(["-f"])).toThrow();
  });
});
