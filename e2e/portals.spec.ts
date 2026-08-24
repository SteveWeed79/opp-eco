import { test, expect, type Page } from "@playwright/test";

/**
 * Every page renders, cleanly.
 *
 * These check the class of failure a green build cannot rule out: the code
 * compiles, the bundle ships, and the page still throws on render. Several
 * real bugs this project has hit were exactly that shape.
 */

/**
 * The venture pages. Real work, real figures, and no demonstration notice —
 * a disclaimer on them would be as false as its absence is on the prototype.
 */
const SITE_PAGES = [
  { path: "/", name: "home" },
  { path: "/approach", name: "approach" },
  { path: "/partners", name: "partners" },
  { path: "/evidence", name: "evidence" },
  { path: "/contact", name: "contact" },
];

/** The prototype. Every one of these carries the notice. */
const DEMO_PAGES = [
  { path: "/demo", name: "prototype landing" },
  { path: "/demo/admin", name: "admin" },
  { path: "/demo/admin/audit", name: "audit log" },
  { path: "/demo/student", name: "student" },
  { path: "/demo/business", name: "business" },
  { path: "/demo/college", name: "college" },
  { path: "/demo/board", name: "board" },
  { path: "/demo/design", name: "component gallery" },
  { path: "/demo/opportunities/post-frontier-nursing", name: "opportunity detail" },
];

const PORTALS = [...SITE_PAGES, ...DEMO_PAGES];

/** Collect anything the browser complains about while a page loads. */
function watchForProblems(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  return problems;
}

for (const portal of PORTALS) {
  test.describe(portal.name, () => {
    test("renders without errors", async ({ page }) => {
      const problems = watchForProblems(page);
      const response = await page.goto(portal.path);

      expect(response?.status()).toBe(200);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(problems).toEqual([]);
    });

    test("does not scroll sideways", async ({ page }) => {
      await page.goto(portal.path);
      // A page whose body scrolls horizontally is broken on a phone, and it is
      // the failure most easily missed on a desktop screenshot.
      const overflows = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(overflows).toBe(false);
    });

  });
}

for (const portal of DEMO_PAGES) {
  test(`${portal.name} carries the demonstration notice`, async ({ page }) => {
    await page.goto(portal.path);
    // The notice has to travel with every page under `/demo`, because a
    // forwarded link to one of them lands somewhere with no other context.
    await expect(
      page.getByText("Demonstration", { exact: false }).first(),
    ).toBeVisible();
  });
}

for (const page_ of SITE_PAGES) {
  test(`${page_.name} does not carry it`, async ({ page }) => {
    await page.goto(page_.path);
    // The other half of the same rule, and the reason the split exists: the
    // venture pages describe real work, and a demonstration banner across
    // them would be a disclaimer for something that is not a demonstration.
    await expect(page.getByText("Demonstration", { exact: false })).toHaveCount(0);
  });
}

test.describe("security headers", () => {
  test("are set on a page response", async ({ page }) => {
    const response = await page.goto("/demo/student");
    const headers = response!.headers();

    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("nonce-");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
  });

  test("the CSP does not block hydration", async ({ page }) => {
    // A nonce-based CSP that blocks React's own scripts leaves a page that
    // renders and does nothing. Interactivity is the only real proof.
    const problems = watchForProblems(page);
    await page.goto("/demo/design");

    await page.getByRole("tab", { name: /Forms/ }).click();
    await expect(page.getByText("Slot picker")).toBeVisible();

    expect(problems.filter((p) => /Content Security Policy|Refused to/i.test(p))).toEqual([]);
  });

  test("stylesheets load under the policy", async ({ page }) => {
    await page.goto("/demo/student");
    const background = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    // Transparent would mean the stylesheet was blocked.
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
  });
});

test.describe("not found", () => {
  test("returns a real 404 and offers the portals", async ({ page }) => {
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("link", { name: "Administrator" })).toBeVisible();
  });
});
