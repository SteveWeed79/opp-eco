import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { brand, brandAddress, pageTitle } from "./brand";

/**
 * The name is not settled, so the cost of changing it has to stay at one file.
 *
 * These tests are the thing that keeps that true. Without them the literal
 * string creeps back in one call site at a time — a page title here, an email
 * header there — and the next rename becomes a sweep again.
 */

const SRC = join(process.cwd(), "src");

/**
 * Names this product has been called before.
 *
 * The check below is for the *current* name, which by construction cannot
 * catch a leftover of a previous one — and the first real rename proved that
 * gap immediately: the schema's header comment still carried the old name
 * because nothing was looking for it.
 *
 * Add to this list on every rename rather than trusting a grep done on the day.
 */
const FORMER_NAMES = ["Opportunity Ecosystem", "opportunityecosystem"];

/**
 * SQL is included deliberately. The migration carries the product name in its
 * header, which is exactly the kind of place a rename misses: it compiles,
 * nothing imports it, and no test read it until this one did.
 */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, found);
    } else if (/\.(ts|tsx|sql|css)$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

/** Everything under `src/` except the one file allowed to spell the name. */
function scannable(): string[] {
  return sourceFiles(SRC).filter(
    (path) => !path.endsWith("brand.ts") && !path.endsWith("brand.test.ts"),
  );
}

const relative = (path: string) => path.replace(`${process.cwd()}/`, "");

describe("the brand name lives in exactly one place", () => {
  it("is not spelled literally anywhere else in src/", () => {
    const offenders = scannable()
      .filter((path) => readFileSync(path, "utf8").includes(brand.name))
      .map(relative);

    // If this fails, import from `@/brand` instead of typing the name.
    expect(offenders).toEqual([]);
  });

  it("does not hardcode the product domain either", () => {
    const offenders = scannable()
      .filter((path) => readFileSync(path, "utf8").includes(brand.domain))
      .map(relative);

    expect(offenders).toEqual([]);
  });

  it.each(FORMER_NAMES)("has no leftover %s", (former) => {
    // The check above is for the name we have now, so it cannot see a stale
    // one. That is not hypothetical: renaming to CCLN left the old name in the
    // schema header, which no test was reading.
    const offenders = scannable()
      .filter((path) => readFileSync(path, "utf8").includes(former))
      .map(relative);

    expect(offenders).toEqual([]);
  });

  it("leaves the domain noun alone", () => {
    // "opportunity" is this product's vocabulary — an employer posts an
    // opportunity, a student sees other opportunities — and it was also half
    // the old name, which is what made that rename risky enough to be worth
    // testing. The noun has to survive every rename that follows.
    const templates = readFileSync(join(SRC, "services/templates.ts"), "utf8");

    expect(templates).toContain("opportunit");
    expect(templates).not.toContain(brand.name);
  });
});

describe("derived strings", () => {
  it("builds addresses at the product domain", () => {
    expect(brandAddress("admin")).toBe(`admin@${brand.domain}`);
  });

  it("leads page titles with the demo marker", () => {
    // A forwarded link preview is often the only context a second-hand
    // recipient gets, so "[Demo]" has to come first.
    expect(pageTitle()).toMatch(/^\[Demo\]/);
    expect(pageTitle("Component library")).toMatch(/^\[Demo\] Component library/);
  });

  it("keeps the two-tone header parts consistent with the full name", () => {
    // Kept as separate fields rather than split at the call site, so a
    // one-word replacement name does not silently render half a header.
    expect(`${brand.lead} ${brand.accent}`).toBe(brand.name);
  });
});
