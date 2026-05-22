import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withAuth } from "@/lib/api/route-guards";
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
export const GET = withAuth(async () => {
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

  // Issue #75: was 12 separate `SELECT SUM(amount) WHERE date <= $d`
  // queries, each scanning the full transactions table — O(12 × N)
  // sequential reads. One GROUP BY + cumulative-sum in JS does the
  // same in one round-trip.
  const earliest = points[0];
  const latest = points[points.length - 1];
  const byMonth = (await db.all(sql`
    SELECT substr(date, 1, 7) AS month,
           CAST(COALESCE(SUM(amount), 0) AS REAL) AS sum
    FROM transactions
    WHERE date <= ${latest}
      AND account_id IN (SELECT id FROM accounts WHERE is_archived = 0)
    GROUP BY substr(date, 1, 7)
    ORDER BY month
  `)) as Array<{ month: string; sum: number }>;
  // monthlySum[YYYY-MM] = net delta that month (across visible
  // accounts). For pre-earliest months, fold into a single "everything
  // before the window" baseline so the cumulative sum at the first
  // point still reflects history.
  const earliestMonth = earliest.slice(0, 7);
  let preWindowSum = 0;
  const monthDelta = new Map<string, number>();
  for (const r of byMonth) {
    if (r.month < earliestMonth) preWindowSum += r.sum;
    else monthDelta.set(r.month, r.sum);
  }
  const trend: Array<{ date: string; netWorth: number }> = [];
  let cum = preWindowSum;
  for (const d of points) {
    const m = d.slice(0, 7);
    cum += monthDelta.get(m) ?? 0;
    trend.push({
      date: d,
      netWorth: startingTotal + cum,
    });
  }

  return NextResponse.json({
    trend,
    monthLabels: points.map((d) => format(new Date(d), "MMM")),
  });
});
