import { defineConfig, devices } from "@playwright/test";

/** Playwright config — runs the Golden Book E2E tier.
 *
 * Spins up a dedicated test Next.js dev server on port 3003 with a
 * fresh SQLCipher DB at `./tests/e2e/.data/test.db`. The dev server
 * is configured via env to point at that DB, so the live dev DB at
 * `/data/budget.db` is untouched.
 *
 * globalSetup applies migrations to the fresh DB before tests run.
 *
 * Headless chromium only — matrix browsers don't help debug a React
 * render-loop.
 *
 * `bail: 1` because the first failure tends to be the diagnostic.
 * The rest is the same component crashing repeatedly. */
const E2E_PORT = 3003;
const E2E_SQLITE_PATH =
  process.env.E2E_SQLITE_PATH ?? "./tests/e2e/.data/test.db";
const E2E_SQLITE_KEY =
  process.env.E2E_SQLITE_KEY ??
  "0000000000000000000000000000000000000000000000000000000000000000";

export default defineConfig({
  testDir: "./tests/e2e",
  // Restrict to .spec.ts so pure-logic helper tests under
  // tests/e2e/_*.test.ts (run by Vitest) aren't picked up by
  // Playwright too.
  testMatch: /\.spec\.ts$/,
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://0.0.0.0:${E2E_PORT}`,
    trace: "retain-on-failure",
  },
  // `next dev` refuses to run two instances against the same .next
  // dir (the live one on port 3002 holds the lock). Use a separate
  // build artifact under `.next-e2e/` so the two servers coexist.
  // `next start` is the production runtime — closer to what we
  // actually ship anyway.
  // `next dev` refuses to run a second instance against the same
  // `.next` dir, so use a production build under `.next-e2e/` (via
  // E2E_TEST_BUILD in next.config.ts) and `next start`. The live
  // dev server on :3002 is untouched.
  webServer: {
    command: `next build && next start -H 0.0.0.0 -p ${E2E_PORT}`,
    url: `http://0.0.0.0:${E2E_PORT}/api/auth/csrf`,
    timeout: 600_000,
    reuseExistingServer: !process.env.CI,
    env: {
      E2E_TEST_BUILD: "1",
      SQLITE_PATH: E2E_SQLITE_PATH,
      SQLITE_KEY: E2E_SQLITE_KEY,
      AUTH_SECRET:
        process.env.AUTH_SECRET ??
        "0000000000000000000000000000000000000000000000000000000000000000",
      NEXTAUTH_SECRET:
        process.env.NEXTAUTH_SECRET ??
        "0000000000000000000000000000000000000000000000000000000000000000",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
