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
  restoreAdmins,
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

describe("refusing to destroy what the fixtures did not create", () => {
  it("refuses, and truncates nothing, when a table holds foreign rows", async () => {
    const db = fakeDatabase((text) =>
      text.includes("FROM organizations WHERE id <> ALL")
        ? { rows: [{ count: 3 }] }
        : empty(text),
    );

    await expect(reseedInto(db)).rejects.toThrow(/3\s+organizations/);

    // The point of the whole exercise: the refusal happens *before* anything
    // is destroyed, not as an apology afterwards.
    expect(db.statements.filter((s) => s.text.startsWith("TRUNCATE"))).toEqual([]);
  });

  it("names every table it found, not just the first", async () => {
    const db = fakeDatabase((text) =>
      text.includes("WHERE id <> ALL") && text.includes("count(*)")
        ? { rows: [{ count: 7 }] }
        : empty(text),
    );

    const error = await reseedInto(db).catch((e: Error) => e);
    for (const table of Object.keys(FIXTURE_IDS)) {
      expect((error as Error).message).toContain(table);
    }
  });

  it("watches the county list a board actually operates over", () => {
    // A region definition is the one place real, hand-gathered information gets
    // recorded against a seeded market — a WIOA county list is a phone call,
    // not a fixture. Losing it to a re-seed means making that call again.
    expect(Object.keys(FIXTURE_IDS)).toContain("region_definitions");
  });

  it("proceeds under --force, and says what it destroyed", async () => {
    const db = fakeDatabase((text) =>
      text.includes("FROM students WHERE id <> ALL")
        ? { rows: [{ count: 12 }] }
        : empty(text),
    );

    const outcome = await reseedInto(db, { force: true });

    expect(outcome.foreign).toEqual([{ table: "students", count: 12 }]);
    expect(db.statements.some((s) => s.text.startsWith("TRUNCATE"))).toBe(true);
  });

  it("says nothing about a database holding only fixtures", async () => {
    const db = fakeDatabase(empty);
    const outcome = await reseedInto(db);
    expect(outcome.foreign).toEqual([]);
    expect(outcome.preserved).toEqual([]);
  });
});

