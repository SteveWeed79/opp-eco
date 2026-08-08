import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration.
 *
 * These tests run against a **production build**, not the dev server, because
 * several of the things they check differ between the two — the CSP drops
 * `unsafe-eval` in production, and HSTS is only set there. Testing the dev
 * server would verify a configuration nobody deploys.
 */
export default defineConfig({
  testDir: "./e2e",
  // Single worker: the demo mutates shared in-memory state, so parallel
  // workers booking the same interview slot would race each other rather than
  // test anything. The suite is small enough that this costs seconds.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // No retries, deliberately. The demo store is process-global and these
  // tests mutate it, so a retry runs against a world the first attempt
  // already changed — it would turn a genuine regression green on the second
  // pass and a state-dependent test red for the wrong reason. There is no
  // network here to be flaky; a failure is a failure.
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: "http://localhost:3000",
    // Artifacts only for failures — a green run should be quiet.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The sandbox and CI both provide a browser rather than downloading
        // one; PLAYWRIGHT_BROWSERS_PATH points Playwright at it.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : {},
      },
    },
  ],

  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
