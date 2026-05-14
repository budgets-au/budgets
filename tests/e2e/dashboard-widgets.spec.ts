import { test } from "@playwright/test";
import {
  assertNoReactErrors,
  captureErrors,
  resetDisplayPrefs,
  seedStockInvestment,
  setDashboardLayout,
  signInAsAdmin,
} from "./_helpers";

/** Every widget that's adoptable from the edit-drawer. Kept in
 * sync with `src/lib/dashboard/widgets.tsx` — when adding a new
 * widget there, drop it in here so the next CI run renders it on
 * its own and catches a render-time crash before the operator
 * does. */
const ADOPTABLE_WIDGETS: ReadonlyArray<{
  id: string;
  w: number;
  h: number;
  config?: Record<string, unknown>;
}> = [
  { id: "net-worth", w: 2, h: 2 },
  { id: "tracked-stock", w: 3, h: 3 },
  { id: "income-30d", w: 2, h: 2 },
  { id: "expenses-30d", w: 2, h: 2 },
  { id: "stocks-summary", w: 2, h: 2 },
  { id: "options-summary", w: 2, h: 2 },
  { id: "paper-trade-summary", w: 2, h: 2 },
  { id: "super-summary", w: 2, h: 2 },
  { id: "net-worth-trend", w: 3, h: 2 },
  { id: "budget-progress", w: 3, h: 2 },
  { id: "upcoming-schedules", w: 6, h: 4 },
  { id: "accounts", w: 12, h: 6 },
];

test.describe("dashboard widgets render without crashing", () => {
  test.beforeEach(async ({ page, context }) => {
    await signInAsAdmin(page);
    await resetDisplayPrefs(context);
  });

  test("default layout renders cleanly", async ({ page }) => {
    const { consoleErrors, pageErrors } = captureErrors(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    // A small extra wait so SWR + Recharts ResizeObservers settle.
    await page.waitForTimeout(500);
    assertNoReactErrors(consoleErrors, pageErrors);
  });

  for (const w of ADOPTABLE_WIDGETS) {
    test(`solo: ${w.id}`, async ({ page, context }) => {
      await setDashboardLayout(context, [
        { widgetId: w.id, x: 0, y: 0, w: w.w, h: w.h, config: w.config },
      ]);
      const { consoleErrors, pageErrors } = captureErrors(page);
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
      assertNoReactErrors(consoleErrors, pageErrors);
    });
  }

  test("tracked-stock pinned to a real investment renders cleanly", async ({
    page,
    context,
  }) => {
    // The empty-state path ("Pick a stock") doesn't exercise the
    // chart code path. Seed a real position and pin the widget to
    // it so the AreaChart + Recharts ResponsiveContainer + the
    // /api/investments/[id]/history fetch all run for real.
    const id = await seedStockInvestment(context, {
      symbol: "AAPL",
      name: "Apple Inc.",
    });
    await setDashboardLayout(context, [
      {
        widgetId: "tracked-stock",
        x: 0,
        y: 0,
        w: 3,
        h: 3,
        config: { investmentId: id },
      },
    ]);
    const { consoleErrors, pageErrors } = captureErrors(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    // Yahoo fetch can take a beat; give the chart time to land.
    await page.waitForTimeout(1500);
    assertNoReactErrors(consoleErrors, pageErrors);
  });

  test("all widgets together render cleanly", async ({ page, context }) => {
    await setDashboardLayout(
      context,
      ADOPTABLE_WIDGETS.map((w, i) => ({
        widgetId: w.id,
        x: (i % 4) * 3,
        y: Math.floor(i / 4) * 3,
        w: w.w,
        h: w.h,
        config: w.config,
      })),
    );
    const { consoleErrors, pageErrors } = captureErrors(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    assertNoReactErrors(consoleErrors, pageErrors);
  });
});
