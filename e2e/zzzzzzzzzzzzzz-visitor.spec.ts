import { test, expect } from "@playwright/test";

/**
 * A visitor walking the demonstration on a deployment that authenticates.
 *
 * Skipped unless the server under test was started with `AUTH_MODE=code`, for
 * the reason `zzzzzzz-sign-in.spec.ts` gives: the role picker and real sign-on
 * cannot both be true of one process. Run it with a database whose markets are
 * flagged as the demonstration — a seeded one is:
 *
 *   DATABASE_URL=… DATABASE_READ_ONLY=false AUTH_MODE=code AUTH_ECHO_CODES=true \
 *     npm run dev &
 *   AUTH_MODE=code npx playwright test e2e/zzzzzzzzzzzzzz-visitor.spec.ts
 *
 * **Why this file exists.** The visitor path and the real write path are
 * indistinguishable from the screen: both light up the same success toast and
 * both take the posting out of the recommendations. The first version of the
 * guard behind this did not fire in a Server Action at all — a page render and
 * an action are separate requests — and a click wrote a real application, a
 * real audit event and a real outbox row to Postgres while the interface said
 * exactly what it says now. Nothing on the screen was wrong. The house rule
 * covers this: a toast is not an effect.
 *
 * So the load-bearing assertion here is the **isolation** one. If a click had
 * been written to the shared database rather than to the clicking visitor's own
 * cookie, the second browser context would see the shorter list. It sees the
 * full one, and that is the proof — reached without this suite needing a
 * database connection of its own.
 */

test.skip(
  process.env.AUTH_MODE !== "code",
  "needs a server started with AUTH_MODE=code against a seeded database",
);

const APPLY = { name: "Apply", exact: true } as const;

test("the demonstration is walkable without signing in", async ({ page }) => {
  // The guard this sits on was keyed on `AUTH_MODE` and refused any anonymous
  // fallback whenever the deployment authenticated, which took the prototype
  // offline the moment real sign-on was switched on. It asks the data now: the
  // account minted is pinned to a market, and that market says it is the
  // demonstration.
  await page.goto("/demo/student");
  await expect(page.getByRole("button", APPLY).first()).toBeVisible();
});

test("applying registers, and survives leaving the page", async ({ page }) => {
  await page.goto("/demo/student");
  const apply = page.getByRole("button", APPLY);
  await apply.first().waitFor();
  const before = await apply.count();
  expect(before).toBeGreaterThan(1);

  await apply.first().click();
  await expect(page.getByRole("status").first()).toContainText("Applied to");

  // Recommendations exclude postings already applied to, so the card leaves the
  // list. Asserted after a reload rather than from the optimistic state, which
  // would pass whether or not the server had heard anything.
  await page.reload();
  await expect(async () => {
    expect(await page.getByRole("button", APPLY).count()).toBe(before - 1);
  }).toPass();

  // And again after leaving the page entirely, because the overlay is read on
  // every render rather than held in the component.
  await page.goto("/demo/business");
  await page.goto("/demo/student");
  await expect(async () => {
    expect(await page.getByRole("button", APPLY).count()).toBe(before - 1);
  }).toPass();
});

test("what the visitor did lives in their own cookie, as an intention", async ({
  page,
  context,
}) => {
  await page.goto("/demo/student");
  const apply = page.getByRole("button", APPLY);
  await apply.first().waitFor();
  await apply.first().click();
  await expect(page.getByRole("status").first()).toContainText("Applied to");

  const cookie = (await context.cookies()).find((c) => c.name === "oe_demo_actions");
  expect(cookie, "the visitor's actions were not recorded in a cookie").toBeTruthy();

  // An intention — `a=<posting id>` — rather than an application row. A row is
  // a few hundred bytes of ids, statuses and timestamps, and a cookie holds
  // four kilobytes and travels on every request; the server already holds the
  // posting and the learner to derive the rest from.
  expect(decodeURIComponent(cookie!.value)).toMatch(/^a=[a-z0-9-]+$/i);
  expect(cookie!.value.length).toBeLessThan(200);

  // Nothing in the browser reads it, so nothing in the browser should be able
  // to: the server derives everything from it.
  expect(cookie!.httpOnly).toBe(true);
});

test("one visitor's clicking does not shorten anybody else's demonstration", async ({
  browser,
}) => {
  // The assertion the whole design exists for, and the one that proves no write
  // reached the database without this suite having to connect to it.
  const first = await browser.newContext();
  const second = await browser.newContext();

  try {
    const one = await first.newPage();
    await one.goto("/demo/student");
    const apply = one.getByRole("button", APPLY);
    await apply.first().waitFor();
    const seeded = await apply.count();

    await apply.first().click();
    await expect(one.getByRole("status").first()).toContainText("Applied to");
    await one.reload();
    await expect(async () => {
      expect(await one.getByRole("button", APPLY).count()).toBe(seeded - 1);
    }).toPass();

    // A different browser, therefore a different cookie jar. It meets the
    // demonstration exactly as seeded. Had the click been written to the shared
    // database — which is what happened before the guard was fixed, and what a
    // market shared between visitors would do by design — this would be short
    // by one, and would get shorter with every visitor until somebody re-seeded.
    const two = await second.newPage();
    await two.goto("/demo/student");
    await expect(two.getByRole("button", APPLY).first()).toBeVisible();
    expect(await two.getByRole("button", APPLY).count()).toBe(seeded);
  } finally {
    await first.close();
    await second.close();
  }
});
