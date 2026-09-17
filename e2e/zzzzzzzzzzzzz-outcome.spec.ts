import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Recording where a learner went, and the platform deciding what it counts as.
 *
 * Skipped unless the server under test runs in code mode, like the other
 * sign-on-dependent suites. Run it with:
 *
 *   AUTH_MODE=code AUTH_ECHO_CODES=true npm run dev > /tmp/oe.log &
 *   AUTH_MODE=code AUTH_ECHO_LOG=/tmp/oe.log npx playwright test e2e/zzzzzzzzzzzzz-outcome.spec.ts
 */

const LOG = process.env.AUTH_ECHO_LOG;

test.skip(
  process.env.AUTH_MODE !== "code" || !LOG,
  "needs a dev server in code mode with AUTH_ECHO_LOG pointing at its log",
);

const COLLEGE = "evance@verdigris.example.edu";
const ADMIN = "admin@ccln.example";
const PASSWORD = "the quiet kansas afternoon";

function echoedResetCode(email: string): string {
  const lines = readFileSync(LOG!, "utf8")
    .split("\n")
    .filter((l) => l.includes("auth.reset_code_echoed") && l.includes(email));
  return JSON.parse(lines.at(-1)!).code as string;
}

async function signIn(
  page: import("@playwright/test").Page,
  email: string,
  portal: string,
) {
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Forgot your password?" }).click();
  await expect(page.getByLabel("Reset code")).toBeVisible();
  await page.getByLabel("Reset code").fill(echoedResetCode(email));
  await page.getByLabel("New password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByRole("status").filter({ hasText: /password set/i })).toBeVisible();

  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**/demo/${portal}`);
}

const signInAsCollege = (page: import("@playwright/test").Page) =>
  signIn(page, COLLEGE, "college");

/** What the administrator's outcome panel currently reports. */
async function outcomeFigures(page: import("@playwright/test").Page) {
  await page.goto("/demo/admin");
  const stat = async (label: string) => {
    const el = page.locator("div").filter({ hasText: new RegExp(`^${label}`) }).last();
    return (await el.count()) ? (await el.innerText()) : "";
  };
  return {
    stayed: await stat("Stayed in the region"),
    unknown: await stat("Working, place unknown"),
  };
}

test("the county is asked for, and only for employment", async ({ page }) => {
  await signInAsCollege(page);

  await page.getByRole("button", { name: "Record outcome" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // Nothing about a place until the answer is employment — a county on
  // "still looking" is a field that can only be filled in wrongly.
  await page.getByText("Still looking", { exact: false }).first().click();
  await expect(page.getByLabel("County they work in")).toHaveCount(0);

  await page.getByText("Employed", { exact: true }).first().click();
  await expect(page.getByLabel("County they work in")).toBeVisible();
  await expect(page.getByLabel("State")).toHaveValue("KS");
});

test("a hire by the host needs no county at all", async ({ page }) => {
  await signInAsCollege(page);
  await page.getByRole("button", { name: "Record outcome" }).first().click();
  await page.getByText("Employed", { exact: true }).first().click();

  await expect(page.getByLabel("County they work in")).toBeVisible();
  await page.getByRole("checkbox").first().check();
  // The host is an employer in this market, so it is regional by construction.
  await expect(page.getByLabel("County they work in")).toHaveCount(0);
});

test("a county outside the market is recorded, not refused", async ({ page }) => {
  await signInAsCollege(page);
  await page.getByRole("button", { name: "Record outcome" }).first().click();
  await page.getByText("Employed", { exact: true }).first().click();

  // A learner can take a job anywhere. The platform decides what it counts as
  // rather than refusing what it did not expect.
  await page.getByLabel("County they work in").fill("Jasper");
  await page.getByLabel("State").fill("MO");
  await page.getByRole("button", { name: "Record it" }).click();

  await expect(
    page.getByRole("status").filter({ hasText: /is measured/i }),
  ).toBeVisible();
});

test("a recorded county reaches the figure it is supposed to move", async ({ page, context }) => {
  // The assertion this suite was missing. An earlier version checked only that
  // a success toast appeared — which it did, while the county was being dropped
  // on the way through a Server Action wrapper whose signature was one
  // parameter short. A toast is not an effect.
  await signInAsCollege(page);
  await page.getByRole("button", { name: "Record outcome" }).first().click();
  await page.getByText("Employed", { exact: true }).first().click();
  // Crawford is one of this market's counties, so this must land as *stayed* —
  // and if the place is lost it lands in "place unknown" instead, which is
  // exactly the difference that makes this test worth having.
  await page.getByLabel("County they work in").fill("Crawford");
  await page.getByLabel("State").fill("KS");
  await page.getByRole("button", { name: "Record it" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /is measured/i }),
  ).toBeVisible();

  await context.clearCookies();
  await signIn(page, ADMIN, "admin");
  const after = await outcomeFigures(page);

  // The learner counts as having stayed, and nothing landed in the
  // place-unknown bucket that a dropped county would have filled.
  expect(after.stayed).toMatch(/of \d+ measured/);
  expect(after.unknown).toBe("");
});