describe("carrying an administrator through the truncate", () => {
  /** A database holding one real administrator and nothing else foreign. */
  function withRealAdmin() {
    return fakeDatabase((text) => {
      if (text.includes("JOIN memberships m ON m.user_id = u.id AND m.role = 'admin'")) {
        return { rows: [REAL_ADMIN] };
      }
      if (text.startsWith("SELECT * FROM users")) {
        return {
          fields: [{ name: "id" }, { name: "name" }, { name: "email" }],
          rows: [REAL_ADMIN],
        };
      }
      if (text.startsWith("SELECT * FROM user_passwords")) {
        return {
          fields: [{ name: "user_id" }, { name: "password_hash" }, { name: "must_change" }],
          rows: [{ user_id: REAL_ADMIN.id, password_hash: "scrypt$…", must_change: false }],
        };
      }
      return empty(text);
    });
  }

  it("does not count an administrator it is keeping as a foreign row", async () => {
    const db = withRealAdmin();
    await reseedInto(db);

    const usersSurvey = db.statements.find((s) =>
      s.text.includes("FROM users WHERE id <> ALL"),
    )!;
    // Otherwise the seed would refuse because of the very account it is about
    // to preserve, which is a refusal nobody could act on.
    expect(usersSurvey.params[0]).toContain(REAL_ADMIN.id);
  });

  it("puts the account and its password back after the truncate", async () => {
    const db = withRealAdmin();
    const outcome = await reseedInto(db);

    expect(outcome.preserved).toEqual([REAL_ADMIN]);

    const truncate = db.statements.findIndex((s) => s.text.startsWith("TRUNCATE"));
    const restoredUser = db.statements.findIndex(
      (s) => s.text.startsWith("INSERT INTO users") && s.params.includes(REAL_ADMIN.id),
    );
    const restoredPassword = db.statements.findIndex((s) =>
      s.text.startsWith("INSERT INTO user_passwords"),
    );

    expect(truncate).toBeGreaterThanOrEqual(0);
    expect(restoredUser).toBeGreaterThan(truncate);
    expect(restoredPassword).toBeGreaterThan(truncate);
  });

  it("captures the account before the truncate, not after it", async () => {
    const db = withRealAdmin();
    await reseedInto(db);

    const capture = db.statements.findIndex((s) => s.text.startsWith("SELECT * FROM users"));
    const truncate = db.statements.findIndex((s) => s.text.startsWith("TRUNCATE"));
    // Reading the rows out after they were deleted would preserve nothing at
    // all, silently.
    expect(capture).toBeLessThan(truncate);
  });

  it("leaves the session behind", async () => {
    const db = withRealAdmin();
    await reseedInto(db);

    // A password that survives is how the administrator gets back in. A session
    // that survives is a credential issued against a database that no longer
    // exists — `sessions` is truncated and deliberately never restored.
    expect(db.statements.some((s) => s.text.startsWith("SELECT * FROM sessions"))).toBe(false);
    expect(db.statements.some((s) => s.text.startsWith("INSERT INTO sessions"))).toBe(false);
  });

  it("asks only for administrators holding no other role", async () => {
    const db = withRealAdmin();
    await reseedInto(db);

    const lookup = db.statements.find((s) => s.text.includes("JOIN memberships m"))!;
    // Every non-admin membership names an organization that the truncate is
    // about to remove, so an account holding one cannot be carried through —
    // it has to fall to the refusal instead.
    expect(lookup.text).toContain("other.role <> 'admin'");
    expect(lookup.params[0]).toEqual(FIXTURE_IDS.users);
  });

  it("drops them under --replace-admins, and reports it", async () => {
    const db = withRealAdmin();
    const outcome = await reseedInto(db, { replaceAdmins: true });

    expect(outcome.preserved).toEqual([]);
    expect(outcome.replaced).toEqual([REAL_ADMIN]);
    expect(db.statements.some((s) => s.text.startsWith("SELECT * FROM user_passwords"))).toBe(
      false,
    );
  });

  it("does not need --force to drop them under --replace-admins", async () => {
    // The flag is itself the consent for that specific destruction. Requiring
    // both would make the habitual command the one that also wipes real data.
    const db = withRealAdmin();
    await expect(reseedInto(db, { replaceAdmins: true })).resolves.toBeTruthy();
  });

  it("carries a column the capture was never told about", async () => {
    // `user_totp.secret` is stored in the clear today and will not always be.
    // A restore that listed its columns here would silently drop whatever a
    // migration adds; this one reads them off the result.
    const db = fakeDatabase();
    await restoreAdmins(db, [
      {
        table: "user_totp",
        columns: ["user_id", "secret", "secret_key_id", "confirmed_at"],
        rows: [
          {
            user_id: REAL_ADMIN.id,
            secret: "ENCRYPTED",
            secret_key_id: "key-2026",
            confirmed_at: null,
          },
        ],
      },
    ]);

    const insert = db.statements[0];
    expect(insert.text).toBe(
      "INSERT INTO user_totp (user_id, secret, secret_key_id, confirmed_at) VALUES ($1,$2,$3,$4)",
    );
    expect(insert.params).toEqual([REAL_ADMIN.id, "ENCRYPTED", "key-2026", null]);
  });
});

describe("arguments", () => {
  it("reads the two flags it has", () => {
    expect(parseArgs([])).toEqual({ force: false, replaceAdmins: false });
    expect(parseArgs(["--force"])).toEqual({ force: true, replaceAdmins: false });
    expect(parseArgs(["--replace-admins", "--force"])).toEqual({
      force: true,
      replaceAdmins: true,
    });
  });

  it("refuses one it does not, rather than ignoring it", () => {
    // A misspelled `--force` that silently did nothing would be read as a
    // refusal to seed; a misspelled `--replace-admins` that silently did
    // nothing would be read as having dropped an account it kept.
    expect(() => parseArgs(["--forse"])).toThrow(/--forse/);
    expect(() => parseArgs(["-f"])).toThrow();
  });
});
