import { test, expect, type Page } from "@playwright/test";

/**
 * The mutation that closes the pause.
 *
 * This is the product's central claim — a student stuck waiting on a workforce
 * board books in one click, and three parties find out. It is also the only
 * write path wired end to end, so it exercises the whole stack: guard, audit,
 * side effect, notification, revalidation.
 *
 * **These tests consume seeded state.** The demo store lives in the server
 * process and only resets when that process restarts, so the booking below is
 * permanent for the life of the server. That is why the suite runs serially,
 * why CI starts a fresh server, and why retries are off — a second attempt
 * would run against a world the first attempt already changed, which makes a
 * red run lie in both directions.
 *
 * There is exactly **one** bookable application in the seed. Omar Haddad holds
 * two in mutual interest, but only `app-4` is a standard placement; `app-15` is
 * a micro-internship, which is unsubsidised and by design never waits on board
 * clearance. So the order below is load-bearing: the test that only opens and
 * dismisses the dialog runs first, and the one that actually books runs last.
 */
test.describe.configure({ mode: "serial" });

/**
 * The bookable panels on the student portal, addressed as landmarks rather
 * than by class name. An earlier version of this file matched
 * `button.hover\:border-brand-500`, which silently stopped matching anything
 * the day those buttons were restyled for colour contrast — the test failed
 * for a reason that had nothing to do with booking.
 */
function bookingPanel(page: Page) {
  return page
    .getByRole("region", { name: /Book your workforce board interview/ })
    .first();
}

test("the booking dialog can be dismissed with the keyboard", async ({ page }) => {
  await page.goto("/student");

  const panel = bookingPanel(page);
  await expect(
    panel,
    "no bookable application on the student portal — restart the server to reseed",
  ).toBeVisible();

  await panel.getByRole("button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();

  // Nothing was booked, so the next test still has its application.
  await expect(bookingPanel(page)).toBeVisible();
});

test("a student books a board interview and every portal reflects it", async ({
  page,
}) => {
  // Recorded before the booking so the cross-portal assertion is a delta
  // rather than the presence of a name that would be on the page anyway.
  await page.goto("/board");
  const neverBookedBefore = await boardStat(page, "Never booked");
  expect(
    neverBookedBefore,
    "the board should start with unbooked applications — if this is 0, the server is carrying state from a previous run",
  ).toBeGreaterThan(0);

  await page.goto("/student");

  // The pause, surfaced where the student already is.
  const panel = bookingPanel(page);
  await expect(panel).toBeVisible();

  // The first slot button inside the panel. Its label is a date, which shifts
  // daily, so it is addressed by position within the named region.
  await panel.getByRole("button").first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");

  await dialog.getByRole("button", { name: "Confirm booking" }).click();

  // The outcome is announced, not just rendered.
  await expect(page.getByRole("status").first()).toContainText("Interview booked");

  // The application actually moved.
  await expect(
    page.getByText("Interview booked", { exact: false }).first(),
  ).toBeVisible();

  // The board's queue shrank, which is the point of notifying them.
  await page.goto("/board");
  expect(await boardStat(page, "Never booked")).toBe(neverBookedBefore - 1);

  // And the administrator's stalled queue is still rendering after the write.
  await page.goto("/admin");
  await expect(page.getByText("What's stuck")).toBeVisible();
});

/** Reads the number out of a labelled Stat card on the board portal. */
async function boardStat(page: Page, label: string): Promise<number> {
  const value = await page
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::p[1]")
    .innerText();
  return Number(value);
}
