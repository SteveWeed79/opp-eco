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

  // **Both branches are asserted, because both are real.** A deployment
  // holding records with no malware scanner refuses uploads, and the dialog is
  // supposed to say so rather than offering a picker that fails. Which branch a
  // run takes depends on the environment: CI has no `.env.local` and runs on
  // the fixtures, so it takes the first; a checkout whose `.env.local` points
  // at a writable database takes the second.
  const picker = dialog.locator("input[type=file]");
  const uploadsOffered = (await picker.count()) > 0;

  if (uploadsOffered) {
    await picker.setInputFiles({
      name: "audit.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n"),
    });
    await expect(dialog.getByText("audit.pdf")).toBeVisible();
  } else {
    // Refused, and saying why — and the hand-in still works without a file,
    // because the summary was always the required part.
    await expect(dialog).toContainText("Uploads are turned off");
  }

  await dialog.getByRole("button", { name: "Hand it in" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Handed in" })).toBeVisible();

  if (uploadsOffered) {
    // The file was taken and the link is offered.
    //
    // **Not asserted: that the link resolves.** On the fixtures it does not,
    // and that is a property of the store rather than of this feature — a file
    // is written by a Server Action and read by the route handler, and in a
    // production build those do not share the in-memory `Map`. Under `next
    // dev` the same click returns the PDF. A deployment with a database serves
    // it from the database and has no such seam.
    //
    // Asserting a 200 here would either fail on the fixtures or quietly
    // require the whole suite to run against Postgres, and asserting a 404
    // would enshrine the limitation as if it were intended.
    await page.reload();
    await expect(page.getByRole("link", { name: "Your attachment" })).toBeVisible();
  }
});

test("a signed link is refused to everyone it does not belong to", async ({
  page,
  browser,
}) => {
  // The assertion the retrieval route exists for, and the reason it checks
  // authorization *as well as* the signature: links get forwarded, pasted into
  // chat and left in browser history, so holding one proves only that it was
  // issued.
  await page.goto("/demo/business");
  const link = page.getByRole("link", { name: "Open the attached file" });
  // Skipped where the deployment refuses uploads — there is no file to forward
  // a link to. See the note in the first test.
  test.skip((await link.count()) === 0, "this deployment does not accept uploads");
  const href = (await link.getAttribute("href"))!;

  // **The entitled fetch first, and the test stands down if it fails.**
  // Three refusals prove nothing on a store that refuses everybody — and on
  // the fixtures in a production build it does, for the reason the first test
  // explains. Establishing that the link works for the one caller entitled to
  // it is what makes the three refusals below mean something.
  const entitled = await page.request.get(href);
  test.skip(
    entitled.status() !== 200,
    "this store cannot serve the file, so refusing it proves nothing",
  );

  // The board is not entitled. It does not fund micro-internships, so it reads neither
  // the hand-in nor the file — `deliverableScope` and `canRetrieve` agreeing.
  const board = await browser.newContext();
  await board.addCookies([
    { name: "oe_demo_role", value: "board", url: "http://localhost:3000" },
  ]);
  expect((await board.request.get(href)).status()).toBe(404);
  await board.close();

  // Nor is somebody with no session at all.
  const stranger = await browser.newContext();
  expect((await stranger.request.get(href)).status()).toBe(404);
  await stranger.close();

  // And the signature is load-bearing: the same key without it is refused even
  // for the employer who just used it, so the store cannot be walked by
  // guessing keys.
  expect((await page.request.get(href.split("?")[0])).status()).toBe(404);
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
