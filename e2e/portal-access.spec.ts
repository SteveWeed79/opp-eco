import { test, expect } from "@playwright/test";

/**
 * What a signed-in session can reach.
 *
 * Signed out, every portal is browsable — that is how a demonstration gets
 * walked through, and each screen has to work from a bare link.
 *
 * Signed in, only your own. An administrator's session used to be handed to
 * whichever portal it asked for, on the theory that oversight means seeing
 * what others see. It does not: every portal reads an organization and a
 * market off the membership, an administrator holds neither, and all four
 * non-admin portals threw on a null dereference and rendered the error
 * boundary. So this pins both halves — the switcher does not offer them, and
 * typing the URL does not reach them either.
 */

const OTHER_PORTALS = [
  { path: "/student", label: "Student" },
  { path: "/business", label: "Business" },
  { path: "/college", label: "College" },
  { path: "/board", label: "Workforce Board" },
];

test.describe("signed in as an administrator", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([
      {
        name: "oe_demo_role",
        value: "admin",
        domain: "localhost",
        path: "/",
      },
    ]);
    await page.goto("/admin");
    await expect(page.locator("header")).toContainText("Steve Weed");
  });

  test("the other portals are not offered in the switcher", async ({ page }) => {
    for (const portal of OTHER_PORTALS) {
      // A disabled button rather than a dimmed link: genuinely unclickable,
      // and announced as unavailable rather than looking like a dead link.
      const chip = page
        .getByRole("button", { name: portal.label, exact: true })
        .first();
      await expect(chip).toBeVisible();
      await expect(chip).toBeDisabled();
    }
  });

  test("the administrator's own portal is still a link", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Admin", exact: true }).first()).toBeVisible();
  });

  for (const portal of OTHER_PORTALS) {
    test(`navigating directly to ${portal.path} lands back on /admin`, async ({
      page,
    }) => {
      // The switcher hiding a route proves nothing about what a URL can reach,
      // which is this codebase's standing rule about authorization.
      await page.goto(portal.path);
      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByText("Program administrator").first()).toBeVisible();
    });
  }

  test("no portal renders the error boundary", async ({ page }) => {
    for (const portal of OTHER_PORTALS) {
      await page.goto(portal.path);
      await expect(page.getByText("This page didn't load")).toHaveCount(0);
    }
  });
});

test.describe("signed out", () => {
  test("every portal is still browsable, which the demo depends on", async ({
    page,
  }) => {
    for (const portal of [...OTHER_PORTALS, { path: "/admin", label: "Admin" }]) {
      await page.goto(portal.path);
      await expect(page).toHaveURL(new RegExp(`${portal.path}$`));
      await expect(page.getByText("This page didn't load")).toHaveCount(0);
    }
  });

  test("the switcher offers all five", async ({ page }) => {
    await page.goto("/");
    for (const label of ["Admin", "Student", "Business", "College", "Workforce Board"]) {
      await expect(
        page.getByRole("link", { name: label, exact: true }).first(),
      ).toBeVisible();
    }
  });
});
