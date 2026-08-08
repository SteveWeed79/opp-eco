import { test, expect } from "@playwright/test";

/**
 * Component behaviour that only exists at runtime.
 *
 * Focus traps, arrow-key navigation, and announced sort order cannot be
 * verified by reading the source or by a unit test against a DOM stub — they
 * depend on real focus, real key events, and real hydration. The gallery
 * renders every component, which makes it the cheapest place to check them.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/design");
});

test.describe("tabs", () => {
  test("move with arrow keys and wrap at the ends", async ({ page }) => {
    const tabs = page.getByRole("tab");
    await tabs.first().focus();

    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { selected: true })).toHaveText(/Forms/);

    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { selected: true })).toHaveText(
      /Actions & feedback/,
    );

    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { selected: true })).toHaveText(/Loading/);
  });

  test("keep only the active tab in the tab order", async ({ page }) => {
    // Otherwise a keyboard user tabs through every tab rather than past them.
    const inactive = page.getByRole("tab", { selected: false }).first();
    await expect(inactive).toHaveAttribute("tabindex", "-1");
  });
});

test.describe("modal", () => {
  test("traps focus and restores it on close", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "Open modal" });
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Tabbing repeatedly must never land outside the dialog.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const insideDialog = await page.evaluate(() => {
        const active = document.activeElement;
        const panel = document.querySelector('[role="dialog"]');
        return Boolean(panel && active && panel.contains(active));
      });
      expect(insideDialog).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    // Focus returns where it came from, not to the top of the document.
    await expect(trigger).toBeFocused();
  });

  test("does not let the page behind it scroll", async ({ page }) => {
    await page.getByRole("button", { name: "Open modal" }).click();
    const overflow = await page.evaluate(() => document.body.style.overflow);
    expect(overflow).toBe("hidden");
  });
});

test.describe("confirm dialog", () => {
  test("stays disabled until a reason is given", async ({ page }) => {
    await page.getByRole("button", { name: "Terminate placement" }).click();

    const confirm = page.getByRole("button", { name: "End placement" });
    // The audit log requires a reason, so the control enforces it.
    await expect(confirm).toBeDisabled();

    await page.getByRole("textbox").fill("Supervisor left the company");
    await expect(confirm).toBeEnabled();
  });

  test("starts empty each time it opens", async ({ page }) => {
    await page.getByRole("button", { name: "Terminate placement" }).click();
    await page.getByRole("textbox").fill("First reason");
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Terminate placement" }).click();
    // A stale reason silently attaching to the next confirmation would be
    // worse than any render cost.
    await expect(page.getByRole("textbox")).toHaveValue("");
  });
});

test.describe("data table", () => {
  test("announces its sort order", async ({ page }) => {
    await page.getByRole("tab", { name: /Data display/ }).click();

    const header = page.getByRole("columnheader", { name: /Dwell/ });
    await header.getByRole("button").click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");

    await header.getByRole("button").click();
    await expect(header).toHaveAttribute("aria-sort", "descending");
  });
});

test.describe("toasts", () => {
  test("are announced in a live region", async ({ page }) => {
    await page.getByRole("button", { name: "Success" }).click();
    // role=status is an implicit live region; without it the outcome is
    // visible only to people who happen to be looking at that corner.
    await expect(page.getByRole("status").first()).toContainText(
      "Interview booked",
    );
  });

  test("keep errors until dismissed", async ({ page }) => {
    await page.getByRole("button", { name: "Error", exact: true }).click();
    const alert = page.getByRole("alert").first();
    await expect(alert).toBeVisible();
    // Success clears itself; an error the user missed helps nobody.
    await page.waitForTimeout(5500);
    await expect(alert).toBeVisible();
  });
});

test.describe("choice group", () => {
  test("behaves as a radiogroup, not a row of toggle buttons", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign on" }).click();

    const group = page.getByRole("radiogroup");
    await expect(group).toBeVisible();

    const options = group.getByRole("radio");
    await expect(options.first()).toHaveAttribute("aria-checked", "true");

    // Arrow keys move *and* select, which is the radiogroup pattern. Toggle
    // buttons would need Tab to each one and Space to press it, and would
    // never tell a screen reader that choosing one released the others.
    await options.first().focus();
    await page.keyboard.press("ArrowDown");

    await expect(options.nth(1)).toHaveAttribute("aria-checked", "true");
    await expect(options.first()).toHaveAttribute("aria-checked", "false");

    // One tab stop for the whole group: only the selected option is reachable
    // by Tab, so passing five accounts costs one keystroke rather than five.
    await expect(options.nth(1)).toHaveAttribute("tabindex", "0");
    await expect(options.first()).toHaveAttribute("tabindex", "-1");

    // Wrapping at the end, so the group is navigable in one direction.
    const count = await options.count();
    for (let i = 1; i < count; i++) await page.keyboard.press("ArrowDown");
    await expect(options.first()).toHaveAttribute("aria-checked", "true");
  });
});
