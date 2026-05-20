import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";
import { eq, and, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { isoDateString, numericString } from "@/lib/zod-helpers";
import { parseJsonBody } from "@/lib/api/parse-body";

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
  const parsed = await parseJsonBody(request, schema);
  if (!parsed.ok) return parsed.response;
  const { date, balance } = parsed.data;

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
  // Compare in integer cents so float drift across a long sum of
  // transactions can't produce a false "matched" or false "off by
  // a fraction of a cent". Rounding both sides to cents before the
  // diff also means the reported `diff` is always a clean 0.01
  // multiple, never something like 0.004999.
  const expectedCents = Math.round(expected * 100);
  const statedCents = Math.round(stated * 100);
  const diffCents = statedCents - expectedCents;

  if (diffCents !== 0) {
    return NextResponse.json({
      matched: false,
      expected: (expectedCents / 100).toFixed(2),
      stated: (statedCents / 100).toFixed(2),
      diff: (diffCents / 100).toFixed(2),
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
