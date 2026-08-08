import { test, expect } from "@playwright/test";

/**
 * Session establishment.
 *
 * The credential check is simulated, but everything downstream is real: the
 * server decides who you are, sets the cookie, and redirects. The cookie's
 * attributes are asserted because `httpOnly` and `SameSite` are the difference
 * between a session and a value any script on the page can read.
 */

test("signing on sets a server-side session and lands in the portal", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign on" })).toBeVisible();

  await page.getByRole("button", { name: "Sign on" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.getByRole("button", { name: /Dana Reyes/ }).click();
  await page.getByRole("button", { name: "Enter portal" }).click();

  await page.waitForURL("**/business");

  const session = (await context.cookies()).find((c) => c.name === "oe_demo_role");
  expect(session?.value).toBe("business");
  // Not readable from JavaScript, and not sent cross-site.
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");

  await expect(page.locator("header")).toContainText("Dana Reyes");
});

test("signing out clears the session", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign on" }).click();
  await page.getByRole("button", { name: /Marcia Delgado/ }).click();
  await page.getByRole("button", { name: "Enter portal" }).click();
  await page.waitForURL("**/board");

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("http://localhost:3000/");

  const session = (await context.cookies()).find((c) => c.name === "oe_demo_role");
  expect(session).toBeUndefined();
  await expect(page.getByRole("button", { name: "Sign on" })).toBeVisible();
});

test.describe("file downloads", () => {
  test("an unauthenticated request cannot confirm a key exists", async ({
    request,
  }) => {
    const response = await request.get(
      "/api/files/some-key?expires=9999999999&sig=deadbeef",
    );
    // 404 rather than 401: "not yours" and "does not exist" must look the same.
    expect(response.status()).toBe(404);
  });

  test("an unsigned request is refused", async ({ page, request }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign on" }).click();
    await page.getByRole("button", { name: /Steve Weed/ }).click();
    await page.getByRole("button", { name: "Enter portal" }).click();
    await page.waitForURL("**/admin");

    const response = await request.get("/api/files/some-key");
    expect(response.status()).toBe(404);
  });
});
