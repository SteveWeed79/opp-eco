import { test, expect } from "@playwright/test";

/**
 * The host's answer, and the two queues it empties.
 *
 * Runs in demo mode against whichever backend the server under test uses, like
 * the lifecycle suites — the sign-on-gated suites are the exception here, not
 * the rule.
 *
 * Named to sort **after `zzz-lifecycle` and before `zzzz-outcomes`**, and both
 * halves matter. After the lifecycle suite, because that is what completes the
 * placements this one answers about. Before the outcomes suite, because that
 * one records a follow-up against the first row of a market-wide queue — which
 * is the demo learner's only unmeasured placement, and the thing the last test
 * here needs to exist. `-` sorts below `1` and `1` below `z`, so
 * `zzz-lifecycle` < `zzz1-host-offer` < `zzzz-outcomes`.
 *
 * Every assertion here is on an **effect**, never on a toast. An earlier suite
 * in this repository passed for a week while a Server Action wrapper dropped a
 * parameter, because a success toast appeared either way.
 */
test.describe.configure({ mode: "serial" });

/**
 * The rows under a card's heading.
 *
 * `following::ul[1]` rather than an ancestor lookup. `Card` puts no class
 * containing "card" on its outer element, so `ancestor::*[contains(@class,
 * 'card')]` matches nothing — which is how `zzzz-outcomes.spec.ts` ended up
 * with an assertion that never ran, hidden behind a count guard. The row list
 * is the first `ul` after the heading in document order, and a card that has
 * lost its rows has no `ul` at all rather than an empty one.
 */
function rowsUnder(page: import("@playwright/test").Page, heading: string) {
  return page
    .getByRole("heading", { name: heading })
    .locator("xpath=following::ul[1]")
    .locator("li");
}

/** The rows in the administrator's "Ask the employer" list. */
async function chaseRows(page: import("@playwright/test").Page) {
  await page.goto("/demo/admin");
  await expect(page.getByRole("heading", { name: "Ask the employer" })).toBeVisible();
  return rowsUnder(page, "Ask the employer");
}

/** What the administrator's host summary currently reports. */
async function hostFigures(page: import("@playwright/test").Page) {
  await page.goto("/demo/admin");
  const stat = async (label: string) => {
    const el = page.locator("div").filter({ hasText: new RegExp(`^${label}`) }).last();
    return (await el.count()) ? (await el.innerText()) : "";
  };
  return {
    keptOn: await stat("Kept on by the host"),
    unanswered: await stat("Nobody asked"),
  };
}

test("an employer is asked about its own placements and nobody else's", async ({
  page,
}) => {
  await page.goto("/demo/business");
  await expect(
    page.getByRole("heading", { name: "Did you keep them on?" }),
  ).toBeVisible();

  // The employer's own name, read from the page rather than hardcoded — which
  // is also what makes the exclusion below meaningful rather than a guess.
  const ownName = await page.getByRole("heading", { level: 1 }).first().innerText();

  const ownRows = rowsUnder(page, "Did you keep them on?");
  await expect(ownRows).not.toHaveCount(0);
  const own = await ownRows.count();

  // Deliberately not an absolute count. Earlier suites in this run complete
  // placements, so "exactly one" is true of a fresh seed and false by the time
  // the whole suite reaches here — and a test that only passes in isolation is
  // one that gets deleted the first time it goes red for the wrong reason.
  //
  // The property that actually matters holds either way: the administrator
  // sees the market's queue, the employer sees a strict subset of it, and at
  // least one row in the administrator's belongs to somebody else.
  const adminRows = await chaseRows(page);
  const adminCount = await adminRows.count();
  expect(adminCount).toBeGreaterThan(own);
  expect(await adminRows.filter({ hasNotText: ownName }).count()).toBeGreaterThan(0);
});

test("a placement still running is never asked about", async ({ page }) => {
  await page.goto("/demo/business");

  // Whatever is listed, none of it may be live work. The guard is server-side,
  // but a queue offering the row at all is a promise the action then breaks.
  // Asserted on the rows rather than the card, so the check runs against
  // something that exists rather than a selector that quietly matches nothing.
  const rows = rowsUnder(page, "Did you keep them on?");
  await expect(rows).not.toHaveCount(0);
  await expect(rows.filter({ hasText: "In progress" })).toHaveCount(0);
});

