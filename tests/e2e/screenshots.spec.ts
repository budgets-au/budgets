import { test, type Page, type BrowserContext } from "@playwright/test";
import { resolve } from "node:path";
import { signInAsAdmin } from "./_helpers";

/** Refreshes every PNG referenced by the project README. Runs
 * against the e2e dev server (port 3003 with a fresh SQLCipher
 * DB), which auto-seeds the sample-data set on first unlock — see
 * src/db/index.ts `seedSampleDataIfMissing`. We additionally seed
 * a couple of investment / super / paper-trade rows here since
 * the sample-data builder doesn't cover those tables yet.
 *
 * Output lands directly in `screenshots/` at the repo root.
 *
 * Usage:
 *   pnpm test:e2e tests/e2e/screenshots.spec.ts
 *
 * Captures both light and dark variants of each page; the names
 * match what the README already references so the doc and the
 * regenerated artifacts stay in sync. */

const SHOTS_DIR = resolve(process.cwd(), "screenshots");

const PAGES: ReadonlyArray<{
  path: string;
  name: string;
  themes?: ReadonlyArray<"light" | "dark">;
  /** Optional extra settle time once the page reports networkidle —
   * pages with Recharts / RGL render after a beat. */
  settleMs?: number;
}> = [
  { path: "/dashboard", name: "dashboard", themes: ["light"], settleMs: 1500 },
  { path: "/transactions", name: "transactions", themes: ["light", "dark"], settleMs: 600 },
  { path: "/scheduled", name: "scheduled", themes: ["light", "dark"], settleMs: 1200 },
  { path: "/calendar", name: "calendar", themes: ["light"], settleMs: 800 },
  { path: "/reports?tab=cashflow", name: "reports-cashflow", themes: ["light", "dark"], settleMs: 1500 },
  { path: "/reports?tab=sankey", name: "reports-sankey", themes: ["light"], settleMs: 1500 },
  { path: "/reports?tab=envelope", name: "reports-envelope", themes: ["light"], settleMs: 1500 },
  { path: "/reports?tab=tax-deductions", name: "reports-tax-deductions", themes: ["light"], settleMs: 1500 },
  { path: "/investments", name: "investments", themes: ["light"], settleMs: 800 },
  { path: "/superannuation", name: "super", themes: ["light"], settleMs: 800 },
  { path: "/settings?tab=backups", name: "settings-backups", themes: ["dark"], settleMs: 600 },
  { path: "/settings?tab=security", name: "settings-security", themes: ["dark"], settleMs: 600 },
];

test.describe.configure({ mode: "serial" });

test.describe("screenshot regeneration", () => {
  test.beforeAll(async ({ browser }) => {
    // Seed a handful of investments / super / paper-trade rows so
    // those pages have something interesting to render — the
    // default sample-data builder doesn't touch those tables.
    const page = await browser.newPage();
    try {
      await signInAsAdmin(page);
      await seedShowcaseInvestments(page.context());
    } finally {
      await page.close();
    }
  });

  for (const cfg of PAGES) {
    for (const theme of cfg.themes ?? ["light"]) {
      test(`${cfg.name} (${theme})`, async ({ page }) => {
        test.setTimeout(120_000);
        await signInAsAdmin(page);
        await setTheme(page, theme);
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

/** next-themes stores the active theme in localStorage and toggles
 * a class on <html>. Setting the storage key before navigating
 * (and a hard reload after) gets the right class applied before
 * any component mounts. */
async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.goto("/dashboard"); // any authed page to attach localStorage
  await page.evaluate((t) => {
    localStorage.setItem("theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);
}

async function seedShowcaseInvestments(
  context: BrowserContext,
): Promise<void> {
  // Idempotent-ish: if these already exist, the POSTs will 400 on
  // uniqueness and we swallow.
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
  // A paper-trade what-if.
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
  // Watchlist entry.
  await context.request
    .post("/api/watchlist", {
      data: { symbol: "WBC", exchange: "ASX", currency: "AUD" },
    })
    .catch(() => {});
  // Two super snapshots (self, partner) spanning two FYs so the
  // YoY column renders something other than a dash.
  for (const snap of [
    { person: "self",    fyEndYear: 2025, balance: "182400.00", fundName: "AustralianSuper" },
    { person: "self",    fyEndYear: 2026, balance: "199870.00", fundName: "AustralianSuper" },
    { person: "partner", fyEndYear: 2025, balance: "118250.00", fundName: "Hostplus" },
    { person: "partner", fyEndYear: 2026, balance: "129480.00", fundName: "Hostplus" },
  ]) {
    await context.request.post("/api/super", { data: snap }).catch(() => {});
  }
}
