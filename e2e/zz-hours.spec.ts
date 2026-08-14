import { test, expect } from "@playwright/test";

/**
 * Hours, end to end: a student logs a week and the employer signs it off.
 *
 * The round trip is the whole feature. Each half is unit-tested, but only a
 * browser proves that the week a student submits is the one that appears in
 * the supervisor's queue, and that approving it moves the number the college
 * and the board read.
 *
 * Named to sort **after** `writes.spec.ts`. These mutate the shared demo store
 * — a logged week changes the student portal, the employer queue, and the
 * board's reimbursement table — and under `workers: 1` file order is execution
 * order.
 */
test.describe.configure({ mode: "serial" });

/** Identifiable, so the assertions cannot be satisfied by a seeded row. */
const STAMP = Date.now();
const FIRST = `E2E rebuilt the supplier feed parser ${STAMP}`;
const SECOND = `E2E corrected week ${STAMP}`;

const timesheet = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: /^Your hours on / }).first();

const claims = (page: import("@playwright/test").Page) =>
  page.getByRole("table", { name: "Reimbursement against authorization" });

test("a student logs a week and the supervisor sees exactly it", async ({ page }) => {
  await page.goto("/student");

  const form = timesheet(page).locator("form").first();
  await expect(form).toBeVisible();

  await expect(form.getByLabel("Week worked")).not.toHaveValue("");
  await form.getByLabel("Hours").fill("12.5");
  await form.getByLabel("What you worked on").fill(FIRST);
  await form.getByRole("button", { name: /Submit for approval/ }).click();

  await expect(page.getByRole("status").first()).toContainText("Hours submitted");

  // It lands as a claim, not an approval. That distinction is the reason the
  // feature is two actions by two roles rather than one.
  await expect(timesheet(page).getByText("Awaiting approval").first()).toBeVisible();

  // And it reaches the party that can attest to it.
  await page.goto("/business");
  await expect(page.getByText(FIRST)).toBeVisible();
});

test("sending a week back demands a reason, and the student can read it", async ({
  page,
}) => {
  await page.goto("/business");
  const row = page.getByRole("listitem").filter({ hasText: FIRST }).first();

  await row.getByRole("button", { name: "Send back" }).click();

  // A week bounced without a reason leaves the student unable to fix it, so
  // the button stays disabled until there is one.
  const send = row.getByRole("button", { name: "Send back", exact: true });
  await expect(send).toBeDisabled();

  await row
    .getByLabel("What needs correcting")
    .fill("Those dates overlap with the week you already logged.");
  await expect(send).toBeEnabled();
  await send.click();

  await expect(page.getByRole("status").first()).toContainText("Sent back");

  await page.goto("/student");
  await expect(page.getByText("Those dates overlap")).toBeVisible();
});

test("approving a week moves the number the board reimburses against", async ({
  page,
}) => {
  // A sent-back week is free to be logged again — that is what rejection is
  // for — so this resubmits and takes the other branch.
  await page.goto("/student");
  const form = timesheet(page).locator("form").first();

  await form.getByLabel("Hours").fill("8");
  await form.getByLabel("What you worked on").fill(SECOND);
  await form.getByRole("button", { name: /Submit for approval/ }).click();
  await expect(page.getByRole("status").first()).toContainText("Hours submitted");

  await page.goto("/board");
  await expect(claims(page)).toBeVisible();
  const before = await claims(page).innerText();

  await page.goto("/business");
  const row = page.getByRole("listitem").filter({ hasText: SECOND }).first();
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status").first()).toContainText("approved");

  // The board's table reads the cached total the timesheet service rewrites in
  // the same transaction as the entry, so an approval that failed to update it
  // would surface here rather than as a wrong figure months later.
  await page.goto("/board");
  await expect(async () => {
    expect(await claims(page).innerText()).not.toBe(before);
  }).toPass({ timeout: 5000 });
});

test("the board sees hours and periods but never the work summaries", async ({
  page,
}) => {
  // The data-minimisation rule, checked where it actually matters: what is on
  // the page. Withholding a field in a component while the full row travels to
  // the client is not a privacy control, it is a costume.
  await page.goto("/board");

  const body = await page.locator("body").innerText();
  expect(body).not.toContain(FIRST);
  expect(body).not.toContain(SECOND);
  expect(body).not.toContain("Those dates overlap");

  // The figures it does need are there.
  await expect(claims(page)).toContainText("hrs");
});

test("the college sees the work behind the hours it awards credit for", async ({
  page,
}) => {
  await page.goto("/college");

  // Collapsed by default — the credit queue is a list to work through, not a
  // document. Expanding is what a registrar does for the one they are judging.
  const toggle = page.getByRole("button", { name: /^\d+ weeks?$/ }).first();
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // The summaries the board is not shown.
  await expect(
    page.getByText(/Cleaned the elevator|Ran dimensional|Paired on the/).first(),
  ).toBeVisible();
});
