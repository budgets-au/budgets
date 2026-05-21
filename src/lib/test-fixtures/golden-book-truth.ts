/**
 * The truth table for the Golden Book fixture. Every number here is
 * hand-computed from the fixture in `golden-book.ts`; integration
 * tests assert against these constants so we don't have to re-derive
 * what production is supposed to compute.
 *
 * When the fixture intentionally changes shape, update these
 * constants in the same diff. Treat any unexpected diff to this file
 * as evidence that something downstream has drifted.
 *
 * ── Derivation ──────────────────────────────────────────────────────
 *
 * Cheque flows per month (everything posts in the named month):
 *   +6000   salary
 *   -547    health insurance (Jan–Jun)
 *   -580    health insurance (Jul–Dec)
 *   -800    groceries
 *   -1000   internal transfer out → Savings
 * Savings flows per month:
 *   +1000   internal transfer in ← Cheque
 *
 * March anomalies:
 *   +25     grocery refund
 *   -50     uncategorised
 *
 * Standard V1 month (Jan, Feb, Apr, May, Jun) Cheque net:
 *     6000 - 547 - 800 - 1000 = +3653
 *   With Savings +1000: across-account net = 4653
 *
 * March Cheque net: +3653 + 25 - 50 = +3628; across-account += 1000 = 4628
 *
 * Standard V2 month (Jul–Dec) Cheque net:
 *     6000 - 580 - 800 - 1000 = +3620
 *   Across-account: +4620
 *
 * Closing balance (cumulative across all accounts) ── derived below.
 */

export const OPENING_BALANCE = 5000 + 50000; // 55_000

/** Monthly net of every transaction across every account (transfers
 * cancel within the month). This is what the cashflow report's
 * `totals.net` should report. */
export const MONTHLY_NET: Record<string, number> = {
  "2026-01": 4653,
  "2026-02": 4653,
  "2026-03": 4628, // refund (+25) + uncat (-50)
  "2026-04": 4653,
  "2026-05": 4653,
  "2026-06": 4653,
  "2026-07": 4620,
  "2026-08": 4620,
  "2026-09": 4620,
  "2026-10": 4620,
  "2026-11": 4620,
  "2026-12": 4620,
};

/** Cumulative closing balance after each month — opening + Σ nets. */
export const CLOSING_BALANCE: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  let running = OPENING_BALANCE;
  for (const m of Object.keys(MONTHLY_NET).sort()) {
    running += MONTHLY_NET[m];
    out[m] = running;
  }
  return out;
})();

/** End-of-window balance per account. Production stores this on
 * `accounts.currentBalance` and recomputes it from
 * `starting_balance + Σ(amount)` whenever needed. */
export const ACCOUNT_BALANCE_END = {
  cheque: 5000
    + 12 * 6000          // salary
    - (6 * 547 + 6 * 580) // health
    - 12 * 800           // groceries (base)
    + 25                 // March refund
    - 50                 // March uncat
    - 12 * 1000          // internal transfer outflows
  ,
  savings: 50000 + 12 * 1000,
};
// = cheque: 5000 + 72000 - 6762 - 9600 + 25 - 50 - 12000 = 48613
// = savings: 62000

/** Per-category totals across the full window — the figures that
 * appear in the cashflow report's Total column for each leaf. */
export const CATEGORY_TOTALS = {
  // Income — positive
  salary: 12 * 6000,                       // 72_000
  // Expenses — negative (amounts stored as -ve)
  health: -(6 * 547 + 6 * 580),            // -6_762
  groceries: -(12 * 800) + 25,             // -9_575 (refund offsets one month)
  // Transfers — net to zero across all accounts in the report window
  internalTransfer: 0,
};

/** Per-month, per-category amounts. The cashflow report stores these
 * in `byMonth` for each CashflowCategory entry. Only the
 * non-zero-month entries are listed; absent keys mean 0. */
export const CATEGORY_BY_MONTH = {
  salary: Object.fromEntries(
    Object.keys(MONTHLY_NET).map((m) => [m, 6000]),
  ) as Record<string, number>,
  health: Object.fromEntries(
    Object.keys(MONTHLY_NET).map((m) => {
      const idx = parseInt(m.split("-")[1], 10) - 1;
      return [m, -(idx < 6 ? 547 : 580)];
    }),
  ) as Record<string, number>,
  groceries: Object.fromEntries(
    Object.keys(MONTHLY_NET).map((m) => [
      m,
      m === "2026-03" ? -800 + 25 : -800,
    ]),
  ) as Record<string, number>,
};

/** Plan total per category — `scheduledTotal` in the API. The Plan
 * column is now a window-sum (Σ scheduledByMonth across the 12-month
 * window) rather than a monthly-averaged rate. Includes BOTH the
 * active V2 Health firings (Jul-Dec) and the superseded V1's
 * historical Jan-Jun firings — anything expandRecurrence walks lights
 * up the column. (The old "exclude superseded predecessors" rule
 * applied to the monthly rate to stop double-counting; the lumpy
 * total has no such hazard — each occurrence is counted once.) */
export const PLAN_TOTAL = {
  salary: 12 * 6000,            // 72_000 — monthly schedule × 12
  health: 6 * 547 + 6 * 580,    // 6_762 — V1 Jan-Jun + V2 Jul-Dec
  groceries: 12 * 800,          // 9_600 — monthly schedule × 12
  // internalTransfer: undefined — transfer_kind=internal skipped on
  // the schedule aggregation (see route.ts).
};

/** Average per month for each leaf across the 12-month window. */
export const AVG_PER_MONTH = {
  salary: CATEGORY_TOTALS.salary / 12,                  // 6000
  health: CATEGORY_TOTALS.health / 12,                  // -563.5
  groceries: CATEGORY_TOTALS.groceries / 12,            // -797.92
};

/** Total Income / Expense / Surplus across the window. These are the
 * sums the cashflow report exposes via `totals.income`, etc. */
export const INCOME_TOTAL_PER_MONTH: Record<string, number> = Object.fromEntries(
  Object.keys(MONTHLY_NET).map((m) => [m, 6000]),
);

/** Per-month Total Expenses figure. Note: the API rolls the
 * uncategorised pseudo-row ("uncategorised-expenses") into this
 * total, so the March -$50 mystery purchase contributes here even
 * though it has no category. */
export const EXPENSE_TOTAL_PER_MONTH: Record<string, number> = Object.fromEntries(
  Object.keys(MONTHLY_NET).map((m) => {
    const idx = parseInt(m.split("-")[1], 10) - 1;
    const health = -(idx < 6 ? 547 : 580);
    const groceries = m === "2026-03" ? -800 + 25 : -800;
    const uncat = m === "2026-03" ? -50 : 0;
    return [m, health + groceries + uncat];
  }),
);
