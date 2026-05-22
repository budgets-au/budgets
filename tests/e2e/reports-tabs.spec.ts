import { test, expect, type Response } from "@playwright/test";
import {
  signInAsAdmin,
  captureErrors,
  assertNoReactErrors,
} from "./_helpers";

/** E2E coverage for the Reports tab walk (#39).
 *
 *  `src/components/reports/reports-view.tsx` defines REPORT_TABS
 *  — 15 tabs total. The breadth-first monkey visits `/reports`
 *  but the tabs are URL writes (`router.push`) not form
 *  submissions, so `fillAndSubmitForms` never reaches them.
 *  This spec walks each one in turn:
 *
 *   - GOTO `/reports?tab=<id>`
 *   - Wait for network-idle (gives SWR fetches + Recharts time
 *     to settle)
 *   - Assert no console / page errors
 *   - Assert no React error overlay
 *   - Assert no /api/* response in the 4xx/5xx range that the
 *     tab itself emitted (we collect responses during the
 *     visit window — if a tab's primary endpoint 500'd, the
 *     spec fails)
 *
 *  Parameterised so each tab gets its own test ID — a single
 *  bad tab fails ONLY that tab, not the whole spec, and the
 *  failure report names it precisely.
 *
 *  Out of scope per the issue: pixel-diffing the chart output
 *  (dashboard-visual.spec.ts covers visual baselines).
 *  Out of scope here too: per-tab period persistence — that's
 *  a separate behaviour. */

const REPORT_TABS = [
  "cashflow",
  "category",
  "monthly",
  "yoy",
  "expenses",
  "income",
  "envelope",
  "accounts",
  "flow",
  "sankey",
  "treemap",
  "heatmap",
  "scatter",
  "payees",
  "tax",
] as const;

test.describe("reports tabs walk (#39)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  for (const tab of REPORT_TABS) {
    test(`${tab} tab renders without crashing`, async ({ page }) => {
      test.setTimeout(45_000);
      const { consoleErrors, pageErrors } = captureErrors(page);

      // Collect any /api/* responses emitted during the visit. If
      // the tab's primary endpoint fires a 4xx/5xx the spec fails
      // with a specific error rather than the vague "console
      // wasn't empty" downstream symptom.
      const apiFailures: string[] = [];
      page.on("response", (res: Response) => {
        const url = res.url();
        if (!url.includes("/api/")) return;
        const status = res.status();
        // Skip /api/auth/* — NextAuth's session ping occasionally
        // 401s on probe; the route handles it gracefully. Same
        // story as the CONSOLE_ERROR_IGNORE for `_getSession`.
        if (url.includes("/api/auth/")) return;
        if (status >= 400) {
          apiFailures.push(`${status} ${url}`);
        }
      });

      const res = await page.goto(`/reports?tab=${tab}`);
      if (res && res.status() >= 400) {
        throw new Error(`/reports?tab=${tab} → HTTP ${res.status()}`);
      }

      await page.waitForLoadState("networkidle");
      // Recharts can paint a frame or two after networkidle;
      // 500ms is the same beat pages-smoke uses.
      await page.waitForTimeout(500);

      if (apiFailures.length > 0) {
        throw new Error(
          `${tab} tab emitted ${apiFailures.length} failing API response(s): ${apiFailures.join(", ")}`,
        );
      }
      assertNoReactErrors(consoleErrors, pageErrors);
      expect(pageErrors).toEqual([]);
    });
  }
});
