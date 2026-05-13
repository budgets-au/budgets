import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { endOfMonth, subMonths, format } from "date-fns";

/** Returns net-worth at the end of each of the last 12 months.
 *
 * Computation per month: Σ(accounts.starting_balance over visible
 * accounts) + Σ(transactions.amount where date ≤ end-of-month).
 *
 * Visible-account convention follows the dashboard: archived
 * accounts are excluded so the trend reflects what the operator
 * sees on the accounts list. */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // 12 month-ends, oldest first, anchored at end-of-current-month so
  // the rightmost point is "today's net worth" (well, today's
  // current_balance equivalent, computed from raw txns the same way
  // the dashboard's headline figure is).
  const points: string[] = [];
  for (let i = 11; i >= 0; i--) {
    points.push(format(endOfMonth(subMonths(now, i)), "yyyy-MM-dd"));
  }

  // Sum of starting balances across non-archived accounts is constant
  // — pull once and add to every period's running figure.
  const [startingRow] = await db.all(sql`
    SELECT CAST(COALESCE(SUM(CAST(starting_balance AS REAL)), 0) AS REAL) AS total
    FROM accounts
    WHERE is_archived = 0
  `);
  const startingTotal = (startingRow as { total: number }).total ?? 0;

  // Cumulative sum of txn amounts up to and including each period
  // end-date. SQLite doesn't have a great built-in "running total
  // matrix" so we do 12 sums; for a 12k-row table this is sub-ms
  // each.
  const trend: Array<{ date: string; netWorth: number }> = [];
  for (const d of points) {
    const [row] = await db.all(sql`
      SELECT CAST(COALESCE(SUM(amount), 0) AS REAL) AS sum
      FROM transactions
      WHERE date <= ${d}
        AND account_id IN (SELECT id FROM accounts WHERE is_archived = 0)
    `);
    const sum = (row as { sum: number }).sum ?? 0;
    trend.push({
      date: d,
      netWorth: startingTotal + sum,
    });
  }

  return NextResponse.json({
    trend,
    monthLabels: points.map((d) => format(new Date(d), "MMM")),
  });
}