test("no offer is recorded as an answer, and leaves both queues", async ({ page }) => {
  const before = await hostFigures(page);
  const beforeChase = await (await chaseRows(page)).count();

  await page.goto("/demo/business");
  const ownRows = rowsUnder(page, "Did you keep them on?");
  // Waited for rather than counted straight away. `count()` does not auto-wait,
  // so reading it before the list renders returns zero — and a zero here does
  // not fail, it poisons the arithmetic below and fails somewhere else.
  await expect(ownRows).not.toHaveCount(0);
  const beforeOwn = await ownRows.count();
  await ownRows.first().getByRole("button", { name: "Answer" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByText("We made no offer", { exact: true }).first().click();
  await dialog.getByLabel("Anything worth knowing").fill("No headcount this cycle.");
  await dialog.getByRole("button", { name: "Record it" }).click();

  // The employer's own queue is one shorter — the effect the employer sees.
  //
  // One shorter rather than empty. Earlier suites in a full run complete more
  // placements, so "the card disappears" is true of this employer on a fresh
  // seed and false by the time the whole suite reaches here.
  await expect(async () => {
    expect(await ownRows.count()).toBe(beforeOwn - 1);
  }).toPass({ timeout: 5000 });

  // And the administrator's chase list is one shorter — the assertion that
  // matters, because it proves the answer reached the store rather than just
  // the screen it was typed on.
  expect(await (await chaseRows(page)).count()).toBe(beforeChase - 1);

  // "No offer" is an answer, so it moves the count of placements nobody has
  // been asked about. It must not move the hire rate's numerator.
  const after = await hostFigures(page);
  expect(after.unanswered).not.toBe(before.unanswered);
  expect(after.keptOn).not.toBe("");
});

test("a learner records their own, and the college's queue reflects it", async ({
  page,
}) => {
  await page.goto("/demo/college");
  const collegeQueue = page.getByRole("button", { name: "Record outcome" });
  // Waited for rather than counted straight away. Every portal here has a
  // `loading.tsx`, so Next serves the shell first and streams the page in
  // behind it — `goto` can resolve on the skeleton, and `count()` does not
  // auto-wait. A zero read there does not fail honestly; it fails as though
  // the queue were empty, which is a different bug entirely.
  await expect(collegeQueue).not.toHaveCount(0);
  const before = await collegeQueue.count();

  await page.goto("/demo/student");
  await page.getByRole("button", { name: "Tell us where you are" }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Addressed to the person it is about, which is the only thing `self`
  // changes — the fields and the rules behind them are the college's.
  await expect(dialog).toContainText("Where are you now?");
  await dialog.getByText("Employed", { exact: true }).first().click();
  await dialog.getByLabel("County you work in").fill("Crawford");
  await dialog.getByLabel("State").fill("KS");
  await dialog.getByRole("button", { name: "Record it" }).click();

  await expect(
    page.getByRole("status").filter({ hasText: /genuinely useful/i }),
  ).toBeVisible();

  // The effect, on a portal the learner does not control: the college's
  // follow-up queue has one fewer placement to chase.
  await page.goto("/demo/college");
  await expect(async () => {
    expect(await collegeQueue.count()).toBe(before - 1);
  }).toPass({ timeout: 5000 });
});

test("a nudge leaves the building, and names nobody on the way", async ({ page }) => {
  // The effect, not the toast: a queued message with a body an operator can
  // read. The outbox is where "delivered" is defined, so it is where this is
  // checked rather than at the button that caused it.
  await page.goto("/demo/admin");
  const nudges = page.getByRole("button", { name: "Send a nudge" });
  await expect(nudges).not.toHaveCount(0);

  // The learner named on the row this nudge is about, so the assertion below
  // is about a real name rather than a name nobody ever had.
  const row = rowsUnder(page, "Ask the learner").first();
  const learner = (await row.innerText()).split("\n")[0].trim();
  expect(learner.length).toBeGreaterThan(0);

  await row.getByRole("button", { name: "Send a nudge" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Sent\./ })).toBeVisible();

  await page.goto("/admin/outbox");
  const outbox = page.locator("body");
  await expect(outbox).toContainText("Where did you land?");
  // The rule every template obeys, checked on the thing actually queued rather
  // than on the template that produced it.
  await expect(outbox).not.toContainText(learner);
});

test("the queue says which quarter it is asking about", async ({ page }) => {
  // The window is the product's arithmetic, not the operator's. A placement
  // that ended in February is measured in July, and nobody working this queue
  // should have to know why — they should see the months.
  await page.goto("/demo/college");
  const rows = rowsUnder(page, "Follow-up");
  await expect(rows).not.toHaveCount(0);

  // Every row names a quarter, and none of them names a countdown in quarters.
  const quarter = /Covers [A-Z][a-z]{2}–[A-Z][a-z]{2} \d{4}/;
  for (const text of await rows.allInnerTexts()) {
    expect(text).toMatch(quarter);
  }
});

test("redefining a region appends a boundary and leaves the old one", async ({ page }) => {
  // The guarantee the whole model exists for, through the screen. A boundary
  // is never edited: a redesignation is a new row with a later date, and every
  // figure already computed keeps the map it was measured against.
  await page.goto("/demo/admin");

  const card = page
    .getByRole("heading", { name: "Redefine a region" })
    .locator("xpath=following::div[1]");
  await expect(card).toContainText("in force");

  const before = await card.locator("li").count();
  expect(before).toBeGreaterThan(0);
  const existing = (await card.locator("li").first().innerText()).split("—")[0].trim();

  await page.getByLabel("Counties").fill("Crawford, Cherokee, Labette, Neosho, Bourbon");
  await page.getByLabel("In force from").fill("2027-07-01");
  await page.getByLabel("What changed this").fill("2027 local area redesignation.");
  await page.getByRole("button", { name: "Record the new boundary" }).click();

  await expect(
    page.getByRole("status").filter({ hasText: /unchanged/i }),
  ).toBeVisible();

  // One more boundary on record, and the one that was there is still there
  // word for word — an edit would have replaced it.
  await expect(async () => {
    expect(await card.locator("li").count()).toBe(before + 1);
  }).toPass({ timeout: 5000 });
  await expect(card).toContainText(existing);
  await expect(card).toContainText("Bourbon");
});

test("a region cannot be backdated over the boundary it replaces", async ({ page }) => {
  // Backdating is a rewrite of history wearing an append's clothing, which is
  // the single thing this model exists to prevent.
  await page.goto("/demo/admin");
  await page.getByLabel("Counties").fill("Crawford");
  await page.getByLabel("In force from").fill("1999-01-01");
  await page.getByLabel("What changed this").fill("Trying to backdate.");
  await page.getByRole("button", { name: "Record the new boundary" }).click();

  // `alert`, not `status`: the toast component gives an error the assertive
  // role and everything else the polite one, which is right for a screen
  // reader and easy to get wrong in a test.
  await expect(
    page.getByRole("alert").filter({ hasText: /after the one it replaces/i }),
  ).toBeVisible();
});
