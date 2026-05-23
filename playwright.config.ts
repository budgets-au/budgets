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
    // `next build && next start` is the normal e2e mode — production
    // bundle, closest to what we actually ship.
    //
    // When COLLECT_COVERAGE=1 we switch to `next dev` because Turbopack
    // production builds in Next 16 emit empty `.js.map` files
    // (`sources:[]`, `sections:[]`) regardless of the
    // `productionBrowserSourceMaps` / `experimental.serverSourceMaps`
    // flags — c8 / v8-to-istanbul then have nothing to map back to
    // `src/**`. Dev mode emits real source maps, so the V8 dumps the
    // Playwright run produces translate cleanly. Dev mode is slower
    // first-load but fast enough for the e2e suite, and the
    // distinct `.next-e2e/` distDir keeps it from fighting the live
    // dev server on :3002.
    command:
      process.env.COLLECT_COVERAGE === "1"
        ? `next dev -H 0.0.0.0 -p ${E2E_PORT}`
        : `next build && next start -H 0.0.0.0 -p ${E2E_PORT}`,
    url: `http://0.0.0.0:${E2E_PORT}/api/auth/csrf`,
    timeout: 600_000,
    // Reuse a hot server when iterating locally; force a fresh
    // boot when collecting coverage so NODE_V8_COVERAGE actually
    // takes effect (env vars don't propagate into an already-
    // running process).
    reuseExistingServer:
      !process.env.CI && process.env.COLLECT_COVERAGE !== "1",
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
      // V8 coverage capture for the Next.js Node process. Active only
      // when the wrapper script sets COLLECT_COVERAGE=1 — keeps the
      // normal `pnpm test:e2e` run zero-overhead. Raw `coverage-*.json`
      // dumps land in `.coverage/raw/`; `c8 report` reads them and
      // merges with the vitest unit-test coverage that drops to the
      // same directory.
      ...(process.env.COLLECT_COVERAGE === "1"
        ? {
            NODE_V8_COVERAGE: ".coverage/e2e/raw",
            // Forward to the child shell so `next build` sees it and
            // enables `productionBrowserSourceMaps` +
            // `experimental.serverSourceMaps` in next.config.ts.
            COLLECT_COVERAGE: "1",
          }
        : {}),
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
