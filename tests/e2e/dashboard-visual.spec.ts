import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { signInAsAdmin } from "./_helpers";

/** Pixel-diff visual regression baseline for the dashboard, per #42.
 *
 * Distinct from `screenshots.spec.ts` (which overwrites README PNGs
 * unconditionally). This spec asserts each capture matches a
 * committed baseline within a fuzzy pixel-ratio tolerance — a
 * failure means the rendered dashboard drifted from the baseline,
 * which is either an intentional UI change (re-run with
 * `--update-snapshots` to bless the new look) or a regression.
 *
 * Stability strategy:
 *   - **Fresh DB + autoseed-only** (no showcase investments). The
 *     autoseeded sample dataset is fully deterministic (fixed
 *     transactions/categories/schedules). Showcase investments
 *     would inject Yahoo-priced stocks whose values change daily,
 *     causing the entire Net Worth headline + Net Worth Trend
 *     line to drift run-to-run.
 *   - **`github-stats` widget masked.** That widget pings the
 *     GitHub API for live download / star counts; values change
 *     hourly. Masking paints the region a solid colour before the
 *     pixel diff so the rest of the dashboard is still compared.
 *   - **Charts-drawn + grid-settled waits.** Same protocol as
 *     `screenshots.spec.ts` — networkidle alone races Recharts
 *     animation and RGL widget arrangement.
 *   - **`maxDiffPixelRatio: 0.01`.** Tolerates anti-aliasing /
 *     sub-pixel font hinting jitter while catching real regressions
 *     (a missing widget, a flipped colour, mis-laid grid).
 *
 * Baselines live in `tests/e2e/dashboard-visual.spec.ts-snapshots/`
 * (Playwright's default location). First run generates them via
 * `pnpm test:e2e tests/e2e/dashboard-visual.spec.ts --update-snapshots`;
 * subsequent CI / local runs compare and fail on drift.
 *
 * Usage:
 *   pnpm test:e2e tests/e2e/dashboard-visual.spec.ts
 *   pnpm test:e2e tests/e2e/dashboard-visual.spec.ts --update-snapshots
 */

const VIEWPORT = { width: 1349, height: 800 };
const DEVICE_SCALE = 2;

const THEMES = ["light", "dark"] as const;

test.use({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE });
test.describe.configure({ mode: "serial" });

test.describe("dashboard visual regression (#42)", () => {
  test.beforeAll(async ({ browser }) => {
    // Warm the login + autoseed exactly once so the per-theme tests
    // don't each re-pay that cost. Mirrors screenshots.spec.ts's
    // beforeAll shape; intentionally omits seedShowcaseInvestments
    // to keep the dataset deterministic.
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE,
    });
    const page = await ctx.newPage();
    try {
      await signInAsAdmin(page);
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  for (const theme of THEMES) {
    test(`dashboard (${theme})`, async ({ page, context }) => {
      test.setTimeout(120_000);
      await setTheme(context, theme);
      await signInAsAdmin(page);
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await waitForChartsDrawn(page);
      await waitForGridSettled(page);
      await page.waitForTimeout(500);

      await expect(page).toHaveScreenshot(`dashboard-${theme}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.01,
        // Mask widgets backed by upstream APIs whose values change
        // run-to-run. github-stats hits api.github.com for live
        // download / star counts; masking it (Playwright paints
        // a solid colour over the locator's bounding box) keeps
        // the rest of the dashboard in the diff.
        mask: [page.locator('[data-widget-id="github-stats"]')],
      });
    });
  }
});

async function setTheme(
  context: BrowserContext,
  theme: "light" | "dark",
): Promise<void> {
  const existing = await context.cookies();
  const filtered = existing.filter((c) => c.name !== "theme");
  await context.clearCookies();
  if (filtered.length > 0) await context.addCookies(filtered);
  await context.addCookies([
    {
      name: "theme",
      value: theme,
      url: "http://0.0.0.0:3003",
      sameSite: "Lax",
    },
  ]);
}

async function waitForChartsDrawn(page: Page): Promise<void> {
  if ((await page.locator(".recharts-surface").count()) === 0) return;
  try {
    await page.waitForFunction(
      () => {
        const shapes = Array.from(
          document.querySelectorAll<SVGPathElement | SVGRectElement>(
            ".recharts-line-curve, .recharts-area-area, .recharts-bar-rectangle, .recharts-sankey-link",
          ),
        );
        if (shapes.length === 0) return false;
        return shapes.every((s) => {
          if (s instanceof SVGPathElement) {
            const d = s.getAttribute("d") ?? "";
            return d.length > 20;
          }
          const w = Number(s.getAttribute("width") ?? "0");
          return w > 0;
        });
      },
      undefined,
      { timeout: 10_000 },
    );
  } catch (err) {
    // Issue #78: was silently swallowing the timeout — a chart that
    // never drew let the visual diff proceed against a half-rendered
    // page, and the maxDiffPixelRatio threshold could let the
    // regression slip through. Now fail loudly. The whole purpose
    // of this wait is "I refuse to screenshot mid-animation".
    throw new Error(
      `waitForChartsDrawn timed out after 10s — chart never reached drawn state. Original: ${(err as Error).message}`,
    );
  }
}

async function waitForGridSettled(page: Page): Promise<void> {
  if ((await page.locator(".react-grid-layout").count()) === 0) return;
  try {
    await page.waitForFunction(
      () => {
        const items = Array.from(
          document.querySelectorAll<HTMLElement>(".react-grid-item"),
        );
        if (items.length === 0) return false;
        return (
          !document.querySelector(".react-grid-placeholder") &&
          items.every((it) => /translate\(/.test(it.style.transform || ""))
        );
      },
      undefined,
      { timeout: 10_000 },
    );
  } catch (err) {
    // Issue #78: see waitForChartsDrawn — same rationale.
    throw new Error(
      `waitForGridSettled timed out after 10s — RGL never settled. Original: ${(err as Error).message}`,
    );
  }
}
