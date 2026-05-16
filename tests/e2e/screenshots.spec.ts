import { test, type Page, type BrowserContext } from "@playwright/test";
import { resolve } from "node:path";
import { signInAsAdmin } from "./_helpers";

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
 * Capture resolution matches the prior in-repo screenshots
 * (≈ 2700 × 1400 at 2× DPR for retina-quality assets).
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
  /** Extra wait after networkidle (Recharts / RGL mount on a delay). */
  settleMs?: number;
}

const THEMES = ["light", "dark"] as const;

const PAGES: ReadonlyArray<PageCfg> = [
  { path: "/dashboard", name: "dashboard", settleMs: 2000 },
  { path: "/transactions", name: "transactions", settleMs: 800 },
  { path: "/scheduled", name: "scheduled", settleMs: 1500 },
  { path: "/calendar", name: "calendar", settleMs: 1200 },
  { path: "/reports", name: "reports-cashflow", settleMs: 1500 },
  { path: "/reports?tab=sankey", name: "reports-sankey", settleMs: 1500 },
  { path: "/reports?tab=envelope", name: "reports-envelope", settleMs: 1500 },
  { path: "/reports?tab=accounts", name: "reports-accounts", settleMs: 1500 },
  { path: "/reports?tab=tax", name: "reports-tax-deductions", settleMs: 1500 },
  { path: "/investments", name: "investments", settleMs: 1000 },
  { path: "/superannuation", name: "super", settleMs: 1000 },
  { path: "/settings?tab=backups", name: "settings-backups", settleMs: 600 },
  { path: "/settings?tab=security", name: "settings-security", settleMs: 600 },
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
        if (cfg.settleMs) {
          await page.waitForTimeout(cfg.settleMs);
        }
        await page.screenshot({
          path: `${SHOTS_DIR}/${cfg.name}-${theme}.png`,
          fullPage: true,
        });
      });
    }
  }
});

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
