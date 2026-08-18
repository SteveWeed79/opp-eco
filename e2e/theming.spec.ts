import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { hueOf, rampFromHue } from "../src/theme/ramp";

/**
 * The white-label layer, end to end.
 *
 * The unit tests prove the ramp is readable for every hue and that the checker
 * gives the right advice. Neither proves the colours reach a page — the whole
 * mechanism is a CSS custom property set on a wrapper, and a wrapper that
 * silently stops rendering breaks theming without breaking a single test.
 *
 * So these read the *computed* value out of the browser. That is the thing the
 * user sees, and it is downstream of every layer in between.
 */

/** The demo college's seeded colours. */
const SEEDED_BRAND = "#1b5e3f";
const SEEDED_ACCENT = "#c9a227";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Open the colour editor on the college portal.
 *
 * The inputs and the findings live in a dialog rather than in a form standing
 * open on the page — settings touched once a year should not be the tallest
 * thing on an operational screen. The summary row keeps the generated palette
 * and a count of the findings visible without it.
 */
async function openColourEditor(page: Page) {
  await page.goto("/college");
  await page.getByRole("button", { name: "Edit colours" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

/**
 * Read a custom property as the browser resolved it inside the themed subtree.
 *
 * Deliberately not off `:root` — the platform defaults live there in
 * `globals.css` and a partner theme is set on a wrapper below it. Reading the
 * root returns the default on every page and makes this suite pass whether or
 * not theming works at all, which is what it did on the first run.
 */
function themedVariable(page: Page, property: string) {
  return page.evaluate(
    (name) =>
      getComputedStyle(document.querySelector("main")!)
        .getPropertyValue(name)
        .trim(),
    property,
  );
}

const brandTone = (page: Page, step: number) =>
  themedVariable(page, `--color-brand-${step}`);

test.describe("a partner's colours reach the pages that are theirs", () => {
  test("the student portal renders in the college's brand", async ({ page }) => {
    await page.goto("/student");

    // Not "some colour was set" — the exact tone the ramp computes for the
    // seeded green, so a wrapper that renders but ignores the theme fails.
    const expected = rampFromHue(hueOf(SEEDED_BRAND))[700];
    expect(await brandTone(page, 700)).toBe(expected);
  });

  test("the college portal does too", async ({ page }) => {
    await page.goto("/college");
    expect(await brandTone(page, 700)).toBe(rampFromHue(hueOf(SEEDED_BRAND))[700]);
  });

  test("the board console stays the platform's own colour", async ({ page }) => {
    // Painting a board's oversight console in one college's colours would
    // misrepresent what the board is looking at. This is the gate that stops
    // it, and it is one boolean away from being wrong.
    await page.goto("/board");

    const themed = rampFromHue(hueOf(SEEDED_BRAND))[700];
    expect(await brandTone(page, 700)).not.toBe(themed);
  });

  test("the second colour appears as a band, and only where themed", async ({
    page,
  }) => {
    await page.goto("/student");
    const themed = await themedVariable(page, "--color-accent");

    await page.goto("/board");
    expect(await themedVariable(page, "--color-accent")).not.toBe(themed);
  });

  test("a themed page says whose colours it is wearing", async ({ page }) => {
    // A themed page with no attribution claims to be the school's own system,
    // which is a different and worse claim than "your school, on this
    // platform".
    await page.goto("/student");
    await expect(page.getByText("Themed for")).toBeVisible();
  });
});

test.describe("the theme checker tells a college what will happen", () => {
  test("names the adjustment when a colour has to be deepened", async ({
    page,
  }) => {
    await openColourEditor(page);

    const hex = page.getByLabel("Primary hex value");
    await hex.fill("#4da3ff");

    // The rendered value is named, so the difference is checkable rather than
    // something the college has to notice for themselves.
    await expect(
      page.getByText("Your primary renders darker than the colour you gave"),
    ).toBeVisible();
    await expect(page.getByText(rampFromHue(hueOf("#4da3ff"))[700])).toBeVisible();
  });

  test("points a too-light colour at the role it actually suits", async ({
    page,
  }) => {
    await openColourEditor(page);
    await page.getByLabel("Primary hex value").fill("#ffc627");

    await expect(
      page.getByText("This looks like a second colour, not a primary"),
    ).toBeVisible();
  });

  test("flags a colour that collides with a status colour", async ({ page }) => {
    await openColourEditor(page);
    // A crimson: a real institutional colour, and where this product puts
    // errors and destructive actions.
    await page.getByLabel("Primary hex value").fill("#a6192e");

    await expect(
      page.getByText("Your primary is close to the colour used for critical"),
    ).toBeVisible();
  });

  test("advises rather than blocks", async ({ page }) => {
    await openColourEditor(page);
    await page.getByLabel("Primary hex value").fill("#a6192e");

    // Every warning above still renders a palette. A school knows its own
    // brand; refusing a legitimate institutional colour is worse than
    // explaining the trade-off.
    await expect(page.getByTitle(/^700 — #/)).toBeVisible();
  });

  test("reports the demo college's own seeded pair honestly", async ({
    page,
  }) => {
    await openColourEditor(page);

    // Green and gold is an extremely common institutional pairing, and it
    // collides twice. Kept in the seed rather than swapped for something that
    // reports clean.
    await expect(
      page.getByText("Your primary is close to the colour used for success"),
    ).toBeVisible();
    await expect(
      page.getByText("Your accent is close to the colour used for warning"),
    ).toBeVisible();
  });

  test("says there is something to read without being opened", async ({
    page,
  }) => {
    // The reason the editor can live in a dialog at all. If the page gave no
    // sign the checker had found anything, moving it behind a button would
    // have turned a check nobody can miss into one nobody opens — the seeded
    // green-and-gold pair collides twice and that has to reach the page.
    await page.goto("/college");

    await expect(page.getByText("2 things worth knowing")).toBeVisible();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("the advice it gives is itself accessible", async ({ page }) => {
    await openColourEditor(page);
    await page.getByLabel("Primary hex value").fill("#a6192e");
    await page.getByLabel("Second colour hex value").fill(SEEDED_ACCENT);
    await expect(page.getByText("Your accent takes dark text")).toBeVisible();

    // The findings list is a state a static scan of the page never reaches.
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target.join(" ")),
      })),
    ).toEqual([]);
  });
});
