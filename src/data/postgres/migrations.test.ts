/**
 * The migration runner's SQL surgery, checked against the real files.
 *
 * This exists because the first version of it was wrong in a way no unit test
 * with a synthetic fixture would have caught: both migrations open with a
 * paragraph of `--` comments, so a `startsWith("BEGIN")` check reported them
 * as managing no transaction, and the runner wrapped an already-transactional
 * file in a second BEGIN/COMMIT. So these assertions run against the files as
 * they actually are on disk.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isSelfTransacting,
  stripLeadingComments,
  withLedgerInsert,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore -- plain JS helper shared with the CLI, which cannot import TS
} from "../../../scripts/migrations.mjs";

const DIR = join(process.cwd(), "src", "data", "postgres", "migrations");

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, body: readFileSync(join(DIR, name), "utf8") }));

describe("the migrations on disk", () => {
  it("finds some", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => f.name))("%s opens and closes its own transaction", (name) => {
    const file = files.find((f) => f.name === name)!;
    expect(isSelfTransacting(file.body)).toBe(true);
  });

  it.each(files.map((f) => f.name))(
    "%s is recorded inside that same transaction",
    (name) => {
      const file = files.find((f) => f.name === name)!;
      const out: string = withLedgerInsert({ ...file, checksum: "deadbeef" });

      // Exactly one transaction, not a nested pair.
      //
      // Counted as `BEGIN;` with the semicolon, which is what separates
      // transaction control from the `BEGIN` that opens a plpgsql function
      // body — 0001 has two of those inside `$$ … $$`, one of them the
      // trigger that makes `audit_events` append-only.
      expect(out.match(/^BEGIN\s*;/gim) ?? []).toHaveLength(1);
      expect(out.match(/^COMMIT\s*;/gim) ?? []).toHaveLength(1);

      // And the ledger insert lands before the commit, not after it.
      const insertAt = out.indexOf("INSERT INTO schema_migrations");
      const commitAt = out.lastIndexOf("COMMIT;");
      expect(insertAt).toBeGreaterThan(-1);
      expect(insertAt).toBeLessThan(commitAt);
      expect(out).toContain(`'${name}'`);
    },
  );
});

describe("stripLeadingComments", () => {
  it("removes a leading comment block and the blank lines around it", () => {
    const text = "-- one\n-- two\n\nBEGIN;\nSELECT 1;\nCOMMIT;";
    expect(stripLeadingComments(text)).toBe("BEGIN;\nSELECT 1;\nCOMMIT;");
  });

  it("leaves comments that follow real statements alone", () => {
    const text = "BEGIN;\n-- explaining the next line\nSELECT 1;\nCOMMIT;";
    expect(stripLeadingComments(text)).toBe(text);
  });
});

describe("withLedgerInsert", () => {
  it("wraps a file that does not manage its own transaction", () => {
    const out: string = withLedgerInsert({
      name: "0003_thing.sql",
      body: "ALTER TABLE markets ADD COLUMN note text;",
      checksum: "abc123",
    });

    expect(out.startsWith("BEGIN;")).toBe(true);
    expect(out.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(out.match(/^BEGIN\s*;/gim) ?? []).toHaveLength(1);
    expect(out.indexOf("INSERT INTO schema_migrations")).toBeLessThan(
      out.lastIndexOf("COMMIT;"),
    );
  });

  it("does not double-wrap a self-transacting file", () => {
    const out: string = withLedgerInsert({
      name: "0004_thing.sql",
      body: "-- a comment\nBEGIN;\nSELECT 1;\nCOMMIT;\n",
      checksum: "abc123",
    });
    expect(out.match(/^BEGIN\s*;/gim) ?? []).toHaveLength(1);
  });

  it("escapes quotes rather than letting them close the literal", () => {
    const out: string = withLedgerInsert({
      name: "0005_o'brien.sql",
      body: "SELECT 1;",
      checksum: "abc",
    });
    expect(out).toContain("'0005_o''brien.sql'");
  });
});
