import { test, expect } from "@playwright/test";

/**
 * The venture pages and the prototype are two different sites.
 *
 * `/` used to be the prototype's cover page: a program pitch and four
 * statistics computed from seeded fixtures, under a banner explaining that
 * every figure above it was invented. A reader had to hold both frames at
 * once, and a funder given the address had nowhere to land.
 *
 * Splitting them only works if the split holds in the three places anybody
 * would check it — the chrome, the robots directive, and the old links.
 * All three are assertions rather than conventions, because each of them
 * fails silently: a demo banner missing from `/demo` looks fine, an indexed
 * mockup looks fine, and a 404 on a forwarded link is only ever seen by the
 * person who followed it.
 */

test.describe("the venture pages", () => {
  test("carry the site chrome and no demonstration banner", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("navigation", { name: "Site" })).toBeVisible();
    await expect(page.getByText("Demonstration", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Sign on" }),
    ).toHaveCount(0);
    // The prototype is reachable, and labelled as what it is.
    await expect(
      page.getByRole("link", { name: "See the prototype" }),
    ).toBeVisible();
  });

  test("are indexable", async ({ page }) => {
    // The whole site used to be noindex because the whole site was a demo.
    // Leaving that in place after the split would mean the organization has
    // no findable web presence at all.
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // Read the markup rather than waiting on a locator: the passing case is
    // that the tag is absent, and a locator asked for a missing element waits
    // out the whole timeout before it can say so.
    const tags = await page.locator('meta[name="robots"]').all();
    const directives = await Promise.all(
      tags.map((tag) => tag.getAttribute("content")),
    );

    expect(directives.join(" ")).not.toContain("noindex");
  });

  test("state the former name, so a forwarded address resolves", async ({
    page,
  }) => {
    await page.goto("/");
    // The venture is still published on the domain it launched under. A
    // reader who cannot tell whether they have arrived at the right
    // organization leaves.
    await expect(page.locator("footer")).toContainText("opportunityecosystem.org");
  });

  test("offer a way to reply", async ({ page }) => {
    await page.goto("/contact");
    const mailto = page.locator('a[href^="mailto:"]').first();
    await expect(mailto).toBeVisible();
    // Not the prototype's reserved domain, which cannot receive mail.
    await expect(mailto).not.toHaveAttribute("href", /\.example/);
  });
});

test.describe("the prototype", () => {
  test("keeps its banner and its portal switcher", async ({ page }) => {
    await page.goto("/demo");

    await expect(page.getByText("Demonstration", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Demo portal switcher" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign on" })).toBeVisible();
  });

  test("is not indexed", async ({ page }) => {
    await page.goto("/demo");

    const robots = await page
      .locator('meta[name="robots"]')
      .getAttribute("content");

    expect(robots).toContain("noindex");
  });

  test("says so in the title, so a link preview does", async ({ page }) => {
    await page.goto("/demo/admin");
    await expect(page).toHaveTitle(/^\[Demo\]/);
  });
});

test.describe("links to the old addresses", () => {
  // Forwarded emails, browser history, and anything anyone pasted into a chat
  // while walking somebody through the demo.
  for (const path of ["/student", "/business", "/college", "/board", "/admin"]) {
    test(`${path} still arrives somewhere`, async ({ page }) => {
      const response = await page.goto(path);

      expect(response?.status()).toBe(200);
      await expect(page).toHaveURL(new RegExp(`/demo${path}$`));
    });
  }

  test("a nested old path keeps its tail", async ({ page }) => {
    await page.goto("/admin/outbox");
    await expect(page).toHaveURL(/\/demo\/admin\/outbox$/);
  });
});
