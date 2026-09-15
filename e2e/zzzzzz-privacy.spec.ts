import { test, expect } from "@playwright/test";

/**
 * What leaves the building, and the paperwork that lets it.
 *
 * Named to sort **last**. These record a consent, which widens what an employer
 * sees — state every earlier suite's disclosure assertions read.
 */
test.describe.configure({ mode: "serial" });

/** The learner the seed deliberately leaves without an education-record consent. */
const UNCONSENTED = "Jordan Taylor";

test("the college has a queue of learners it cannot yet disclose", async ({ page }) => {
  await page.goto("/demo/college");

  const card = page.getByText("Consent on file");
  await expect(card).toBeVisible();

  // Exception-first, like every queue on this page: the one learner without a
  // consent, not a roll of everyone who has one.
  await expect(page.getByText("employers see an abbreviated name only").first()).toBeVisible();
});

test("recording a consent asks who signed, and clears the queue", async ({ page }) => {
  await page.goto("/demo/college");

  const record = page.getByRole("button", { name: "Record consent" });
  await expect(record.first()).toBeVisible();
  const queued = await record.count();

  await record.first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Both questions are asked rather than inferred. FERPA rights transfer at 18
  // or on enrolment at the college at any age, and nothing on this screen knows
  // which applies.
  await expect(dialog.getByText("What was agreed to")).toBeVisible();
  await expect(dialog.getByText("Who signed")).toBeVisible();

  await dialog.getByRole("radio", { name: /Share education records/ }).click();
  // Matched on the grantor's own qualifier: "The learner" alone also appears
  // in a scope description, which is exactly the ambiguity a screen reader user
  // would hit.
  await dialog.getByRole("radio", { name: /18\+, or enrolled/ }).click();
  await dialog.getByRole("button", { name: "Record it" }).click();

  await expect(page.getByRole("status").first()).toContainText("Consent recorded");

  await expect(async () => {
    expect(await record.count()).toBe(queued - 1);
  }).toPass({ timeout: 5000 });
});

test("no message in the outbox names the learner it is about", async ({ page }) => {
  // The rule this whole change exists for: TEGL 39-11 says never to email
  // participant PII unencrypted, and a subject line is the least protected part
  // of an email. Asserted against the real rendered outbox rather than against
  // the templates in isolation.
  await page.goto("/demo/admin/outbox");
  await expect(page.getByRole("heading", { name: /outbox/i }).first()).toBeVisible();

  // The outbox renders addresses, not names — so a learner's name appearing
  // anywhere on this page means a template put it in a subject or a body. That
  // makes the whole page the assertion, which is stronger than picking at
  // individual cells and does not depend on the markup.
  const body = (await page.locator("body").innerText()).toLowerCase();
  for (const name of ["omar haddad", UNCONSENTED.toLowerCase()]) {
    expect(body, `the outbox names ${name}`).not.toContain(name);
  }

  // And the messages really are being rendered, so the assertion above is not
  // passing against an empty page.
  expect(body).toContain("hours to review");
});

test("the administrator sees a retention schedule with real dates behind it", async ({
  page,
}) => {
  await page.goto("/demo/admin");

  await expect(page.getByText("Retention schedule")).toBeVisible();
  await expect(page.getByText("Uploaded files")).toBeVisible();

  // Nothing in a pre-pilot seed is three years past its last participation, and
  // the section renders anyway — a retention screen that only appears once the
  // schedule is being breached is one nobody checks until it is too late.
  await expect(page.getByText("Nothing has come due.")).toBeVisible();
  await expect(page.getByText("Coming up")).toBeVisible();
});
