import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Access: who can sign in for an organization, and under what address.
 *
 * Skipped unless the server under test was started with `AUTH_MODE=code`, like
 * the other sign-on suites and for the same reason — a process is either the
 * demonstration's role picker or real sign-on and cannot be both. Run it with:
 *
 *   AUTH_MODE=code AUTH_ECHO_CODES=true npm run dev > /tmp/oe.log &
 *   AUTH_MODE=code AUTH_ECHO_LOG=/tmp/oe.log npx playwright test e2e/zzzzzzzzzzzz-access.spec.ts
 *
 * The administrator lets itself in through the product's own front door rather
 * than from a seeded password, so this needs no set-up of its own.
 */

const LOG = process.env.AUTH_ECHO_LOG;

test.skip(
  process.env.AUTH_MODE !== "code" || !LOG,
  "needs a dev server in code mode with AUTH_ECHO_LOG pointing at its log",
);

/** Unique per run, so re-running does not collide with the account it added. */
const RUN = Date.now().toString(36);
const ADMIN = "admin@ccln.example";
const PASSWORD = "the quiet kansas afternoon";

function echoedResetCode(email: string): string {
  const lines = readFileSync(LOG!, "utf8")
    .split("\n")
    .filter((l) => l.includes("auth.reset_code_echoed") && l.includes(email));
  return JSON.parse(lines.at(-1)!).code as string;
}

async function signInAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/demo/sign-in");
  await page.getByLabel("Work email").fill(ADMIN);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Forgot your password?" }).click();
  await expect(page.getByLabel("Reset code")).toBeVisible();
  await page.getByLabel("Reset code").fill(echoedResetCode(ADMIN));
  await page.getByLabel("New password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByRole("status").filter({ hasText: /password set/i })).toBeVisible();

  await page.getByLabel("Work email").fill(ADMIN);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/demo/admin");
}

test("an administrator adds a board officer with their own address", async ({ page }) => {
  await signInAsAdmin(page);

  await page.getByLabel("Organization").selectOption({ label: "Southeast Kansas Workforce Partnership" });
  await page.getByLabel("Name").fill("Ray Okonkwo");
  await page.getByLabel("Work email").last().fill(`rokonkwo-${RUN}@sekwp.example.org`);
  await page.getByRole("button", { name: "Add person" }).click();

  await expect(
    page.getByRole("status").filter({ hasText: /can now sign in/i }),
  ).toBeVisible();
});

test("a personal address is refused for a work account", async ({ page }) => {
  await signInAsAdmin(page);

  await page.getByLabel("Organization").selectOption({ label: "Southeast Kansas Workforce Partnership" });
  await page.getByLabel("Name").fill("Somebody Else");
  await page.getByLabel("Work email").last().fill("somebody@gmail.example");
  await page.getByRole("button", { name: "Add person" }).click();

  const refusal = page.locator('[role="alert"]:not([id="__next-route-announcer__"])');
  await expect(refusal).toContainText(/address is required|personal address/i);
});

test("moving an address needs a reason and warns the old one", async ({ page }) => {
  await signInAsAdmin(page);

  // Its own account rather than the seeded officer's, so the suite does not
  // depend on which address that officer is currently on.
  const from = `moving-${RUN}@sekwp.example.org`;
  const to = `moved-${RUN}@sekwp.example.org`;

  await page.getByLabel("Organization").selectOption({
    label: "Southeast Kansas Workforce Partnership",
  });
  await page.getByLabel("Name").fill("Pat Mensah");
  await page.getByLabel("Work email").last().fill(from);
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /can now sign in/i }),
  ).toBeVisible();

  await page.getByLabel("Address on the account now").fill(from);
  await page.getByLabel("New work address").fill(to);
  await page.getByLabel("Reason").fill("Agency migrated staff mail");
  await page.getByRole("button", { name: "Move address" }).click();

  await expect(
    page.getByRole("status").filter({ hasText: /old one has been told/i }),
  ).toBeVisible();

  // The warning went to the address being left behind, which is the only one
  // that proves anything: if this was not the person's idea, that is where the
  // message lands.
  const log = readFileSync(LOG!, "utf8");
  expect(log).toContain("access.warning_echoed");
  expect(log).toContain(from);
});
