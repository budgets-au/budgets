import { test, expect } from "@playwright/test";
import {
  assertNoReactErrors,
  captureErrors,
  resetDisplayPrefs,
  setDashboardLayout,
  signInAsAdmin,
} from "./_helpers";

/** Exercises the actual operator flow that's been crashing in
 * production: click "Edit dashboard", drag a widget pill from the
 * drawer onto the grid, verify no React error.
 *
 * The other dashboard-widgets specs short-circuit the drag-and-drop
 * by PATCHing display-prefs directly — that's the cleanest way to
 * test rendering, but the drag flow itself has its own state churn
 * (RGL's `onDragOver` / `droppingItem` placeholder, my
 * `onLayoutChange` handler firing many times per second) and that's
 * what the user is repeatedly hitting. */
test.describe("dashboard edit-drawer drag-and-drop", () => {
  test.beforeEach(async ({ page, context }) => {
    await signInAsAdmin(page);
    await resetDisplayPrefs(context);
  });

  test("adding tracked-stock via drag from drawer does not crash", async ({
    page,
  }) => {
    const { consoleErrors, pageErrors } = captureErrors(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Open the edit drawer.
    await page.getByRole("button", { name: /Edit dashboard/i }).click();
    // Drawer presents pills for widgets not currently on the grid.
    // After resetDisplayPrefs, the layout is the registry default
    // (no tracked-stock), so the pill should be available.
    const pill = page.locator(".droppable-element", { hasText: "Tracked stock" });
    await expect(pill).toBeVisible({ timeout: 5_000 });

    // Drop point: anywhere inside the grid container.
    const grid = page.locator(".react-grid-layout").first();
    await expect(grid).toBeVisible();

    await pill.dragTo(grid);
    // Settle: RGL's onDrop fires, my updateWidgetConfig may fire,
    // SWR refetches kick in. Give Recharts a beat to mount and the
    // potential infinite loop a window to manifest.
    await page.waitForTimeout(1500);
    assertNoReactErrors(consoleErrors, pageErrors);
  });

  test("multi-step drag with only chart widgets pre-placed does NOT crash", async ({
    page,
    context,
  }) => {
    // Hypothesis: the loop fires when the dashboard contains a
    // recharts chart (net-worth-trend) DURING a drag — recharts 3.x
    // uses react-redux internally and its store keeps notifying
    // subscribers as the cell resizes mid-drag. Confirm by starting
    // from a layout with NO chart widgets and dragging a non-chart
    // widget in. If this stays clean, the next test (with a chart
    // already placed) is the smoking gun.
    await setDashboardLayout(context, [
      { widgetId: "net-worth", x: 0, y: 0, w: 2, h: 2 },
      { widgetId: "income-30d", x: 2, y: 0, w: 2, h: 2 },
    ]);
    const { consoleErrors, pageErrors } = captureErrors(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Edit dashboard/i }).click();
    const pill = page.locator(".droppable-element", {
      hasText: "Expenses (30 days)",
    });
    await pill.scrollIntoViewIfNeeded();
    await pill.dragTo(page.locator(".react-grid-layout").first());
    await page.waitForTimeout(1000);
    assertNoReactErrors(consoleErrors, pageErrors);
  });

  test("dropped widget lands on the grid + drawer drops the pill", async ({
    page,
  }) => {
    // Regression coverage for "drag widget, widgets-panel flashes
    // it in/out, widget doesn't actually land until Save → reload."
    // Root cause was RGL firing many onLayoutChange emissions during
    // the drag (placeholder in, placeholder out as the cursor
    // crosses the grid boundary) and my handler rewriting the layout
    // each time. Fix gated onLayoutChange while `draggedWidgetId` is
    // set so only onDrop commits the placement.
    const { consoleErrors, pageErrors } = captureErrors(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Edit dashboard/i }).click();
    const pill = page.locator(".droppable-element", {
      hasText: "Tracked stock",
    });
    await expect(pill).toBeVisible({ timeout: 5_000 });
    await pill.dragTo(page.locator(".react-grid-layout").first());
    await page.waitForTimeout(500);
    // The tracked-stock widget should now be on the grid …
    await expect(
      page.locator('.react-grid-layout [data-grid-key], .react-grid-item')
        .filter({ hasText: /Tracked stock|Pick a stock/i }),
    ).toBeVisible({ timeout: 3_000 });
    // … and the drawer pill should be gone (since the widget is
    // now placed, it's filtered out of `availableWidgets`).
    await expect(pill).toHaveCount(0);
    assertNoReactErrors(consoleErrors, pageErrors);
  });

  test("multi-step slow drag fires many drag-over events without crashing", async ({
    page,
  }) => {
    // Playwright's dragTo() is one teleport — our hypothesis was
    // the loop is fed by RGL's onDragOver firing many times per
    // drag, so we manually walk the cursor through ~20 intermediate
    // positions and let React process each. If a loop exists in the
    // drag-over path, this is the test that surfaces it.
    const { consoleErrors, pageErrors } = captureErrors(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Edit dashboard/i }).click();
    const pill = page.locator(".droppable-element", {
      hasText: "Tracked stock",
    });
    await pill.scrollIntoViewIfNeeded();
    const pillBox = await pill.boundingBox();
    const grid = page.locator(".react-grid-layout").first();
    const gridBox = await grid.boundingBox();
    if (!pillBox || !gridBox) {
      throw new Error("Could not measure pill or grid");
    }
    await page.mouse.move(
      pillBox.x + pillBox.width / 2,
      pillBox.y + pillBox.height / 2,
    );
    await page.mouse.down();
    const targetX = gridBox.x + gridBox.width / 2;
    const targetY = gridBox.y + gridBox.height / 2;
    const startX = pillBox.x + pillBox.width / 2;
    const startY = pillBox.y + pillBox.height / 2;
    for (let i = 1; i <= 20; i++) {
      const t = i / 20;
      await page.mouse.move(
        startX + (targetX - startX) * t,
        startY + (targetY - startY) * t,
        { steps: 1 },
      );
    }
    await page.mouse.up();
    await page.waitForTimeout(1500);
    assertNoReactErrors(consoleErrors, pageErrors);
  });
});
