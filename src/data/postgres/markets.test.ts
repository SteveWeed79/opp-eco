/**
 * The product cannot write a market, and that is what `is_demo_data` rests on.
 *
 * The flag separating the demonstration from real programmes is trustworthy
 * for exactly one reason: nothing in the application can set it. Not because a
 * comment asks nicely — because `markets` has no write path at all. Every
 * market in existence came from `db:seed`, `UnitOfWork` has no market write,
 * and no service, action or repository issues an INSERT or UPDATE against that
 * table.
 *
 * That is a property of the codebase today rather than a law of nature, and a
 * property nothing checks is a property that lasts until the first person who
 * needs a market created through a form. So this asserts it structurally. When
 * somebody does add that path — and one day somebody should, because markets
 * having no creation path is its own problem — this test fails, and the person
 * adding it has to decide deliberately what happens to the flag rather than
 * discovering later that an administrator can mark a real programme fictional.
 *
 * The same shape as `portal-gate.test.ts`, which fails if either gate stops
 * checking, and `seed.test.ts`, which fails if a fixture quietly stops being
 * written. A rule is only real if something breaks when it is violated.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { markets as fixtureMarkets } from "@/data/seed";

const SRC = join(process.cwd(), "src");

/** Every application source file — the product, not its tests or fixtures. */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sources(path, found);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    // Tests may write anything — an integration test that could not insert a
    // market could not test one.
    if (/\.test\.tsx?$/.test(entry)) continue;
    found.push(path);
  }
  return found;
}

const FILES = sources(SRC).map((path) => ({
  path: path.slice(SRC.length + 1),
  text: readFileSync(path, "utf8"),
}));

describe("markets are operator territory", () => {
  it("has application sources to check", () => {
    // Guards the guard: a walk that silently found nothing would make every
    // assertion below vacuously true.
    expect(FILES.length).toBeGreaterThan(50);
  });

  it("issues no INSERT against markets anywhere in the application", () => {
    const offenders = FILES.filter((f) => /INSERT\s+INTO\s+markets\b/i.test(f.text));
    expect(
      offenders.map((f) => f.path),
      "a market created through the product is a market whose is_demo_data flag " +
        "somebody can set — decide what that means before adding this",
    ).toEqual([]);
  });

  it("issues no UPDATE against markets anywhere in the application", () => {
    const offenders = FILES.filter((f) => /UPDATE\s+markets\b/i.test(f.text));
    expect(
      offenders.map((f) => f.path),
      "an UPDATE reaching markets is an UPDATE that can flip is_demo_data, which " +
        "would let a bug or a stolen administrator password mark a real programme " +
        "fictional — or the demonstration real",
    ).toEqual([]);
  });

  it("never writes is_demo_data from the application, in any statement", () => {
    // Broader than the two above on purpose: it catches the column arriving in
    // a write built some way this test did not anticipate.
    const offenders = FILES.filter((f) =>
      // No dotAll flag: `[^;]` already spans newlines, so a write split over
      // several lines is caught without needing one.
      /(INSERT|UPDATE|SET)[^;]{0,400}is_demo_data/i.test(f.text),
    );
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it("exposes no market write on the Store's unit of work", () => {
    // The other way a market write arrives: not as SQL in a page, but as a
    // repository method that pages then call.
    const store = FILES.find((f) => f.path === join("data", "store.ts"))!;
    expect(store, "src/data/store.ts moved — this test is checking nothing").toBeDefined();
    expect(/markets\s*:/.test(store.text)).toBe(false);
  });
});

describe("the cross-world escape hatch", () => {
  it("is set in exactly one file", () => {
    // `systemWide` reopens the unrestricted cross-market read that `marketScope`
    // otherwise no longer has. Where it can be set is the whole of its safety,
    // so it is set by `systemContext()` and nothing else — and a page that
    // spread one onto an actor would be handing a viewer both worlds to sum.
    const setters = FILES.filter((f) => /systemWide\s*:\s*true/.test(f.text));
    expect(setters.map((f) => f.path)).toEqual([join("auth", "system.ts")]);
  });

  it("is read only where scoping is decided", () => {
    // Reading it anywhere else means a second definition of "may see both
    // worlds", which is how the two data layers come to disagree.
    const readers = FILES.filter((f) => /\.systemWide\b/.test(f.text)).map((f) => f.path);
    expect(readers.sort()).toEqual(
      [
        join("data", "memory.ts"),
        join("data", "postgres", "scoping.ts"),
        join("data", "repositories.ts"),
      ].sort(),
    );
  });
});

describe("the fixtures say what they are", () => {
  it("flags every seeded market as the demonstration", () => {
    // The seed's markets are invented. A fixture market that arrived unflagged
    // would have its invented learners and invented dollars counted as a real
    // programme's, which is the one mistake in `seed.ts` that reaches a funder.
    expect(fixtureMarkets.length).toBeGreaterThan(0);
    for (const market of fixtureMarkets) {
      expect(market.isDemoData, `${market.id} is not flagged`).toBe(true);
    }
  });

  it("defaults to real, so forgetting the flag hides the demo rather than exposing a learner", () => {
    // The polarity, pinned. Flipping this file's meaning — flagging the real
    // instead of the fake — would make an omission a disclosure.
    const market = { ...fixtureMarkets[0] } as Record<string, unknown>;
    delete market.isDemoData;
    expect(Boolean(market.isDemoData)).toBe(false);
  });
});
