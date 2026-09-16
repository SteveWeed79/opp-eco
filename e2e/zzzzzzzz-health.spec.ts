import { test, expect } from "@playwright/test";

/**
 * Health, at the two resolutions it is allowed to answer at.
 *
 * The interesting assertion is the negative one. An unauthenticated health
 * endpoint is a reconnaissance surface the moment it answers in detail —
 * "Postgres is not answering", a driver name, a migration filename, the host
 * and port of an internal scanner — so this asserts what an anonymous caller
 * does *not* get, which is everything except the verdict.
 */

test("an anonymous caller gets a verdict and nothing else", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(Object.keys(body)).toEqual(["status"]);
  expect(["ok", "degraded", "failing"]).toContain(body.status);

  // No check names, no configuration, no internals — asserted against the
  // whole body rather than field by field, because the leak that matters is
  // the field somebody adds later without thinking about this endpoint.
  const text = JSON.stringify(body);
  for (const leak of ["Postgres", "fixtures", "clamd", "EICAR", "migrat", "driver", ".sql"]) {
    expect(text).not.toContain(leak);
  }
});

test("it is never cached, and it carries the request id", async ({ request }) => {
  const response = await request.get("/api/health");
  // A cached health check reports the state of some earlier minute.
  expect(response.headers()["cache-control"]).toContain("no-store");
  // Short and unambiguous, because its whole job is to be quoted by somebody
  // describing a failure.
  expect(response.headers()["x-request-id"]).toMatch(/^[A-Z2-9]{8}$/);
});

test("an upstream request id is kept rather than replaced", async ({ request }) => {
  const response = await request.get("/api/health", {
    headers: { "x-request-id": "req_from_the_platform" },
  });
  expect(response.headers()["x-request-id"]).toBe("req_from_the_platform");
});

test("a header that would forge a log line gets a fresh id instead", async ({
  request,
}) => {
  const response = await request.get("/api/health", {
    headers: { "x-request-id": "abc.def-ghi_jkl".padEnd(80, "x") },
  });
  // Too long to be plausible, so it is replaced rather than echoed.
  expect(response.headers()["x-request-id"]).toMatch(/^[A-Z2-9]{8}$/);
});

test("the administrator gets the detail, and it names nobody", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Sign on" }).click();
  await page.getByRole("radio", { name: /Steve Weed/ }).click();
  await page.getByRole("button", { name: "Enter portal" }).click();
  await page.waitForURL("**/admin");

  // The console says the verdict without being opened, because a health page
  // nobody looks at while things are fine is one first opened mid-incident.
  await expect(page.getByRole("link", { name: /System health/ })).toBeVisible();
  await page.getByRole("link", { name: /System health/ }).click();
  await page.waitForURL("**/admin/health");

  await expect(page.getByRole("heading", { name: "System health" })).toBeVisible();
  for (const check of ["data", "schema", "notifications", "sign-on", "uploads"]) {
    await expect(page.getByText(check, { exact: true })).toBeVisible();
  }

  // The rule the whole module is written around, checked on the rendered page
  // rather than only in a unit test.
  const rendered = await page.locator("main").innerText();
  for (const person of ["Omar", "Priya", "Jordan", "Dana Reyes", "Ellen Vance"]) {
    expect(rendered).not.toContain(person);
  }
});
