import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";

export interface BalancePoint {
  /** ISO date (yyyy-mm-dd) — end-of-day for this point. */
  date: string;
  /** Closing balance at end of this day, in account-local
   * currency. Computed as `startingBalance + Σ amounts up to and
   * including this day`. */
  balance: number;
}

/** Daily-end balance series for one account across a recent
 * window. The anchor is the balance at end-of-day(window_start − 1),
 * then a forward walk through daily net-flow gives each day's
 * closing balance.
 *
 * We deliberately don't trust `accounts.currentBalance` as the
 * right anchor — that field bakes in future-dated transactions
 * the operator may have entered (scheduled rent, post-dated
 * cheques) so it's not "balance at the right edge of the
 * window". The left-anchor approach is independent of that. */
export async function getAccountBalanceTrend(
  accountId: string,
  days = 7,
): Promise<{ series: BalancePoint[] }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - (days - 1) * 86400000);
  const startIso = start.toISOString().slice(0, 10);

  const [account] = await db
    .select({ startingBalance: accounts.startingBalance })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) return { series: [] };

  const [{ priorSum } = { priorSum: 0 }] = await db
    .select({
      priorSum: sql<number>`COALESCE(SUM(CAST(${transactions.amount} AS REAL)), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        lt(transactions.date, startIso),
      ),
    );

  const dailyRows = await db
    .select({
      date: transactions.date,
      net: sql<number>`COALESCE(SUM(CAST(${transactions.amount} AS REAL)), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        gte(transactions.date, startIso),
      ),
    )
    .groupBy(transactions.date);

  const netByDate = new Map<string, number>(
    dailyRows.map((r) => [r.date, Number(r.net)] as const),
  );

  const anchor = parseFloat(account.startingBalance) + Number(priorSum);
  const series: BalancePoint[] = [];
  let running = anchor;
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000)
      .toISOString()
      .slice(0, 10);
    running += netByDate.get(d) ?? 0;
    series.push({ date: d, balance: running });
  }
  return { series };
}
