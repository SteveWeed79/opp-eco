import { test, expect } from "@playwright/test";

/**
 * The opportunity page, and the reason it exists.
 *
 * A posting cannot be published without a description — the college's publish
 * guard refuses an empty one — and yet the only surfaces that rendered it were
 * the employer's own drafts and the college's drafting queue. Students, the
 * people it is written for, were asked to apply to a title and a wage.
 *
 * Read-only, so this sorts before the suites that mutate posting state.
 */

test("a student can read the description before applying", async ({ page }) => {
  await page.goto("/student");

  const listing = page
    .getByRole("listitem")
    .filter({ has: page.locator('a[href^="/opportunities/"]') })
    .first();

  // The description is on the listing itself, not only behind the link — the
  // point is that a student is not asked to decide from a title alone.
  const summary = (await listing.innerText()).trim();
  expect(summary.length).toBeGreaterThan(80);

  const link = listing.locator('a[href^="/opportunities/"]').first();
  const title = (await link.innerText()).trim();
  const href = (await link.getAttribute("href"))!;

  await page.goto(href);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

  // The full text, the skills it matches on, and the terms.
  await expect(page.getByRole("heading", { name: "What the work is" })).toBeVisible();
  await expect(page.getByText("Required", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Terms" })).toBeVisible();
});

test("the page is a shareable link, not an expander", async ({ page }) => {
  // The realistic path into this program is an advisor sending a student a
  // link, so the URL has to stand on its own and its preview has to say what
  // it is rather than naming the product.
  await page.goto("/opportunities/post-frontier-nursing");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/Frontier Health Partners/);
  await expect(page).toHaveTitle(/^\[Demo\]/);
});

test("an unpublished posting is indistinguishable from one that does not exist", async ({
  page,
}) => {
  // Signed out, the viewer is the demo student. `post-heartland-help` is a
  // real posting sitting with the college, and `post-does-not-exist` is not a
  // posting at all — they have to answer identically, or the URL becomes an
  // oracle for which drafts an employer has in progress.
  const missing = await page.goto("/opportunities/post-does-not-exist");
  const draft = await page.goto("/opportunities/post-heartland-help");

  expect(missing?.status()).toBe(404);
  expect(draft?.status()).toBe(404);
});

test("the college can open the posting it is being asked to publish", async ({
  page,
}) => {
  // Signed in for real, not the signed-out demo fallback. That fallback treats
  // an opportunity page's visitor as a student, and a student cannot open an
  // unpublished posting — so the college portal offers the link only to a
  // genuine session, and this is the path that link is for.
  await page.goto("/");
  await page.getByRole("button", { name: "Sign on" }).click();
  await page.getByRole("radio", { name: /Ellen Vance/ }).click();
  await page.getByRole("button", { name: "Enter portal" }).click();
  await page.waitForURL("**/college");

  const review = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Request changes" }) })
    .first();
  await expect(review).toBeVisible();

  // Publishing is a judgement about the work, so the work is one click away.
  const link = review.locator('a[href^="/opportunities/"]').first();
  await expect(link).toBeVisible();

  await page.goto((await link.getAttribute("href"))!);
  await expect(page.getByRole("heading", { name: "What the work is" })).toBeVisible();
  // Not published yet, so its state leads rather than being left to inference.
  await expect(page.getByText("Awaiting review")).toBeVisible();
});
