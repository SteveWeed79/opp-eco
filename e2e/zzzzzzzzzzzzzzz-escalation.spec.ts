import { test, expect } from "@playwright/test";

/**
 * The escalation path — and the refusal it depends on.
 *
 * Named to sort **last**, for the reason the outcomes suite gives: the
 * lifecycle suite moves placements, and a report is raised against one that is
 * still running.
 *
 * **Be precise about what the second test proves, because it is less than it
 * looks.** It checks that no employer-, college- or board-facing page contains
 * the words a learner reported. Widening `visibleEscalations` to return every
 * row in the market — the exact regression the rule exists to prevent — leaves
 * all three tests here passing, because no page on those portals renders an
 * escalation at all, so there is nothing for a broken scope to leak *through*.
 *
 * What actually guards the scope is `services/escalation.test.ts`, which asks
 * the repository directly and fails on that mutation. This file guards the
 * other half, which that one cannot see: a page putting the summary somewhere
 * the scope never refused it — a column added to the employer's pipeline, a
 * tooltip, a count rendered from an unscoped read. Today that is a guard
 * against a future change rather than a proof about the present, and it is
 * worth having for the same reason the promise on the dialog is worth
 * asserting: the day somebody adds that column, something should object.
 */
test.describe.configure({ mode: "serial" });

const SECRET = "no guard on the press and my supervisor has been out";

/**
 * The toast carrying this text, however many are on screen.
 *
 * Not `getByRole("status").first()`, which is what this file had and what CI
 * caught: every toast is its own `role="status"` and they stack, so after two
 * actions in a row `.first()` is the **earlier** one. It passed locally because
 * the first toast had faded before the second assertion ran, and failed on a
 * slower runner where both were still up — a race in the test rather than
 * anything wrong with the page.
 */
const toast = (page: import("@playwright/test").Page, text: string) =>
  page.getByRole("status").filter({ hasText: text });

test("a learner reports a problem and an administrator receives it", async ({ page }) => {
  await page.goto("/demo/student");

  const report = page.getByRole("button", { name: "Report a problem" });
  await expect(report.first()).toBeVisible();
  await report.first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Said on the dialog because it is what makes the button worth pressing, and
  // asserted here because a promise the interface makes is part of the
  // contract: if this sentence stops being true, it has to stop being said.
  await expect(dialog).toContainText("to nobody else on the placement");

  await dialog.getByText("Safety, harassment or discrimination").click();
  await dialog.locator("textarea").fill(`There is ${SECRET} for two weeks.`);
  await dialog.getByRole("button", { name: /Send to an administrator/ }).click();

  await expect(toast(page, "Reported")).toBeVisible();

  await page.goto("/demo/admin");
  const queue = page.getByText("Reported to you").locator("..");
  await expect(queue).toBeVisible();
  // The administrator sees the words, which nobody else does.
  await expect(page.locator("main")).toContainText(SECRET);
});

test("the employer whose placement it is cannot see the report", async ({ page }) => {
  // The assertion the design exists for. `escalationScope` refuses it in SQL
  // and `visibleEscalations` refuses it in the fixtures; this checks that no
  // page puts it back.
  await page.goto("/demo/business");
  await expect(page.getByText("Candidate pipeline")).toBeVisible();
  await expect(page.locator("main")).not.toContainText(SECRET);

  // And the college and the board are on the same side of that line — either
  // could be the party a report is about.
  await page.goto("/demo/college");
  await expect(page.locator("main")).not.toContainText(SECRET);
  await page.goto("/demo/board");
  await expect(page.locator("main")).not.toContainText(SECRET);
});

test("the administrator closes it out, and it leaves the queue", async ({ page }) => {
  await page.goto("/demo/admin");
  await expect(page.locator("main")).toContainText(SECRET);

  await page.getByRole("button", { name: "Pick it up" }).first().click();
  await expect(toast(page, "Picked up")).toBeVisible();

  await page.getByRole("button", { name: "Close it out" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Refused while empty, because "resolved" with no account of what was done is
  // the only record the programme will hold of how this ended.
  await expect(dialog.getByRole("button", { name: "Close it out" })).toBeDisabled();

  await dialog
    .locator("textarea")
    .fill("Machine is tagged out and a new supervisor starts Monday.");
  await dialog.getByRole("button", { name: "Close it out" }).click();
  await expect(toast(page, "Closed out")).toBeVisible();

  await page.reload();
  await expect(page.locator("main")).not.toContainText(SECRET);
});
