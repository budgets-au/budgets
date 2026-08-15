/** Pure calc module for the Trend / Anomaly report. Consumes the
 *  same CashflowReport payload every other report uses; every
 *  helper works over the visible months (typically 6) and returns
 *  ranked lists ready for RankedList rendering. Expense values are
 *  stored negative — the surfacers here use absolute magnitudes so
 *  that "the biggest categories" and "the biggest deltas" behave
 *  intuitively across income and expense rows. */
import type { CashflowCategory } from "@/app/api/reports/cashflow/route";

export interface RankedMoverRow {
  categoryId: string;
  displayName: string;
  currentMonth: number; // absolute magnitude in the last month
  rollingAvg: number;   // absolute magnitude 3-mo trailing average (excludes last month)
  delta: number;         // currentMonth - rollingAvg, signed. positive → over trend
}

export interface StreakRow {
  categoryId: string;
  displayName: string;
  streakLength: number;   // consecutive months over plan, ending at the last month
  totalOverspend: number; // signed sum of monthly (spend - plan) across the streak
}

export interface NewRow {
  categoryId: string;
  displayName: string;
  currentMonth: number; // absolute magnitude in the last month
}

export interface GrowthRow {
  categoryId: string;
  displayName: string;
  currentMonth: number;   // last month's absolute magnitude
  threeMonthsAgo: number; // absolute magnitude three months before that
  growthPct: number;       // (current - threeAgo) / threeAgo, positive → accelerating
}

function displayNameOf(cat: CashflowCategory): string {
  return [cat.grandparentName, cat.parentName, cat.name]
    .filter(Boolean)
    .join(" › ");
}

/** Categories where |current-month spend| is furthest from the
 *  3-month trailing average. Positive delta = over trend; negative
 *  = under. Requires at least 4 months of report data (3 to average
 *  + 1 current); returns [] otherwise. */
export function topMovers(
  cats: CashflowCategory[],
  months: string[],
  topN: number,
): RankedMoverRow[] {
  if (months.length < 4) return [];
  const last = months[months.length - 1];
  const trailing = months.slice(-4, -1); // last 3 months before the current one
  const out: RankedMoverRow[] = [];
  for (const c of cats) {
    const current = Math.abs(c.byMonth[last] ?? 0);
    let sum = 0;
    for (const m of trailing) sum += Math.abs(c.byMonth[m] ?? 0);
    const rollingAvg = sum / trailing.length;
    // A row that's flat at zero across the window contributes noise —
    // skip it. Movement below a small floor (< $5) is also noise.
    if (current === 0 && rollingAvg === 0) continue;
    const delta = current - rollingAvg;
    if (Math.abs(delta) < 5) continue;
    out.push({
      categoryId: c.id,
      displayName: displayNameOf(c),
      currentMonth: current,
      rollingAvg,
      delta,
    });
  }
  out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return out.slice(0, topN);
}

/** Categories that have been over `plan` (budget + scheduled) for
 *  N ≥ 2 consecutive months ending at the last month in the window.
 *  Returns the streak length and total signed overspend. Sorted by
 *  streak length desc, then by overspend magnitude desc. */
export function streaksOverPlan(
  cats: CashflowCategory[],
  months: string[],
  topN: number,
): StreakRow[] {
  if (months.length === 0) return [];
  const out: StreakRow[] = [];
  for (const c of cats) {
    let streak = 0;
    let overspend = 0;
    for (let i = months.length - 1; i >= 0; i--) {
      const m = months[i];
      const spend = Math.abs(c.byMonth[m] ?? 0);
      const plan =
        (c.budgetByMonth?.[m] ?? 0) + (c.scheduledByMonth?.[m] ?? 0);
      // Only categories with a plan can meaningfully "streak over" it.
      if (plan <= 0) break;
      if (spend <= plan) break;
      streak += 1;
      overspend += spend - plan;
    }
    if (streak >= 2) {
      out.push({
        categoryId: c.id,
        displayName: displayNameOf(c),
        streakLength: streak,
        totalOverspend: overspend,
      });
    }
  }
  out.sort((a, b) => {
    if (b.streakLength !== a.streakLength) return b.streakLength - a.streakLength;
    return b.totalOverspend - a.totalOverspend;
  });
  return out.slice(0, topN);
}

/** Categories that had zero activity in the last 3 months before
 *  the current one, but non-zero in the current one. Highlights
 *  new spending patterns. Sorted by current-month magnitude desc. */
export function newThisMonth(
  cats: CashflowCategory[],
  months: string[],
  topN: number,
): NewRow[] {
  if (months.length < 4) return [];
  const last = months[months.length - 1];
  const trailing = months.slice(-4, -1);
  const out: NewRow[] = [];
  for (const c of cats) {
    const current = Math.abs(c.byMonth[last] ?? 0);
    if (current === 0) continue;
    let priorSum = 0;
    for (const m of trailing) priorSum += Math.abs(c.byMonth[m] ?? 0);
    if (priorSum > 0) continue;
    out.push({
      categoryId: c.id,
      displayName: displayNameOf(c),
      currentMonth: current,
    });
  }
  out.sort((a, b) => b.currentMonth - a.currentMonth);
  return out.slice(0, topN);
}

/** Fastest-accelerating spend: growth rate between the month three
 *  months ago and the last month. Filters out rows with a
 *  three-months-ago baseline < $20 (dividing by pocket-change gives
 *  meaningless % explosions). Sorted by growthPct desc. */
export function fastestGrowing(
  cats: CashflowCategory[],
  months: string[],
  topN: number,
): GrowthRow[] {
  if (months.length < 4) return [];
  const last = months[months.length - 1];
  const threeAgo = months[months.length - 4];
  const out: GrowthRow[] = [];
  for (const c of cats) {
    const current = Math.abs(c.byMonth[last] ?? 0);
    const baseline = Math.abs(c.byMonth[threeAgo] ?? 0);
    if (baseline < 20) continue;
    if (current <= baseline) continue;
    const growthPct = (current - baseline) / baseline;
    out.push({
      categoryId: c.id,
      displayName: displayNameOf(c),
      currentMonth: current,
      threeMonthsAgo: baseline,
      growthPct,
    });
  }
  out.sort((a, b) => b.growthPct - a.growthPct);
  return out.slice(0, topN);
}
