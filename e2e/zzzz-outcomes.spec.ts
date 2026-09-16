import { test, expect } from "@playwright/test";

/**
 * Follow-up: the measure the lifecycle stops short of.
 *
 * Named to sort **last**, after the lifecycle suite. That suite completes
 * placements, and a completed placement is exactly what lands in this queue —
 * so running before it would assert against a list that grows underneath the
 * test.
 */
test.describe.configure({ mode: "serial" });

test("the college records where a learner went, and the administrator sees it", async ({
  page,
}) => {
  await page.goto("/demo/admin");

  // The denominator before anything is recorded. Read from the console rather
  // than assumed, because the lifecycle suite has already run and moved
  // placements into this queue.
  const notAsked = page.getByText("Not yet asked").locator("..");
  await expect(notAsked).toBeVisible();
  const before = Number((await notAsked.innerText()).match(/\d+/)?.[0] ?? "0");
  expect(before).toBeGreaterThan(0);

  await page.goto("/demo/college");

  const record = page.getByRole("button", { name: "Record outcome" });
  await expect(record.first()).toBeVisible();
  const queued = await record.count();

  await record.first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // One "Employed", with the county recorded beside it — "employed in the
  // region" stopped being a thing you could pick when the place became
  // something captured rather than judged. Cherokee is the next county over and
  // is one of this market's, which is what makes the detail below true.
  await dialog.getByText("Employed", { exact: true }).first().click();
  await dialog.getByLabel("County they work in").fill("Cherokee");
  await dialog.getByLabel("State").fill("KS");
  await dialog
    .getByLabel("Detail")
    .fill("Working for a manufacturer in the next county.");
  await dialog.getByRole("button", { name: "Record it" }).click();

  await expect(page.getByRole("status").first()).toContainText("Recorded");

  // The queue is a list of experiences nobody has asked about, so recording one
  // takes it off the list.
  await expect(async () => {
    expect(await record.count()).toBe(queued - 1);
  }).toPass({ timeout: 5000 });

  await page.goto("/demo/admin");
  await expect(page.getByText("Where they went")).toBeVisible();
  const after = Number((await notAsked.innerText()).match(/\d+/)?.[0] ?? "0");
  expect(after).toBe(before - 1);
});

test("the queue refuses to measure a placement that is still running", async ({
  page,
}) => {
  await page.goto("/demo/college");

  // Nothing in the follow-up card may be a live placement. The guard is
  // server-side, but a queue offering the row at all is a promise the action
  // then breaks.
  // `following::ul[1]`, not an ancestor lookup. This read
  // `ancestor::*[contains(@class,'card')][1]`, which matches nothing — `Card`
  // puts no such class on its outer element — so the count guard below was
  // always zero and the assertion never ran. A test that cannot fail is not a
  // test, and this one is guarding a real promise: a queue offering a live
  // placement is an action the server then refuses.
  const rows = page
    .getByRole("heading", { name: "Follow-up" })
    .locator("xpath=following::ul[1]")
    .locator("li");

  await expect(rows).not.toHaveCount(0);
  await expect(rows.filter({ hasText: "In progress" })).toHaveCount(0);
});

test("the workforce board is never shown the free text of an outcome", async ({
  page,
}) => {
  // The board's obligation is how many were employed and how many stayed. The
  // sentence naming a learner's new employer is not part of that count — the
  // same rule that strips work summaries from a timesheet, applied at the other
  // end of the lifecycle.
  await page.goto("/demo/board");
  await expect(
    page.getByText("Working for a manufacturer in the next county."),
  ).toHaveCount(0);
  await expect(
    page.getByText("Apex Controls kept him on as a junior controls technician."),
  ).toHaveCount(0);
});
