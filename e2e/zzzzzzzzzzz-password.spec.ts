import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Password sign-on, walked the way a person walks it.
 *
 * Skipped unless the server under test was started with `AUTH_MODE=code`, for
 * the same reason the code suite is: a process is either the demonstration's
 * role picker or real sign-on and cannot be both. Run it with:
 *
 *   AUTH_MODE=code AUTH_ECHO_CODES=true npm run dev > /tmp/oe.log &
 *   AUTH_MODE=code AUTH_ECHO_LOG=/tmp/oe.log npx playwright test e2e/zzzzzzzzzzz-password.spec.ts
 *
 * Nothing is seeded out of band. The suite gives the college its password
 * through the product's own front door, which is the only way a real account
 * ever gets one — there is no self-serve signup here, so every password in the
 * system was chosen after a code arrived in somebody's mailbox. Seeding it with
 * a script instead would have tested a state the product cannot reach, and
 * would have needed a database the in-memory backend does not have.
 */

const LOG = process.env.AUTH_ECHO_LOG;

test.skip(
  process.env.AUTH_MODE !== "code" || !LOG,
  "needs a dev server in code mode with AUTH_ECHO_LOG pointing at its log",
);

const COLLEGE = "evance@verdigris.example.edu";
const BOARD = "mdelgado@sekwp.example.org";
const PASSWORD = "the quiet kansas afternoon";

/** The most recent reset code the server says it sent to this address. */
function echoedResetCode(email: string): string {
  const lines = readFileSync(LOG!, "utf8")
    .split("\n")
    .filter((line) => line.includes("auth.reset_code_echoed") && line.includes(email));
  const last = lines.at(-1);
  expect(last, `no reset code was echoed for ${email}`).toBeTruthy();
  return JSON.parse(last!).code as string;
}

/** A toast, picked by what it says — two of them can be on screen at once. */
function toast(page: Page, saying: RegExp) {
  return page.getByRole("status").filter({ hasText: saying });
}

const refusal = (page: Page) =>
  page.locator('[role="alert"]:not([id="__next-route-announcer__"])');

/**
 * Run the whole reset flow and leave the account on `next`.
 *
 * Used to establish the password in the first place and to put it back after a
 * test changes it: the suite shares one server and one store and does not
 * retry, so a test that changes a password has to restore it or every sibling
 * that knew the old one breaks.
 */
async function setPasswordByEmail(page: Page, next: string): Promise<void> {
  await page.goto("/demo/sign-in");
  await page.getByLabel("Work email").fill(COLLEGE);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Forgot your password?" }).click();
  await expect(page.getByLabel("Reset code")).toBeVisible();

  await page.getByLabel("Reset code").fill(echoedResetCode(COLLEGE));
  await page.getByLabel("New password").fill(next);
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(toast(page, /password set/i)).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  if (process.env.AUTH_MODE !== "code" || !LOG) return;
  const page = await browser.newPage();
  try {
    await setPasswordByEmail(page, PASSWORD);
  } finally {
    await page.close();
  }
});

test("an account that has never had a password can get one", async ({ page }) => {
  // The bootstrap above is the assertion, and this says so on screen: an
  // administrator creates the account, and the person chooses the password
  // themselves rather than being told one over the phone.
  await page.goto("/demo/sign-in");
  await page.getByLabel("Work email").fill(COLLEGE);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/never set one\? use the same link/i)).toBeVisible();
});

test("an address decides which door opens", async ({ page }) => {
  await page.goto("/demo/sign-in");

  // A college is asked for a password.
  await page.getByLabel("Work email").fill(COLLEGE);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByText(COLLEGE)).toBeVisible();
});

test("a government address is sent a code, and never shown a password field", async ({
  page,
}) => {
  await page.goto("/demo/sign-in");
  await page.getByLabel("Work email").fill(BOARD);
  await page.getByRole("button", { name: "Continue" }).click();

  // The whole point of resolving the method before asking for anything: nobody
  // is shown a field they cannot use.
  await expect(page.getByLabel("Code")).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveCount(0);
  await expect(page.getByText(/no password is held here/i)).toBeVisible();
});

