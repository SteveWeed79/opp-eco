import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The gate is in the right place.
 *
 * This is a structural test because the bug it guards against is structural,
 * and because nothing about the code looks wrong when it happens. The five
 * portal pages all called `actorForPortal` and all of them refused correctly —
 * but each segment also has a `loading.tsx`, so the page ran inside a Suspense
 * boundary, after the response had committed. Next could not answer 307 by
 * then, so an anonymous request to a portal got 200 and the skeleton, with the
 * redirect tacked on as a client-side instruction. A browser followed it. A
 * scanner, a link unfurler, or anything else reading the status did not.
 *
 * Nothing in a type or a unit test catches that. Adding one file next to a page
 * silently changes what a `redirect()` in that page means, so the rule has to
 * be checked as a rule: **a segment that streams a fallback must refuse above
 * it.**
 */

const DEMO = join(process.cwd(), "src/app/demo");

function segmentsWithLoading(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = join(dir, entry.name);
    if (existsSync(join(child, "loading.tsx"))) found.push(child);
    segmentsWithLoading(child, found);
  }
  return found;
}

describe("the portal gate", () => {
  const streaming = segmentsWithLoading(DEMO);

  it("finds the segments it is meant to be checking", () => {
    // Guards the test itself: a walk that silently finds nothing would pass
    // every assertion below while checking nothing at all.
    expect(streaming.length).toBeGreaterThanOrEqual(5);
  });

  it.each(streaming)("%s refuses above its own loading boundary", (segment) => {
    const layout = join(segment, "layout.tsx");
    expect(
      existsSync(layout),
      `${segment} streams a loading fallback, so a redirect from its page ` +
        `arrives after the response has committed. It needs a layout.tsx that ` +
        `gates, because a layout renders above the boundary.`,
    ).toBe(true);
    expect(readFileSync(layout, "utf8")).toContain("portalLayout(");
  });

  it.each(streaming)("%s gates for the role its own page reads", (segment) => {
    const portal = segment.split("/").pop();
    expect(readFileSync(join(segment, "layout.tsx"), "utf8")).toContain(
      `portalLayout("${portal}")`,
    );
    // The page keeps its own call. The layout is the one that can still answer
    // with a status code; the page is the one that cannot be deleted without
    // the portal noticing.
    expect(readFileSync(join(segment, "page.tsx"), "utf8")).toContain(
      `actorForPortal("${portal}")`,
    );
  });
});
