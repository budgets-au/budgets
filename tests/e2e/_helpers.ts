import { expect, type Page, type BrowserContext } from "@playwright/test";

/** Sign in as the default admin/admin user via the NextAuth
 * credentials provider. The fresh-DB seed in `src/db/index.ts`
 * inserts this user when the users table is empty, so any test
 * environment starting from a blank DB ends up authenticatable
 * out of the box. */
export async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="username"]', "admin");
  await page.fill('input[name="password"]', "admin");
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith("/login"), {
      timeout: 15_000,
    }),
    page.click('button[type="submit"]'),
  ]);
}

/** Bind the page's console + uncaught-page-errors to two
 * accumulator arrays for later assertion. Use after every nav
 * so a runtime React error (e.g. #185 "Maximum update depth")
 * fails the test rather than hiding in browser devtools. */
/** Console-error messages that are noise — captured by `console.error`
 *  but not a real regression. Anything that matches these prefixes is
 *  filtered out of the test's accumulator. Keep the list tight; only
 *  add entries with documented justification. */
const CONSOLE_ERROR_IGNORE: ReadonlyArray<RegExp> = [
  // NextAuth retries its session ping (`_getSession` → `/api/auth/session`)
  // and surfaces a `Failed to fetch` console.error on transient network
  // blips. Common during e2e because the build's Node server can
  // momentarily refuse connections while serving a heavy page request.
  // The retry succeeds on the next cycle and the session stays valid.
  /Failed to fetch.*errors\.authjs\.dev|_getSession/,
];

export function captureErrors(page: Page): {
  consoleErrors: string[];
  pageErrors: Error[];
} {
  const consoleErrors: string[] = [];
  const pageErrors: Error[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (CONSOLE_ERROR_IGNORE.some((re) => re.test(text))) return;
      consoleErrors.push(text);
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err);
  });
  return { consoleErrors, pageErrors };
}

/** Drop every key from the user's `displayPrefs` blob — leaves the
 * dashboard at the registry default. Useful at test setup so each
 * test starts from a known layout. */
export async function resetDisplayPrefs(
  context: BrowserContext,
): Promise<void> {
  const res = await context.request.patch("/api/display-prefs", {
    data: { dashboardLayout: [] },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `resetDisplayPrefs failed: PATCH /api/display-prefs → ${res.status()} ${body}`,
    );
  }
}

/** Set the user's dashboard layout to exactly the entries given.
 * Bypasses the UI drag-and-drop — we want to verify whether
 * RENDERING the widget crashes, not the drop interaction. */
export async function setDashboardLayout(
  context: BrowserContext,
  layout: Array<{
    widgetId: string;
    x: number;
    y: number;
    w: number;
    h: number;
    config?: Record<string, unknown>;
  }>,
): Promise<void> {
  const res = await context.request.patch("/api/display-prefs", {
    data: { dashboardLayout: layout },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `setDashboardLayout failed: PATCH /api/display-prefs → ${res.status()} ${body}`,
    );
  }
}

// ─── Seed-data fixtures (#41) ──────────────────────────────────────
//
// Tests across this directory used to hand-roll the same ~15-line
// `POST /api/accounts` → `POST /api/categories` → loop-POST
// `/api/transactions` setup. Each call site bumped subtly: differing
// default colours, payees / amounts hard-coded, error handling
// inconsistent. These helpers are the single source of truth.
//
// Every helper throws on non-2xx with the response body in the
// message so a setup-time mismatch fails the test with the
// actionable error rather than the silent downstream symptom. Caller
// supplies the run token so per-run isolation stays explicit.

/** Return the id of the first non-archived account, throwing if there
 *  is none. Convenient for specs that just need *an* account to anchor
 *  a transaction against — saved-filters, search, note-related goals,
 *  etc. */
export async function getFirstAccountId(
  context: BrowserContext,
): Promise<string> {
  const res = await context.request.get("/api/accounts");
  if (!res.ok()) {
    throw new Error(`GET /api/accounts → ${res.status()}`);
  }
  const rows = (await res.json()) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new Error("getFirstAccountId: no accounts exist (DB empty?)");
  }
  return rows[0].id;
}

/** Create a fresh account via the public API. Returns the new
 *  `{ id, name }`. */
