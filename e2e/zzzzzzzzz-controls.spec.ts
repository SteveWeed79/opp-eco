import { test, expect } from "@playwright/test";

/**
 * The two controls that used to do nothing.
 *
 * Both rendered as raised, primary, entirely convincing buttons and swallowed
 * the click. `Button` no longer type-checks without an action, so this suite is
 * about the features behind them rather than about the buttons — but the first
 * assertion in each is still that something happens at all.
 */

async function signOnAs(page: import("@playwright/test").Page, name: RegExp, path: string) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Sign on" }).click();
  await page.getByRole("radio", { name }).click();
  await page.getByRole("button", { name: "Enter portal" }).click();
  await page.waitForURL(`**${path}`);
}

/**
 * A name unique to this run.
 *
 * The demo store lives in the server process and `reuseExistingServer` means a
 * second `playwright test` runs against the state the first one left. Two runs
 * publishing the same officer at the same time is exactly what the service
 * refuses, so the second run would fail on a guard that is working correctly.
 */
const OFFICER = `R. Okonkwo ${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("the board publishes a morning of interview slots", async ({ page }) => {
  await signOnAs(page, /Marcia Delgado/, "/board");

  await page.getByRole("button", { name: "Publish slots" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // A date well inside the publishing horizon, built from today so the test
  // does not expire.
  const when = new Date();
  when.setDate(when.getDate() + 14);
  const date = when.toISOString().slice(0, 10);

  await page.getByLabel("Date").fill(date);
  // `exact` because `getByLabel` substring-matches, and each row also has a
  // "Remove start time N" button whose label contains the input's.
  await page.getByLabel("Start time 1", { exact: true }).fill("09:00");

  // The next time is offered at the end of the last one, which is what
  // somebody filling this in is about to type anyway.
  await page.getByRole("button", { name: "Add another time" }).click();
  await expect(page.getByLabel("Start time 2", { exact: true })).toHaveValue("09:30");

  await page.getByLabel("Officer sitting these").fill(OFFICER);
  await page.getByRole("button", { name: /Publish 2 slots/ }).click();

  await expect(page.getByRole("status")).toContainText("2 slots published");

  // The board's own calendar now carries them, and the count of *open* slots
  // is what a learner's booking control reads. That count going up is the
  // point: until now the only slots that existed came from the fixtures.
  await expect(page.getByText(OFFICER).first()).toBeVisible();
  const summary = page.getByText(/\d+ open of \d+ published/);
  await expect(summary).toBeVisible();
  const [open, total] = (await summary.innerText()).match(/\d+/g)!.map(Number);
  expect(open).toBeGreaterThanOrEqual(2);
  expect(total).toBeGreaterThanOrEqual(open);

  // Published unbooked, which is the property that makes them bookable at all.
  // Following one into a learner's booking dialog is not assertable here:
  // `booking.spec.ts` runs earlier in the same process and permanently books
  // the seed's only bookable application, so that test could only ever skip.
  // `slots.test.ts` covers the same chain against the store.
});

test("the board is told why it cannot nudge a stalled pair", async ({ page }) => {
  await signOnAs(page, /Marcia Delgado/, "/board");
  const reachOut = page.getByRole("button", { name: "Reach out" }).first();
  if ((await reachOut.count()) > 0) {
    // Disabled with a reason rather than live with no handler. The reason is
    // the useful part: a nudge would go through the college, which owns the
    // learner relationship.
    await expect(reachOut).toBeDisabled();
    await expect(reachOut).toHaveAttribute("title", /college/i);
  }
});

test("a learner edits what they are looking for, but not who they are", async ({
  page,
}) => {
  await signOnAs(page, /Omar/, "/student");

  await page.getByRole("button", { name: "Update profile" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // Name, email and college are absent by design, and the form says so rather
  // than leaving somebody hunting for a field that is not there.
  await expect(page.getByLabel("Email")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toContainText(/not editable here/i);

  await page.getByLabel("Hours a week you can work").fill("22");
  await page.getByLabel("Program of study").fill("Welding Technology");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByRole("status")).toContainText("Profile updated");
  await expect(page.getByText("Welding Technology").first()).toBeVisible();
});

test("the micro card opens the real form, on the track it just explained", async ({
  page,
}) => {
  await signOnAs(page, /Dana Reyes/, "/business");

  // This used to be a second button that did nothing, six hundred lines below
  // a working one that could already produce exactly this.
  await page.getByRole("button", { name: "Post a project" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // Opened on micro: the fee field belongs to that track and the wage field
  // does not.
  await expect(page.getByLabel(/Project fee/i)).toBeVisible();
});
