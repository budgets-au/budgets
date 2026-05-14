import { test } from "@playwright/test";
import {
  assertNoReactErrors,
  captureErrors,
  signInAsAdmin,
} from "./_helpers";

/** Smoke-load each top-level page after auth. The bar is low:
 *   - 2xx response
 *   - no Minified React error / "Maximum update depth"
 *   - no unhandled page error
 * Catches the easy regressions — a missing import, a render-time
 * crash, an infinite loop — before the operator does. Add data-
 * driven assertions in dedicated specs (see dashboard-widgets.spec
 * for the pattern).
 *
 * Pages that need data to render meaningfully (e.g. investment
 * detail, transaction edit) are left for follow-up specs that seed
 * the relevant fixtures first. */
const PAGES: ReadonlyArray<{ path: string; label: string }> = [
  { path: "/dashboard", label: "Dashboard" },
  { path: "/transactions", label: "Transactions" },
  { path: "/scheduled", label: "Scheduled" },
  { path: "/calendar", label: "Calendar" },
  { path: "/investments", label: "Investments" },
  { path: "/superannuation", label: "Superannuation" },
  { path: "/reports", label: "Reports" },
  { path: "/categories", label: "Categories" },
  { path: "/accounts/new", label: "New account form" },
  { path: "/import", label: "Import" },
  { path: "/settings", label: "Settings" },
  { path: "/rekey", label: "Rekey passphrase" },
];

test.describe("top-level pages smoke", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  for (const p of PAGES) {
    test(`${p.label} (${p.path}) renders without crashing`, async ({ page }) => {
      const { consoleErrors, pageErrors } = captureErrors(page);
      const res = await page.goto(p.path);
      if (res) {
        // 2xx or 3xx — anything sub-400 means the page rendered.
        // Some routes 307 to a sub-page (e.g. /reports → /reports/cashflow).
        if (res.status() >= 400) {
          throw new Error(`${p.path} → HTTP ${res.status()}`);
        }
      }
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
      assertNoReactErrors(consoleErrors, pageErrors);
    });
  }
});