export async function seedAccount(
  context: BrowserContext,
  opts: {
    name: string;
    type?: string;
    color?: string;
    currentBalance?: string;
  },
): Promise<{ id: string; name: string }> {
  const res = await context.request.post("/api/accounts", {
    data: {
      name: opts.name,
      type: opts.type ?? "checking",
      color: opts.color ?? "#3b82f6",
      currentBalance: opts.currentBalance ?? "0",
    },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `seedAccount failed: POST /api/accounts → ${res.status()} ${body}`,
    );
  }
  const row = (await res.json()) as { id: string; name: string };
  return row;
}

/** Create a fresh category. Defaults to a slate-grey colour so a
 *  series of seeded cats look distinct from the seeded "real" ones
 *  in the sample dataset. */
export async function seedCategory(
  context: BrowserContext,
  opts: {
    name: string;
    type: "income" | "expense";
    color?: string;
  },
): Promise<{ id: string; name: string }> {
  const res = await context.request.post("/api/categories", {
    data: {
      name: opts.name,
      type: opts.type,
      color: opts.color ?? "#64748b",
    },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `seedCategory failed: POST /api/categories → ${res.status()} ${body}`,
    );
  }
  const row = (await res.json()) as { id: string; name: string };
  return row;
}

/** Create a single transaction. Returns the new row id (and notes
 *  field when present — some specs verify notes round-trip). */
export async function seedTransaction(
  context: BrowserContext,
  opts: {
    accountId: string;
    date: string;
    amount: string;
    payee?: string;
    categoryId?: string;
    notes?: string;
  },
): Promise<{ id: string; notes?: string | null }> {
  const res = await context.request.post("/api/transactions", {
    data: opts,
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `seedTransaction failed: POST /api/transactions → ${res.status()} ${body}`,
    );
  }
  const row = (await res.json()) as { id: string; notes?: string | null };
  return row;
}

/** Bulk seed: create one transaction per entry. Sequential to keep
 *  the order deterministic (parallel POSTs to /api/transactions
 *  would commit in arbitrary order — fine for some tests, bad for
 *  any spec that asserts row order). Returns the ids in input order. */
export async function seedTransactions(
  context: BrowserContext,
  accountId: string,
  rows: Array<{
    date: string;
    amount: string;
    payee?: string;
    categoryId?: string;
    notes?: string;
  }>,
): Promise<Array<{ id: string }>> {
  const out: Array<{ id: string }> = [];
  for (const r of rows) {
    out.push(await seedTransaction(context, { accountId, ...r }));
  }
  return out;
}

/** Fail the test if any of the page's runtime errors look like a
 * React infinite-render bailout. React's minified error #185 is the
 * "Maximum update depth exceeded" code — exactly the symptom that
 * costs an hour to reproduce manually. */
/** Seed a single stock-kind investment via the public API so a
 * tracked-stock widget pointing at it has data to render. Returns
 * the new id. */
export async function seedStockInvestment(
  context: BrowserContext,
  opts: {
    symbol: string;
    exchange?: string;
    name?: string;
    currency?: string;
    quantity?: string;
    purchaseDate?: string;
    purchasePrice?: string;
  },
): Promise<string> {
  const res = await context.request.post("/api/investments", {
    data: {
      kind: "stock",
      symbol: opts.symbol,
      exchange: opts.exchange ?? "US",
      currency: opts.currency ?? "USD",
      name: opts.name ?? null,
      quantity: opts.quantity ?? "10",
      purchaseDate: opts.purchaseDate ?? "2024-01-15",
      purchasePrice: opts.purchasePrice ?? "150",
    },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `seedStockInvestment failed: POST /api/investments → ${res.status()} ${body}`,
    );
  }
  const created = (await res.json()) as { id: string };
  return created.id;
}

export function assertNoReactErrors(
  consoleErrors: readonly string[],
  pageErrors: readonly Error[],
): void {
  const joined = [
    ...consoleErrors,
    ...pageErrors.map((e) => `${e.name}: ${e.message}\n${e.stack ?? ""}`),
  ].join("\n---\n");
  expect(joined).not.toMatch(/Maximum update depth/i);
  expect(joined).not.toMatch(/Minified React error #185/i);
}
