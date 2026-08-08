import { test, expect } from "@playwright/test";

/**
 * The write paths beyond booking: applying, posting, moving an application
 * through the state machine, and the outbox that records who was told.
 *
 * Named to sort **last**. These mutate the shared demo store, and the
 * accessibility suite asserts against pages whose contents they change. Under
 * `workers: 1` and `fullyParallel: false`, file order is execution order.
 */
test.describe.configure({ mode: "serial" });

test("a student applies, and the employer sees the candidate", async ({ page }) => {
  await page.goto("/student");

  // The recommendations list is the only place an unapplied posting appears.
  // Waited for rather than counted straight away: `count()` does not
  // auto-wait, so counting before hydration reports zero buttons on a page
  // that has four.
  const applyButtons = page.getByRole("button", { name: "Apply", exact: true });
  await expect(applyButtons.first()).toBeVisible();
  const before = await applyButtons.count();

  await applyButtons.first().click();
  await expect(page.getByRole("status").first()).toContainText("Applied to");

  // Recommendations exclude postings already applied to, so the card leaves
  // the list rather than sitting there with a dead button.
  await expect(async () => {
    expect(await applyButtons.count()).toBe(before - 1);
  }).toPass({ timeout: 5000 });

  // The employer's pipeline is the point of applying.
  await page.goto("/business");
  await expect(page.getByText("Candidate pipeline")).toBeVisible();
});

test("an employer posts an opportunity and the college is told", async ({ page }) => {
  await page.goto("/business");

  await page.getByRole("button", { name: /Post an opportunity/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Title").fill("Water quality data intern");
  await dialog
    .getByLabel("Description")
    .fill("Build ingestion jobs for the county water system and monitor them.");
  await dialog.getByLabel("Supervisor").fill("Dana Reyes");

  await dialog.getByRole("button", { name: "Submit for review" }).click();

  // Not published — the college reviews first, and the toast has to say so or
  // an employer will wonder why students cannot see it.
  await expect(page.getByRole("status").first()).toContainText("review");

  // The message that keeps it out of a queue nobody watches.
  await page.goto("/admin/outbox");
  await expect(
    page.getByText("submitted a posting for review").first(),
  ).toBeVisible();
});

test("the micro track asks different questions than the standard track", async ({
  page,
}) => {
  await page.goto("/business");
  await page.getByRole("button", { name: /Post an opportunity/ }).click();
  const dialog = page.getByRole("dialog");

  // Standard is hourly.
  await expect(dialog.getByLabel("Wage per hour")).toBeVisible();
  await expect(dialog.getByLabel("Project fee")).toHaveCount(0);

  await dialog.getByRole("radio", { name: /Micro-internship/ }).click();

  // Micro is a fixed fee for scoped work. Asking a wage here would be asking
  // the wrong question, which is why this is a union rather than one form.
  await expect(dialog.getByLabel("Project fee")).toBeVisible();
  await expect(dialog.getByLabel("Deliverable")).toBeVisible();
  await expect(dialog.getByLabel("Wage per hour")).toHaveCount(0);

  await page.keyboard.press("Escape");
});

test("an employer moves a candidate through the state machine", async ({ page }) => {
  await page.goto("/business");

  // "Assign project" is the micro track's one-step route from mutual interest
  // to work starting — no board, no funding authorization. The label comes
  // from the transition table, not from the page, which is the point: the
  // seeded Apex applications sit at statuses whose transitions this renders
  // without the page knowing anything about them.
  const assign = page.getByRole("button", { name: "Assign project" }).first();
  await expect(assign).toBeVisible();
  await assign.click();

  await expect(page.getByRole("status").first()).toContainText("Assign project");

  // The move is real: the placement is now active, so the transitions offered
  // are the ones that follow it.
  await expect(
    page.getByRole("button", { name: "End placement early" }).first(),
  ).toBeVisible();
});

test("an irreversible move demands a reason before it will go through", async ({
  page,
}) => {
  await page.goto("/business");

  const end = page.getByRole("button", { name: "End placement early" }).first();
  await expect(end).toBeVisible();
  await end.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Blocked until a reason exists — the audit record must never be written
  // without one, which is why the reason is part of the confirmation rather
  // than a step after it.
  const confirm = dialog.getByRole("button", { name: "End placement early" });
  await expect(confirm).toBeDisabled();

  await dialog.getByLabel("Reason").fill("Role filled internally.");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByRole("status").first()).toContainText("End placement early");
});

test("the audit log and the outbox both record what happened", async ({ page }) => {
  await page.goto("/admin/audit");
  await expect(page.getByText("Recorded transitions")).toBeVisible();
  // The reason typed above is on the record.
  await expect(page.getByText("Role filled internally.").first()).toBeVisible();

  await page.goto("/admin/outbox");
  // The distinction this page exists for: the audit log says what changed,
  // the outbox says whether anyone was told.
  await expect(page.getByText("Delivered", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("New applicant for").first()).toBeVisible();

  // Nothing failed to reach anyone. This is the assertion that would have
  // caught `executeTransition` rebuilding its notification intents and
  // dropping the organization: the booking above still succeeded, so the only
  // visible symptom was two messages nobody received.
  await expect(page.getByText("Not delivered")).toBeVisible();
  const undelivered = await page
    .getByText("Not delivered")
    .locator("xpath=following-sibling::p[1]")
    .innerText();
  expect(undelivered).toBe("0");
});
