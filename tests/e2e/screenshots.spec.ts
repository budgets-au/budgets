import { test, type Page, type BrowserContext } from "@playwright/test";
import { resolve } from "node:path";
import { signInAsAdmin } from "./_helpers";
import { currentFyEndYear, fyDateRange } from "@/lib/tax/fy";

/** Refreshes every PNG referenced by the project README.
 *
 * Theme is stored as a server-side `theme=light|dark` cookie (see
 * `src/app/layout.tsx`), not localStorage — so we set it via
 * `context.addCookies` before each navigation. Reports + settings
 * tabs are URL-backed (`?tab=sankey` etc.), so we just navigate to
 * the right URL — no click-by-accessible-name dance.
 *
 * Sample data autoseeds on the fresh e2e DB; we add a few
 * investment / super / paper-trade rows on top via the public API
 * since the autoseed doesn't cover those tables yet.
 *
 * Capture is **viewport-only** (not fullPage) so every screenshot is
 * exactly VIEWPORT.height tall — the README lays them out as
 * uniform 3-up thumbnails, and a fullPage capture would make the
 * /transactions row (25-deep table) tower over the others.
 *
 * Wait protocol: `networkidle` + chart-drawn detection (Recharts
 * path elements have non-trivial `d` attributes) + a small fixed
 * settle for hover/focus pulses. The fixed-timer pattern alone
 * caught the dashboard mid-render — RGL grid settle and Recharts
 * animation both run after `networkidle` fires.
 *
 * Usage:
 *   pnpm test:e2e tests/e2e/screenshots.spec.ts
 */

const SHOTS_DIR = resolve(process.cwd(), "screenshots");

const VIEWPORT = { width: 1349, height: 800 };
const DEVICE_SCALE = 2;

interface PageCfg {
  /** URL path (including query string) to navigate to. */
  path: string;
  /** File-name stem; `${name}-${theme}.png` is what lands in screenshots/. */
  name: string;
  /** Trailing fixed settle (after charts-drawn + networkidle). Keep small —
   *  for hover/focus pulses, not the primary done-signal. */
  settleMs?: number;
}

const THEMES = ["light", "dark"] as const;

const PAGES: ReadonlyArray<PageCfg> = [
  { path: "/dashboard", name: "dashboard", settleMs: 500 },
  { path: "/transactions", name: "transactions", settleMs: 300 },
  { path: "/calendar", name: "calendar", settleMs: 500 },
  { path: "/reports", name: "reports-cashflow", settleMs: 500 },
  { path: "/reports?tab=sankey", name: "reports-sankey", settleMs: 500 },
  { path: "/scheduled", name: "scheduled", settleMs: 300 },
];

test.use({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE });
test.describe.configure({ mode: "serial" });

test.describe("screenshot regeneration", () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE,
    });
    const page = await ctx.newPage();
    try {
      await signInAsAdmin(page);
      await seedShowcaseInvestments(ctx);
      await setCashflowRangeToFy(ctx);
    } finally {
      await page.close();
      await ctx.close();
    }
  });

  for (const cfg of PAGES) {
    for (const theme of THEMES) {
      test(`${cfg.name} (${theme})`, async ({ page, context }) => {
        test.setTimeout(120_000);
        await setTheme(context, theme);
        await signInAsAdmin(page);
        await page.goto(cfg.path);
        await page.waitForLoadState("networkidle");
        await waitForChartsDrawn(page);
        await waitForGridSettled(page);
        if (cfg.settleMs) {
          await page.waitForTimeout(cfg.settleMs);
        }
        await page.screenshot({
          path: `${SHOTS_DIR}/${cfg.name}-${theme}.png`,
          fullPage: false,
        });
      });
    }
  }
});

/** Block until every mounted Recharts chart has finished drawing its
 *  primary shapes. The default Recharts `isAnimationActive: true`
 *  animates path `d` attributes from a zero-bbox placeholder up to
 *  the final geometry — the SVG surface mounts immediately on data
 *  arrival, so `networkidle` + a short timer races the animation. */
