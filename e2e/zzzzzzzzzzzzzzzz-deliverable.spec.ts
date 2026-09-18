import { test, expect } from "@playwright/test";

/**
 * The micro track's hand-in, end to end and across two portals.
 *
 * Named to sort **last**, after the escalation suite, for the reason the
 * outcomes suite gives: earlier suites move placements, and this one needs a
 * micro placement that is still running.
 *
 * **What this catches that the service tests cannot.** The service tests prove
 * the writes are right. This proves the two halves meet: that what the learner
 * types reaches the employer's screen before they decide, that the employer's
 * Accept was genuinely unavailable until the learner handed in — a guard that
 * has existed since the first migration with nothing able to satisfy it — and
 * that accepting completes the placement rather than merely saying it did.
 *
 * The seeded case is deliberately mid-revision: `del-app-15` came back with an
 * instruction, so the first thing the learner sees is what they were asked to
 * change. A cycle that only ever tests the happy first round would not notice
 * the revision text failing to reach them.
 */
test.describe.configure({ mode: "serial" });

const HANDED_IN = "Ranked every gap by what it would cost if it broke";
const EVALUATION = "The cost ranking is exactly what we needed";

test("the learner sees what was asked for, and hands in again", async ({ page }) => {
  await page.goto("/demo/student");

  const again = page.getByRole("button", { name: "Hand in again" });
  await expect(again).toBeVisible();
  await again.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // The employer's instruction, in front of them while they work — not buried
  // in an email they may not have read.
  await expect(dialog).toContainText("rank the gaps");
  // Said on the dialog because the learner cannot see the employer's side, and
  // asserted because a promise the interface makes is part of the contract.
  await expect(dialog).toContainText("the evaluation your college reads");

  await dialog.locator("textarea").fill(`${HANDED_IN}, with the payment paths at the top.`);
  await dialog.getByRole("button", { name: "Hand it in" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Handed in" })).toBeVisible();
});

test("the employer reads it and accepts, which completes the placement", async ({ page }) => {
  await page.goto("/demo/business");

  await expect(page.getByText("Work handed in")).toBeVisible();
  // What the learner wrote, on the employer's screen before they decide.
  await expect(page.locator("main")).toContainText(HANDED_IN);

  await page.getByRole("button", { name: "Accept the work" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(HANDED_IN);
  // The sentence this whole screen exists for: there is no separate evaluation
  // form on this track, and an employer who thinks otherwise writes "thanks".
  await expect(dialog).toContainText("is the evaluation");

  // Refused while empty, because an empty acceptance is the entire academic
  // record of a credit-bearing placement.
  await expect(dialog.getByRole("button", { name: "Accept it" })).toBeDisabled();

  await dialog.locator("textarea").fill(`${EVALUATION} and we have closed the top two.`);
  await dialog.getByRole("button", { name: "Accept it" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Accepted" })).toBeVisible();

  // Gone from the queue, because it is answered.
  await page.reload();
  await expect(page.locator("main")).not.toContainText(HANDED_IN);
});

test("the learner's placement is complete and the hand-in is not offered again", async ({
  page,
}) => {
  await page.goto("/demo/student");
  // Accepted work is the employer's now; the learner's next move is the credit.
  await expect(page.getByRole("button", { name: "Hand in again" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Hand in your work" })).toHaveCount(0);
});
