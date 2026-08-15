/** Pure calc module for the Financial Health report. Kept out of the
 *  React tree so the maths is exercisable by a vitest colocated test
 *  without booting jsdom. Every function is total: never throws,
 *  returns `null` when the inputs can't produce a meaningful ratio
 *  (empty ledger, zero-income month, no liabilities defined). */
import type { CashflowReport } from "@/app/api/reports/cashflow/route";

export type AccountLite = {
  id: string;
  type: string;
  currentBalance: string | number;
  isArchived: boolean;
  /** Optional in tests where the display label isn't relevant.
   *  The API row carries it and callers use it for hints. */
  name?: string;
  /** Explicit "count toward emergency-fund coverage" flag on the
   *  account row (added 0.337). Optional so existing tests and any
   *  legacy caller building an AccountLite by hand don't need to
   *  supply it — the resolver treats the absent value as false. */
  isEmergencyFund?: boolean;
};

/** Savings rate for a given month key ("YYYY-MM"). income and
 *  expenses come from the cashflow totals map. Signed such that
 *  positive net → positive rate. Returns null when income is 0
 *  (dividing by zero) or the month is missing. */
export function savingsRateForMonth(
  report: Pick<CashflowReport, "totals">,
  month: string,
): number | null {
  const income = report.totals.income[month];
  const expenses = report.totals.expenses[month];
  if (income === undefined) return null;
  if (income <= 0) return null;
  const surplus = income + (expenses ?? 0);
  return surplus / income;
}

/** Rolling savings-rate series across the report's months, in order.
 *  Undefined months (no ledger activity) drop out — a month with no
 *  income isn't a "0% savings rate", it's a data gap. */
export function savingsRateSeries(
  report: Pick<CashflowReport, "months" | "totals">,
): Array<{ month: string; rate: number }> {
  const out: Array<{ month: string; rate: number }> = [];
  for (const m of report.months) {
    const rate = savingsRateForMonth(report, m);
    if (rate !== null) out.push({ month: m, rate });
  }
  return out;
}

/** Average monthly expenses across the last N months of the report.
 *  Uses absolute values (expenses are stored negative). Returns 0 for
 *  an empty report. */
export function avgMonthlyExpenses(
  report: Pick<CashflowReport, "months" | "totals">,
  lastN: number,
): number {
  const months = report.months.slice(-lastN);
  if (months.length === 0) return 0;
  let sum = 0;
  for (const m of months) sum += Math.abs(report.totals.expenses[m] ?? 0);
  return sum / months.length;
}

/** Average monthly income across the last N months of the report. */
export function avgMonthlyIncome(
  report: Pick<CashflowReport, "months" | "totals">,
  lastN: number,
): number {
  const months = report.months.slice(-lastN);
  if (months.length === 0) return 0;
  let sum = 0;
  for (const m of months) sum += report.totals.income[m] ?? 0;
  return sum / months.length;
}

/** Which accounts count as emergency-fund holdings.
 *  Priority order:
 *    1. Every non-archived account with `isEmergencyFund=true`.
 *       This is the operator's explicit choice; it wins.
 *    2. If NO account has the flag on, fall back to every
 *       non-archived `savings`-type account. The fallback keeps
 *       upgraders from seeing an empty tile on first render — as
 *       soon as they flag any account the fallback disengages. */
export function resolveEmergencyFundAccounts(
  all: AccountLite[],
): AccountLite[] {
  const flagged = all.filter((a) => !a.isArchived && a.isEmergencyFund === true);
  if (flagged.length > 0) return flagged;
  return all.filter((a) => !a.isArchived && a.type === "savings");
}

/** Which accounts count as liabilities. Explicit override wins;
 *  otherwise `credit` + `loan`. */
export function resolveLiabilityAccounts(
  all: AccountLite[],
  overrideIds: string[],
): AccountLite[] {
  if (overrideIds.length > 0) {
    const set = new Set(overrideIds);
    return all.filter((a) => set.has(a.id));
  }
  return all.filter(
    (a) => !a.isArchived && (a.type === "credit" || a.type === "loan"),
  );
}

/** Emergency-fund months of coverage — total emergency-fund balance
 *  divided by average monthly expenses. Returns null when there's
 *  no expense signal (an empty ledger can't yield "infinite months"). */
export function emergencyFundMonths(
  fundBalance: number,
  avgExpenses: number,
): number | null {
  if (avgExpenses <= 0) return null;
  return fundBalance / avgExpenses;
}

/** Debt-to-income ratio — total liabilities as a fraction of annual
 *  income. Lower is better. Returns null when there's no income
 *  signal. Liabilities carry a negative balance for credit/loan
 *  accounts in the ledger, so we absolute-value them here. */
export function debtToIncome(
  liabilitiesTotal: number,
  avgMonthlyIncome: number,
): number | null {
  if (avgMonthlyIncome <= 0) return null;
  const annualIncome = avgMonthlyIncome * 12;
  return Math.abs(liabilitiesTotal) / annualIncome;
}

/** Net worth from a snapshot of every non-archived account. Assets
 *  (checking / savings / cash) count positive; liabilities (credit /
 *  loan) count as-signed — the balance is already negative for a
 *  card carrying a balance, so summation gives the right net. */
export function netWorth(all: AccountLite[]): number {
  let sum = 0;
  for (const a of all) {
    if (a.isArchived) continue;
    const bal =
      typeof a.currentBalance === "number"
        ? a.currentBalance
        : parseFloat(a.currentBalance);
    if (Number.isFinite(bal)) sum += bal;
  }
  return sum;
}

/** Top-N expense categories for a given month, plus an "Other"
 *  bucket for the tail. Used by the composition donut. Categories
 *  are compared by absolute total (expenses are negative). */
export function topExpenseCategories(
  expenses: Array<{ id: string; name: string; byMonth: Record<string, number> }>,
  month: string,
  topN: number,
): Array<{ id: string; name: string; value: number }> {
  const rows = expenses
    .map((c) => ({
      id: c.id,
      name: c.name,
      value: Math.abs(c.byMonth[month] ?? 0),
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  if (rows.length <= topN) return rows;
  const top = rows.slice(0, topN);
  const rest = rows.slice(topN);
  const otherValue = rest.reduce((s, r) => s + r.value, 0);
  return [...top, { id: "__other__", name: "Other", value: otherValue }];
}
