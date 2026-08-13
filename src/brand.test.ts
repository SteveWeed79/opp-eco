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

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, found);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

describe("the brand name lives in exactly one place", () => {
  it("is not spelled literally anywhere else in src/", () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => !path.endsWith("brand.ts") && !path.endsWith("brand.test.ts"))
      .filter((path) => readFileSync(path, "utf8").includes(brand.name))
      .map((path) => path.replace(`${process.cwd()}/`, ""));

    // If this fails, import from `@/brand` instead of typing the name.
    expect(offenders).toEqual([]);
  });

  it("does not hardcode the product domain either", () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => !path.endsWith("brand.ts") && !path.endsWith("brand.test.ts"))
      .filter((path) => readFileSync(path, "utf8").includes(brand.domain))
      .map((path) => path.replace(`${process.cwd()}/`, ""));

    expect(offenders).toEqual([]);
  });

  it("leaves the domain noun alone", () => {
    // "opportunity" is product vocabulary as well as half the brand — an
    // employer posts an opportunity, a student sees other opportunities. A
    // rename must not touch those, so this asserts they are still there and
    // are not coming from `brand`.
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
