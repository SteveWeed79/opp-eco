import { test, expect } from "@playwright/test";

/**
 * The scheduled drain, and who may run it.
 *
 * A drain is not a read — it sends email — so an endpoint anyone can hit is an
 * endpoint anyone can use to empty a queue at a moment of their choosing. The
 * assertions here are all about the refusal, because that is the part that has
 * to hold on a deployment nobody configured.
 *
 * The suite's own server runs without `CRON_SECRET`, which is the important
 * case: unconfigured must mean closed, not open.
 */

test("refuses an unauthenticated caller", async ({ request }) => {
  const response = await request.get("/api/cron/notifications");
  // 404, not 401: a 401 confirms the endpoint exists and is worth coming back
  // to with a better guess.
  expect(response.status()).toBe(404);
});

test("refuses a guessed secret", async ({ request }) => {
  const response = await request.get("/api/cron/notifications", {
    headers: { Authorization: "Bearer probably-the-secret" },
  });
  expect(response.status()).toBe(404);
});

test("refuses when no secret is configured at all", async ({ request }) => {
  // The failure mode this exists for. "Allow because unconfigured" would mean
  // the one deployment that forgot to set it is the one with an open endpoint.
  const response = await request.get("/api/cron/notifications", {
    headers: { Authorization: "Bearer " },
  });
  expect(response.status()).toBe(404);
});

test("says nothing about itself while refusing", async ({ request }) => {
  const response = await request.get("/api/cron/notifications");
  const body = await response.text();
  for (const leak of ["CRON_SECRET", "drain", "queue", "notification"]) {
    expect(body.toLowerCase()).not.toContain(leak.toLowerCase());
  }
});
