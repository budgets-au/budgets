import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  assertNoReactErrors,
  captureErrors,
  resetDisplayPrefs,
  setDashboardLayout,
  signInAsAdmin,
} from "./_helpers";

/** Issue #31: no spec drags a corner-resize handle. This pins that
 *  a SE-handle drag (a) persists the new w/h to display-prefs and
 *  survives a reload, and (b) honours the widget's `minSize.w` —
 *  react-grid-layout clamps the resize at minW so a shrink past it
 *  can't persist a too-small tile.
 *
 *  Split from `dashboard-edit.spec.ts` (drag-from-drawer) on
 *  purpose: those drag tests have their own RGL placeholder-commit
 *  flake, and the asserts here are about geometry persistence
 *  specifically — coupling their CI fates would muddy both.
 *
 *  `recent-transactions` is the test widget: it's not a chart
 *  (charts swap to a "hidden while editing" placeholder per
 *  AGENTS.md, so resizing them mid-edit is a different path), it
 *  has room to grow from its w6/h4 default, and a real
 *  `minSize: { w: 3, h: 2 }` to clamp against. */

const WIDGET = "recent-transactions";

interface LayoutEntry {
  widgetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Read the persisted dashboard layout back from display-prefs. */
async function savedLayout(page: Page): Promise<LayoutEntry[]> {
  const res = await page.context().request.get("/api/display-prefs");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    dashboardLayout?: LayoutEntry[];
  };
  return body.dashboardLayout ?? [];
}

/** Real mouse drag of `handle` by (dx, dy) — RGL's resize commit
 *  listens to the mousemove storm, so we step through intermediate
 *  positions rather than a single jump (same reason
 *  dashboard-edit.spec.ts hand-rolls its drag). */
async function dragHandleBy(
  page: Page,
  handle: Locator,
  dx: number,
  dy: number,
): Promise<void> {
  const box = await handle.boundingBox();
  if (!box) throw new Error("resize handle has no bounding box");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    const t = i / 20;
    await page.mouse.move(startX + dx * t, startY + dy * t, { steps: 1 });
  }
  await page.mouse.up();
}

async function enterEditMode(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Edit dashboard/i }).click();
  // The SE handle only mounts once isResizable flips on (edit mode).
  await page
    .locator(`[data-widget-id="${WIDGET}"] .react-resizable-handle-se`)
    .first()
    .waitFor({ state: "visible", timeout: 5_000 });
}

async function saveLayout(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Save layout/i }).click();
  // A save whose layout is unchanged from the persisted value
  // (e.g. a resize RGL fully clamped back to the original size)
  // fires NO PATCH — `setPref` skips the write when the value is
  // identical. Race the PATCH against a short settle window rather
  // than requiring it; the caller reads the persisted layout
  // afterwards either way.
  await Promise.race([
    page
      .waitForResponse(
        (r) =>
          r.url().includes("/api/display-prefs") &&
          r.request().method() === "PATCH",
        { timeout: 4_000 },
      )
      .catch(() => {}),
    page.waitForTimeout(2_000),
  ]);
}

test.describe("dashboard widget resize (issue #31)", () => {
  test.beforeEach(async ({ page, context }) => {
    await signInAsAdmin(page);
    await resetDisplayPrefs(context);
  });

  test("SE-handle grow persists larger w/h and survives reload", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { consoleErrors, pageErrors } = captureErrors(page);

    await setDashboardLayout(context, [
      { widgetId: WIDGET, x: 0, y: 0, w: 6, h: 4 },
    ]);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    const tile = page.locator(`[data-widget-id="${WIDGET}"]`);
    await tile.waitFor({ state: "visible" });

    await enterEditMode(page);

    // Measure the tile to derive a per-cell pixel size, then drag
    // the SE handle right by ~2 cols + down by ~1 row. We assert on
    // DIRECTION (grew), not exact magnitude — RGL snaps to its grid
    // and the container width varies with the viewport, so pinning
    // exact w/h would be brittle.
    const tileBox = await tile.boundingBox();
    if (!tileBox) throw new Error("tile has no bounding box");
    const handle = tile.locator(".react-resizable-handle-se").first();
    await dragHandleBy(
      page,
      handle,
      Math.round((tileBox.width / 6) * 2), // ≈ +2 columns
      Math.round((tileBox.height / 4) * 1), // ≈ +1 row
    );

    await saveLayout(page);

    const after = await savedLayout(page);
    const entry = after.find((e) => e.widgetId === WIDGET);
    expect(entry, "widget still in saved layout after resize").toBeTruthy();
    expect(entry!.w).toBeGreaterThan(6);
    expect(entry!.h).toBeGreaterThan(4);

    // Survives a reload — the grid renders from the persisted prefs.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .locator(`[data-widget-id="${WIDGET}"]`)
      .waitFor({ state: "visible" });

    assertNoReactErrors(consoleErrors, pageErrors);
  });

  test("shrink past minSize.w is clamped to minW (≥ 3)", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { consoleErrors, pageErrors } = captureErrors(page);

    await setDashboardLayout(context, [
      { widgetId: WIDGET, x: 0, y: 0, w: 6, h: 4 },
    ]);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    const tile = page.locator(`[data-widget-id="${WIDGET}"]`);
    await tile.waitFor({ state: "visible" });

    await enterEditMode(page);

    // Drag the SE handle hard LEFT (and a little up) — far enough to
    // push w well below the minSize.w of 3 if RGL didn't clamp.
    const tileBox = await tile.boundingBox();
    if (!tileBox) throw new Error("tile has no bounding box");
    const handle = tile.locator(".react-resizable-handle-se").first();
    await dragHandleBy(
      page,
      handle,
      -Math.round((tileBox.width / 6) * 5), // try to shrink ~5 cols (6→1)
      -Math.round((tileBox.height / 4) * 2),
    );

    await saveLayout(page);

    const after = await savedLayout(page);
    const entry = after.find((e) => e.widgetId === WIDGET);
    expect(entry, "widget still in saved layout").toBeTruthy();
    // RGL enforces minW — the persisted width must never drop below 3.
    expect(entry!.w).toBeGreaterThanOrEqual(3);

    assertNoReactErrors(consoleErrors, pageErrors);
  });
});