async function waitForChartsDrawn(page: Page): Promise<void> {
  if ((await page.locator(".recharts-surface").count()) === 0) return;
  await page
    .waitForFunction(
      () => {
        const shapes = Array.from(
          document.querySelectorAll<SVGPathElement | SVGRectElement>(
            ".recharts-line-curve, .recharts-area-area, .recharts-bar-rectangle, .recharts-sankey-link",
          ),
        );
        if (shapes.length === 0) return false; // surface up but shapes not mounted yet
        return shapes.every((s) => {
          if (s instanceof SVGPathElement) {
            const d = s.getAttribute("d") ?? "";
            // Mid-animation Recharts emits very short `d` strings
            // (`M0,0`-style). Real paths are 50+ characters.
            return d.length > 20;
          }
          // SVGRectElement (bar) — width > 0 means drawn.
          const w = Number(s.getAttribute("width") ?? "0");
          return w > 0;
        });
      },
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => {});
}

/** Block until react-grid-layout has settled its widget transforms.
 *  RGL adds `.react-grid-placeholder` during drag/init and animates
 *  `transform: translate(...)` on each widget — capturing mid-settle
 *  catches widgets in non-final positions. */
async function waitForGridSettled(page: Page): Promise<void> {
  if ((await page.locator(".react-grid-layout").count()) === 0) return;
  await page
    .waitForFunction(
      () => {
        const items = Array.from(
          document.querySelectorAll<HTMLElement>(".react-grid-item"),
        );
        if (items.length === 0) return false;
        // No placeholders, and every item has a concrete transform
        // (RGL pre-mount items have no inline transform).
        return (
          !document.querySelector(".react-grid-placeholder") &&
          items.every((it) => /translate\(/.test(it.style.transform || ""))
        );
      },
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => {});
}

/** Theme is server-driven: layout.tsx reads the `theme` cookie and
 * renders `<html class="dark">` on the SSR pass. Set the cookie at
 * the context level so it persists across the whole test's
 * navigations. */
async function setTheme(
  context: BrowserContext,
  theme: "light" | "dark",
): Promise<void> {
  // Clear any prior theme cookie so the toggle isn't a no-op on
  // serial-test runs where the previous test left it set.
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

/** Pre-seed the Cashflow tab's date range to the current Australian
 *  financial year (1 Jul → 30 Jun) so the screenshot captures a full
 *  year of data rather than the default single-month "this month"
 *  window. /reports persists per-tab from/to in displayPrefs and
 *  reads it on mount; setting it via the API before navigation skips
 *  the click-the-quick-range dance. */
async function setCashflowRangeToFy(context: BrowserContext): Promise<void> {
  const { from, to } = fyDateRange(currentFyEndYear());
  await context.request
    .patch("/api/display-prefs", {
      data: {
        reportsPeriodByTab: { cashflow: { from, to } },
      },
    })
    .catch(() => {});
}

async function seedShowcaseInvestments(
  context: BrowserContext,
): Promise<void> {
  const stocks = [
    { symbol: "CBA", exchange: "ASX", currency: "AUD", quantity: "120", purchasePrice: "98.50", purchaseDate: "2023-08-12" },
    { symbol: "BHP", exchange: "ASX", currency: "AUD", quantity: "300", purchasePrice: "44.20", purchaseDate: "2024-02-04" },
    { symbol: "VTS", exchange: "ASX", currency: "AUD", quantity: "85",  purchasePrice: "310.40", purchaseDate: "2024-06-18" },
  ];
  for (const s of stocks) {
    await context.request
      .post("/api/investments", {
        data: { kind: "stock", name: null, ...s },
      })
      .catch(() => {});
  }
  await context.request
    .post("/api/investments", {
      data: {
        kind: "paper",
        symbol: "TSLA",
        exchange: "US",
        currency: "USD",
        quantity: "20",
        purchaseDate: "2025-01-10",
        purchasePrice: "240.00",
      },
    })
    .catch(() => {});
  await context.request
    .post("/api/watchlist", {
      data: { symbol: "WBC", exchange: "ASX", currency: "AUD" },
    })
    .catch(() => {});
  for (const snap of [
    { person: "self",    fyEndYear: 2025, balance: "182400.00", fundName: "AustralianSuper" },
    { person: "self",    fyEndYear: 2026, balance: "199870.00", fundName: "AustralianSuper" },
    { person: "partner", fyEndYear: 2025, balance: "118250.00", fundName: "Hostplus" },
    { person: "partner", fyEndYear: 2026, balance: "129480.00", fundName: "Hostplus" },
  ]) {
    await context.request.post("/api/super", { data: snap }).catch(() => {});
  }
}
