import { test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { signInAsAdmin } from "./_helpers";

/** Capture each report tab's print-media render so the 0.173 print
 *  overhaul can be eyeballed. Distinct from `screenshots.spec.ts`
 *  (which feeds the README); this one drops into the spec dir as a
 *  one-shot debug tool — outputs land under
 *  `tests/e2e/.data/print-shots/` which the global teardown leaves
 *  alone.
 *
 *  We don't try to drive `window.print()`; that pops a system
 *  dialog Playwright can't see past. Instead we use
 *  `page.emulateMedia({ media: 'print' })` so @media print rules
 *  resolve, then take a full-page screenshot at the dimensions of
 *  an A4 page (portrait + landscape variants).
 *
 *  Reports use a server-side `viewport-print-width` CSS var to
 *  decide how wide the layout should be. We set the viewport
 *  directly via `setViewportSize` per-shot to mimic each paper
 *  orientation. */

const SHOTS_DIR = resolve(process.cwd(), "tests/e2e/.data/print-shots");

// A4 at 96dpi:
//   portrait  ≈  794 × 1123
//   landscape ≈ 1123 × 794
const PORTRAIT = { width: 794, height: 1123 };
const LANDSCAPE = { width: 1123, height: 794 };

interface PrintShot {
  path: string;
  name: string;
  orientation: "portrait" | "landscape";
  settleMs?: number;
}

const SHOTS: ReadonlyArray<PrintShot> = [
  // Wide reports → landscape paper.
  { path: "/reports", name: "cashflow", orientation: "landscape", settleMs: 1500 },
  { path: "/reports?tab=accounts", name: "accounts", orientation: "landscape", settleMs: 1500 },
  { path: "/reports?tab=yoy", name: "yoy", orientation: "landscape", settleMs: 1500 },
  // Narrow reports → portrait.
  { path: "/reports?tab=category", name: "category", orientation: "portrait", settleMs: 1500 },
  { path: "/reports?tab=monthly", name: "monthly", orientation: "portrait", settleMs: 1500 },
  { path: "/reports?tab=envelope", name: "envelope", orientation: "portrait", settleMs: 1500 },
  { path: "/reports?tab=expenses", name: "expenses-drilldown", orientation: "portrait", settleMs: 1500 },
  { path: "/reports?tab=sankey", name: "sankey", orientation: "landscape", settleMs: 1500 },
  { path: "/reports?tab=treemap", name: "treemap", orientation: "portrait", settleMs: 1500 },
  { path: "/reports?tab=heatmap", name: "heatmap", orientation: "landscape", settleMs: 1500 },
  { path: "/reports?tab=scatter", name: "scatter", orientation: "landscape", settleMs: 1500 },
  { path: "/reports?tab=payees", name: "payees", orientation: "portrait", settleMs: 1500 },
  { path: "/reports?tab=tax", name: "tax", orientation: "portrait", settleMs: 1500 },
  { path: "/reports?tab=flow", name: "flow", orientation: "landscape", settleMs: 1500 },
];

test.describe.configure({ mode: "serial" });

test.describe("print-media report shots", () => {
  for (const cfg of SHOTS) {
    test(`print: ${cfg.name} (${cfg.orientation})`, async ({ page }) => {
      test.setTimeout(120_000);
      const size = cfg.orientation === "portrait" ? PORTRAIT : LANDSCAPE;
      await page.setViewportSize(size);
      await signInAsAdmin(page);
      await page.goto(cfg.path);
      await page.waitForLoadState("networkidle");
      if (cfg.settleMs) {
        await page.waitForTimeout(cfg.settleMs);
      }
      // Switch to print media so @media print rules apply before
      // the snapshot.
      await page.emulateMedia({ media: "print" });
      // The print stylesheet repaints; settle briefly so the next
      // screenshot catches the print-mode layout, not the screen
      // one being torn down.
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${SHOTS_DIR}/${cfg.name}-${cfg.orientation}.png`,
        fullPage: true,
      });
    });
  }
});

// Silence the unused-imports lint when this file is in an editor
// without TS server hints — Page is consumed via the test handler.
void undefined as unknown as Page;
