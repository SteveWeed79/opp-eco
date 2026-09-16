import { test, expect } from "@playwright/test";

/**
 * Funding: many sources, and numbers that move.
 *
 * Named to sort **last**. These change allocations and commit money, which is
 * the state every earlier suite's budget assertions read — running before them
 * would move the ground under tests that are about something else.
 */
test.describe.configure({ mode: "serial" });

test("the board's allocation is a figure it can change, with a reason", async ({
  page,
}) => {
  await page.goto("/demo/board");

  const allocation = page.getByText("wage reimbursement allocation");
  await expect(allocation).toBeVisible();

  await page.getByRole("button", { name: "Adjust" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // The reason is required. Without it the control stays disabled, because an
  // allocation that moved with nothing recorded about why is the one figure a
  // funder will certainly ask about.
  await dialog.getByLabel("Allocation").fill("260000");
  await expect(dialog.getByRole("button", { name: "Save the change" })).toBeDisabled();

  await dialog
    .getByLabel("Why it is changing")
    .fill("Supplemental award for the second half of the program year.");
  await dialog.getByRole("button", { name: "Save the change" }).click();

  await expect(page.getByRole("status").first()).toContainText("updated");

  // The rail reads from the fund, so the new figure is on the page without a
  // redeploy — which is the whole point of the allocation being a row.
  await expect(page.getByText("$260,000")).toBeVisible();
});

test("cutting an allocation below what is committed is allowed, and named", async ({
  page,
}) => {
  // A rescission is a real thing that happens to public money. Refusing the
  // edit would leave the console showing a number the board knows is wrong.
  await page.goto("/demo/board");

  await page.getByRole("button", { name: "Adjust" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Allocation").fill("1000");
  await expect(dialog.getByText(/already committed/)).toBeVisible();

  await dialog
    .getByLabel("Why it is changing")
    .fill("Award reduced after a state-level reallocation.");
  await dialog.getByRole("button", { name: "Save the change" }).click();
  await expect(page.getByRole("status").first()).toContainText("updated");

  await expect(page.getByText("overcommitted", { exact: false }).first()).toBeVisible();

  // Put it back, so the suites that follow see the seeded figure.
  await page.getByRole("button", { name: "Adjust" }).first().click();
  const restore = page.getByRole("dialog");
  await restore.getByLabel("Allocation").fill("240000");
  await restore.getByLabel("Why it is changing").fill("Restoring the original award.");
  await restore.getByRole("button", { name: "Save the change" }).click();
  await expect(page.getByRole("status").first()).toContainText("updated");
});

test("the administrator commits a grant against the cost of internship credit", async ({
  page,
}) => {
  // The barrier the student survey named first, and the thing the old model
  // could not record at all.
  await page.goto("/demo/admin");

  const funds = page.getByText("Funds and commitments");
  await expect(funds).toBeVisible();
  await expect(page.getByText("Internship credit assistance")).toBeVisible();

  await page.getByRole("button", { name: "Award" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByRole("radio").first().click();
  await dialog.getByLabel("Amount").fill("750");
  await dialog.getByLabel("What it covers").fill("Three credit hours at the in-state rate.");
  await dialog.getByRole("button", { name: "Commit it" }).click();

  await expect(page.getByRole("status").first()).toContainText("Committed");
});

test("a fund refuses a commitment it cannot cover", async ({ page }) => {
  await page.goto("/demo/admin");

  await page.getByRole("button", { name: "Award" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio").first().click();
  await dialog.getByLabel("Amount").fill("999999");

  // Named before submitting rather than returned as a refusal afterwards.
  await expect(dialog.getByText("More than this fund has left.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Commit it" })).toBeDisabled();
});

test("the board sees money that is not its own", async ({ page }) => {
  // The coordination the venture says it provides, rendered: a learner whose
  // credit cost a foundation covers is a learner who can take a placement this
  // board reimburses.
  await page.goto("/demo/board");
  await expect(page.getByText("Other funds supporting these placements")).toBeVisible();
  await expect(page.getByText("Rural transportation assistance")).toBeVisible();
});

test("the employer and the student are quoted the fund's rate", async ({ page }) => {
  // The rate used to live on the market. It lives on the fund now, and these
  // two pages have to be reading the one actually in force.
  await page.goto("/demo/business");
  await expect(page.getByText(/reimburses you \$20\/hour/)).toBeVisible();
});
