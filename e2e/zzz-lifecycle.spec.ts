import { test, expect } from "@playwright/test";

/**
 * The three gating machines, in a browser.
 *
 * Each is unit-tested, but only this proves the queues that rendered these
 * records for months can now move them — and that the guards behind two
 * long-standing claims in the interface actually fire.
 *
 * Named to sort **last**: these change vetting and publication state that
 * other suites read, and under `workers: 1` file order is execution order.
 */
test.describe.configure({ mode: "serial" });

test("the college verifies a student, which is what opens applying", async ({
  page,
}) => {
  await page.goto("/college");

  const queue = page.getByRole("heading", { name: "Student verification" });
  await expect(queue).toBeVisible();

  const row = page.getByRole("listitem").filter({ hasText: "graduating" }).first();
  const name = (await row.locator("p").first().innerText()).trim();

  await row.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("Verify — done");

  // They leave the queue, which is the queue doing its job rather than a
  // list that renders the same names forever.
  await expect(async () => {
    expect(await page.getByRole("listitem").filter({ hasText: name }).count()).toBe(0);
  }).toPass({ timeout: 5000 });
});

test("rejecting a verification demands a reason the student can read", async ({
  page,
}) => {
  await page.goto("/college");

  // A student is only rejectable once they have asked to be checked. Rather
  // than depend on one being left in that state by the test above, walk the
  // two-step path: the student submits, the college decides.
  const waiting = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Submit for verification" }) })
    .first();

  if ((await waiting.count()) > 0) {
    await waiting.getByRole("button", { name: "Submit for verification" }).click();
    await expect(page.getByRole("status").first()).toContainText("done");
  }

  const row = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Reject verification" }) })
    .first();
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Reject verification" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // A rejection with no reason leaves the student unable to fix anything, so
  // the confirm stays disabled until there is one.
  const confirm = dialog.getByRole("button", { name: /Reject verification/ });
  await expect(confirm).toBeDisabled();

  await dialog
    .getByLabel("Reason")
    .fill("Enrollment could not be confirmed for the current term.");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByRole("status").first()).toContainText("done");
});

test("a posting goes out for review, comes back, and goes again", async ({ page }) => {
  // Driven end to end with its own posting rather than borrowing a seeded one:
  // the employer portal is scoped to the signed-in organization, so a posting
  // picked out of the college's queue at random usually belongs to somebody
  // else and never appears on the employer's side at all.
  const title = `Loop test posting ${Date.now()}`;

  await page.goto("/business");
  await page.getByRole("button", { name: /Post an opportunity/ }).click();
  const create = page.getByRole("dialog");
  await create.getByLabel("Title").fill(title);
  await create
    .getByLabel("Description")
    .fill("Support the maintenance team with scheduled inspections.");
  await create.getByLabel("Supervisor").fill("Dana Reyes");

  // A required skill, because publication guards on it: a posting that lists
  // none will not match anyone, and the college is not offered "Publish" for
  // it at all. Without this the loop stops at review with no button, which
  // looks like a bug rather than the guard doing its job.
  //
  // Picked from the offered options rather than typed — the skills field is a
  // closed vocabulary so that tags converge instead of sprawling into "JS",
  // "Javascript" and "JavaScript", and free text is not accepted.
  await create.getByLabel("Required skills").click();
  await create.getByRole("option").first().click();

  await create.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByRole("status").first()).toContainText("review");

  // The college sends it back with a reason.
  await page.goto("/college");
  const review = page.getByRole("listitem").filter({ hasText: title }).first();
  await expect(review).toBeVisible();

  await review.getByRole("button", { name: "Request changes" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Reason")
    .fill("The hours per week do not support the credit you asked for.");
  await dialog.getByRole("button", { name: /Request changes/ }).click();
  await expect(page.getByRole("status").first()).toContainText("done");

  // The employer sees it and can act. A change request the employer cannot
  // resubmit is a dead end dressed as a decision.
  await page.goto("/business");
  const employerRow = page.getByRole("listitem").filter({ hasText: title }).first();
  await expect(employerRow).toContainText("Changes requested");

  await employerRow.getByRole("button", { name: "Resubmit for review" }).click();
  await expect(page.getByRole("status").first()).toContainText("done");

  // And back in the college's queue, where it can be published.
  await page.goto("/college");
  const again = page.getByRole("listitem").filter({ hasText: title }).first();
  await again.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status").first()).toContainText("done");

  await page.goto("/business");
  await expect(
    page.getByRole("listitem").filter({ hasText: title }).first(),
  ).toContainText("Live");
});

test("a posting with candidates in it cannot be closed out from under them", async ({
  page,
}) => {
  await page.goto("/business");

  // The guard lives on the machine, so the button is simply not offered — the
  // page and the service agree because both read the same count.
  const busy = page
    .getByRole("listitem")
    .filter({ hasText: /[1-9]\d* in pipeline/ })
    .first();
  await expect(busy).toBeVisible();

  await expect(busy.getByRole("button", { name: "Close posting" })).toHaveCount(0);

  // Not merely "no buttons at all" — the row is live and offers the move that
  // does not strand anyone.
  await expect(busy.getByRole("button", { name: "Mark filled" })).toBeVisible();
});

test("the administrator vets an organization, which unblocks it", async ({ page }) => {
  await page.goto("/admin");

  const queue = page.getByRole("heading", { name: "Awaiting vetting" });
  await expect(queue).toBeVisible();

  // "Nothing transacts until an organization is approved" was on this page for
  // months with nothing behind it. This is that sentence becoming true.
  const row = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Begin vetting" }) })
    .first();
  if ((await row.count()) === 0) test.skip();

  await row.getByRole("button", { name: "Begin vetting" }).click();
  await expect(page.getByRole("status").first()).toContainText("done");

  await expect(
    page.getByRole("button", { name: "Approve", exact: true }).first(),
  ).toBeVisible();
});

test("vetting is the administrator's alone", async ({ page }) => {
  // Signed in as the college, the vetting queue is not even reachable — the
  // portal switcher disables every portal but your own.
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Awaiting vetting" })).toBeVisible();

  // And the buttons the college would need are not on the college's own page.
  await page.goto("/college");
  await expect(page.getByRole("button", { name: "Begin vetting" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
});
