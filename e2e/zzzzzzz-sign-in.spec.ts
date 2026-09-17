import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Real sign-on, walked the way a person walks it.
 *
 * Skipped unless the server under test was started with `AUTH_MODE=code`,
 * because the rest of this suite runs the demo picker and the two cannot be
 * true of one process. Run it with:
 *
 *   AUTH_MODE=code AUTH_ECHO_CODES=true npm run dev > /tmp/oe.log &
 *   AUTH_MODE=code AUTH_ECHO_LOG=/tmp/oe.log npx playwright test e2e/zzzzzzz-sign-in.spec.ts
 *
 * The code is read back from the server's own log, which is the only place it
 * exists outside the mailbox: it is deliberately never written to the
 * notification outbox, because that would publish a bearer token for every
 * account on a screen the administrator can open.
 *
 * `npm run dev`, and not the production build the rest of this suite uses,
 * because `authConfig` refuses `AUTH_ECHO_CODES` in production. That refusal is
 * the point of the flag — a code in a log is a code in whatever aggregates that
 * log — so the test bends around it rather than the other way about. Nothing
 * here depends on the difference; the headers that do are asserted elsewhere.
 */

const LOG = process.env.AUTH_ECHO_LOG;

test.skip(
  process.env.AUTH_MODE !== "code" || !LOG,
  "needs a server started with AUTH_MODE=code AUTH_ECHO_CODES=true and AUTH_ECHO_LOG pointing at its log",
);

/** The most recent code the server says it sent to this address. */
function echoedCodeFor(email: string): string {
  const lines = readFileSync(LOG!, "utf8")
    .split("\n")
    .filter((line) => line.includes("auth.code_echoed") && line.includes(email));
  const last = lines.at(-1);
  expect(last, `no code was echoed for ${email}`).toBeTruthy();
  return JSON.parse(last!).code as string;
}

const BOARD = "mdelgado@sekwp.example.org";

test("a portal refuses an anonymous request before it renders anything", async ({
  request,
}) => {
  // `maxRedirects: 0` is the whole assertion. Following the redirect would pass
  // even when the server answered 200 with the portal's shell and a client-side
  // navigation bolted on, which is exactly the bug this guards.
  const response = await request.get("/demo/college", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toContain("/sign-in");
  // Nothing about the college — not its records, and not its name.
  expect(await response.text()).not.toContain("Verdigris");
});

test("a forged session cookie is not a session", async ({ request }) => {
  const response = await request.get("/demo/admin", {
    maxRedirects: 0,
    headers: { Cookie: "oe_session=not-a-real-token" },
  });
  expect(response.status()).toBe(307);
});

test("the way in is the sign-in page, not the role picker", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("button", { name: "Sign on" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

  // Removing the control is presentation. What actually closes the door is
  // `signInAs` refusing on the server when the mode is not `demo`, because a
  // Server Action is a URL and a hidden button is still a reachable one.
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.waitForURL("**/sign-in");
  await expect(page.getByLabel("Work email")).toBeVisible();
});

test("a code signs a board officer in, and only into their own portal", async ({
  page,
  context,
}) => {
  // The board, not the college. Under the address-first form a college resolves
  // to a password and never sees this path; a public employee is the population
  // the code path now exists for, and the only one this platform holds no
  // password for.
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(BOARD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Code")).toBeVisible();

  await page.getByLabel("Code").fill(echoedCodeFor(BOARD));
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/demo/board");
  await expect(page.locator("header")).toContainText("Marcia Delgado");

  const cookie = (await context.cookies()).find((c) => c.name === "oe_session");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  // The cookie is a token, not a claim. Nothing in it names a role, so nothing
  // in it can be edited into a different one.
  expect(cookie?.value).not.toContain("board");

  // Somebody else's portal, held by a real session: their own, not a refusal
  // to sign in.
  await page.goto("/demo/admin");
  await page.waitForURL("**/demo/board");
});

test("a wrong code refuses, and no session starts", async ({ page, context }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(BOARD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Code")).toBeVisible();

  // Derived from the real code rather than invented, so it is the right shape
  // and the right length — a refusal for being malformed would prove nothing.
  const real = echoedCodeFor(BOARD);
  const wrong = real.slice(0, -1) + (real.endsWith("X") ? "Y" : "X");

  await page.getByLabel("Code").fill(wrong);
  await page.getByRole("button", { name: "Sign in" }).click();

  // `alert`, not `status`: a refusal is announced assertively, which is the
  // difference between a screen reader interrupting with it and queueing it
  // behind whatever else is being read. Next's own route announcer is also an
  // alert and is always empty, so it is excluded by id rather than by taking
  // `.first()`, which would be an assertion about DOM order.
  const refusal = page.locator('[role="alert"]:not([id="__next-route-announcer__"])');
  await expect(refusal).toContainText(/not valid|expired|try again/i);
  await expect(page).toHaveURL(/\/sign-in/);
  expect((await context.cookies()).find((c) => c.name === "oe_session")).toBeUndefined();
  // Single use, expiry, and the attempt limit are asserted against the service
  // in `src/services/auth.test.ts`, where the clock can be moved. This is the
  // part only a browser can answer: the refusal reaches the person.
});

test("an invented address on the agency's domain looks exactly like a real officer", async ({
  page,
}) => {
  // The enumeration assertion, moved to where it actually bites. Anyone can
  // guess `firstname.lastname@` at a public agency, and the reply must not say
  // which guesses landed — a directory of which officers work on this programme
  // is exactly what a workforce board cannot have published on its behalf.
  const invented = "nobody.at.all@sekwp.example.org";
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(invented);
  await page.getByRole("button", { name: "Continue" }).click();

  // Same second step, same words as the real officer gets.
  await expect(page.getByLabel("Code")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/if that address/i);

  // And nothing was sent. The screen says the same thing either way; the log is
  // where the difference would be, and there is no code in it for this address.
  // Narrowed to the delivery line on purpose: `next dev` traces every Server
  // Action with its arguments, so the address itself is in the log either way.
  const codes = readFileSync(LOG!, "utf8")
    .split("\n")
    .filter((line) => line.includes("auth.code_echoed") && line.includes(invented));
  expect(codes).toHaveLength(0);
});

/**
 * Two neighbours of these tests live elsewhere on purpose.
 *
 * A public employee never being shown a password field is in
 * `zzzzzzzzzzz-password.spec.ts`, alongside the rest of the address-decides-the-
 * door behaviour. A `federated` organization being told to use its own identity
 * provider is in `src/services/auth.test.ts`, because nothing is seeded into
 * that mode any more — asserting it in a browser would mean mutating the
 * server's seed from a test, which is a worse test than the one that sets the
 * mode directly.
 */