test("a college signs in with its password", async ({ page, context }) => {
  await page.goto("/demo/sign-in");
  await page.getByLabel("Work email").fill(COLLEGE);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/demo/college");
  const cookie = (await context.cookies()).find((c) => c.name === "oe_session");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
});

test("a wrong password refuses, and starts no session", async ({ page, context }) => {
  await page.goto("/demo/sign-in");
  await page.getByLabel("Work email").fill(COLLEGE);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Password").fill("not the right password at all");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(refusal(page)).toContainText(/do not match/i);
  expect((await context.cookies()).find((c) => c.name === "oe_session")).toBeUndefined();
});

test("an address nobody holds is refused in the same words", async ({ page }) => {
  // The two failures must not be distinguishable: the difference between them
  // is a directory of who takes part in this programme.
  await page.goto("/demo/sign-in");
  await page.getByLabel("Work email").fill("nobody@nowhere.example");
  await page.getByRole("button", { name: "Continue" }).click();
  // Answered `password`, because the domain is not one anybody declared.
  await expect(page.getByLabel("Password")).toBeVisible();

  await page.getByLabel("Password").fill("anything at all really");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(refusal(page)).toContainText(/do not match/i);
});

test("forgetting a password offers a reset", async ({ page }) => {
  await page.goto("/demo/sign-in");
  await page.getByLabel("Work email").fill(COLLEGE);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Forgot your password?" }).click();

  await expect(page.getByLabel("Reset code")).toBeVisible();
  await expect(page.getByLabel("New password")).toBeVisible();
  await expect(toast(page, /if that address/i)).toBeVisible();
});

test("the page says what decides the door, without naming anybody", async ({ page }) => {
  await page.goto("/demo/sign-in");
  const rendered = await page.locator("main").innerText();
  expect(rendered).toMatch(/holds no password for a government employee/i);
  // No account list, no hint about who exists.
  for (const person of ["Ellen", "Marcia", "Omar", "Dana", "Steve"]) {
    expect(rendered).not.toContain(person);
  }
});

test("a forgotten password is replaced, and the old one stops working", async ({
  page,
  context,
}) => {
  // The whole loop, because each half passing separately proves nothing about
  // whether they meet: request a code, use it, sign in with what was chosen.
  const NEW = "a different kansas afternoon";

  try {
    await setPasswordByEmail(page, NEW);

    // The new one works.
    await page.getByLabel("Work email").fill(COLLEGE);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Password").fill(NEW);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/demo/college");

    // And the old one does not.
    await context.clearCookies();
    await page.goto("/demo/sign-in");
    await page.getByLabel("Work email").fill(COLLEGE);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(refusal(page)).toContainText(/do not match/i);
  } finally {
    await context.clearCookies();
    await setPasswordByEmail(page, PASSWORD);
  }
});

test("a reset code cannot be spent twice", async ({ page, context }) => {
  try {
    await page.goto("/demo/sign-in");
    await page.getByLabel("Work email").fill(COLLEGE);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Forgot your password?" }).click();
    await expect(page.getByLabel("Reset code")).toBeVisible();

    const code = echoedResetCode(COLLEGE);
    await page.getByLabel("Reset code").fill(code);
    await page.getByLabel("New password").fill("one more kansas afternoon");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(toast(page, /password set/i)).toBeVisible();

    // The same code again, against a fresh request so the form is in the right
    // state — the code itself is what must be refused, not the form.
    await page.getByLabel("Work email").fill(COLLEGE);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Forgot your password?" }).click();
    await page.getByLabel("Reset code").fill(code);
    await page.getByLabel("New password").fill("yet another afternoon here");
    await page.getByRole("button", { name: "Set new password" }).click();

    await expect(refusal(page)).toContainText(/not valid/i);
  } finally {
    await context.clearCookies();
    await setPasswordByEmail(page, PASSWORD);
  }
});
