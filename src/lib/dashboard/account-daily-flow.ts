import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { transactions } from "@/db/schema";

export interface DailyFlowPoint {
  /** ISO date (yyyy-mm-dd) for the day this bucket covers. */
  date: string;
  /** Sum of positive amounts on the day. Always ≥ 0. */
  inflow: number;
  /** Magnitude of summed negative amounts on the day. Always ≥ 0
   * (the chart renders these as a positive bar pointing down). */
  outflow: number;
}

/** Per-day in/out totals for one account across a recent window.
 * Days with no activity are still emitted (zero-filled) so the
 * bar chart renders a stable seven-day strip rather than skipping
 * quiet days. */
export async function getAccountDailyFlow(
  accountId: string,
  days = 7,
): Promise<{ series: DailyFlowPoint[] }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - (days - 1) * 86400000);
  const startIso = start.toISOString().slice(0, 10);

  // SQLite's CAST AS REAL on the text amount column matches the
  // running-balance calc in /api/transactions — same coercion path
  // so the widget agrees with the canonical view.
  const rows = await db
    .select({
      date: transactions.date,
      inflow: sql<number>`COALESCE(SUM(CASE WHEN CAST(${transactions.amount} AS REAL) > 0 THEN CAST(${transactions.amount} AS REAL) ELSE 0 END), 0)`,
      outflow: sql<number>`COALESCE(SUM(CASE WHEN CAST(${transactions.amount} AS REAL) < 0 THEN -CAST(${transactions.amount} AS REAL) ELSE 0 END), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        gte(transactions.date, startIso),
      ),
    )
    .groupBy(transactions.date);

  const byDate = new Map(rows.map((r) => [r.date, r] as const));
  const series: DailyFlowPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000)
      .toISOString()
      .slice(0, 10);
    const r = byDate.get(d);
    series.push({
      date: d,
      inflow: r ? Number(r.inflow) : 0,
      outflow: r ? Number(r.outflow) : 0,
    });
  }
  return { series };
}
