import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";
import { eq, and, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { isoDateString, numericString } from "@/lib/zod-helpers";

const schema = z.object({
  /** Bank statement ending date (YYYY-MM-DD). Reconciliation marks every
   * transaction on or before this date as reconciled IF the running balance
   * at end-of-day matches the supplied figure. */
  date: isoDateString,
  /** Bank's stated balance at end-of-day on `date`, including the day's
   * transactions. */
  balance: numericString,
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { date, balance } = schema.parse(body);

  const [account] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Expected balance at end of `date` = starting_balance + sum of every txn
  // dated on/before `date`. Mirrors the cashflow library's account walk.
  const [sumRow] = await db
    .select({
      total: sql<string>`CAST(COALESCE(SUM(CAST(${transactions.amount} AS REAL)), 0) AS TEXT)`,
    })
    .from(transactions)
    .where(and(eq(transactions.accountId, id), lte(transactions.date, date)));

  const expected = parseFloat(account.startingBalance) + parseFloat(sumRow.total);
  const stated = parseFloat(balance);
  const diff = Math.round((stated - expected) * 100) / 100;

  if (Math.abs(diff) > 0.005) {
    return NextResponse.json({
      matched: false,
      expected: expected.toFixed(2),
      stated: stated.toFixed(2),
      diff: diff.toFixed(2),
    });
  }

  // Mark every txn on/before the date as reconciled. Idempotent — a re-run
  // with the same args reports `reconciled: 0` when nothing changed.
  const updated = await db
    .update(transactions)
    .set({ isReconciled: true, updatedAt: new Date() })
    .where(
      and(
        eq(transactions.accountId, id),
        lte(transactions.date, date),
        eq(transactions.isReconciled, false),
      ),
    )
    .returning({ id: transactions.id });

  return NextResponse.json({ matched: true, reconciled: updated.length });
}
