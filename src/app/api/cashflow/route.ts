import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { accounts, transactions, scheduledTransactions } from "@/db/schema";
import { and, gte, eq, inArray, sql } from "drizzle-orm";
import { parseISO } from "date-fns";
import { computeCashflow } from "@/lib/cashflow";

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const to = searchParams.get("to");
  const accountIdParam = searchParams.get("accountIds");

  if (!fromParam || !to) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }

  // Sanity bounds. The compute step runs O(days × accounts × txns) work and
  // also fetches every txn after `from` — a hostile or malformed query for
  // a 50-year span would load the whole transactions table. The brush in
  // the calendar already operates within ~3 years; any well-behaved client
  // stays well under this cap.
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  if ((fromParam !== "auto" && !ISO_RE.test(fromParam)) || !ISO_RE.test(to)) {
    return NextResponse.json({ error: "from / to must be YYYY-MM-DD" }, { status: 400 });
  }
  // 12-year cap; anything wider is an accident or DoS attempt.
  const MAX_RANGE_DAYS = 365 * 12;
  if (fromParam !== "auto") {
    const fromMs = Date.parse(fromParam);
    const toMs = Date.parse(to);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) {
      return NextResponse.json({ error: "from must be <= to" }, { status: 400 });
    }
    if ((toMs - fromMs) / 86_400_000 > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { error: `range too large (max ${MAX_RANGE_DAYS} days)` },
        { status: 400 },
      );
    }
  }

  const accountIds = accountIdParam
    ? accountIdParam.split(",").filter(Boolean)
    : undefined;

  // `from=auto` resolves to MIN(date) over the (optionally accountId-scoped)
  // transactions — used by the calendar's overview/brush chart so it can
  // span the entire dataset without the client knowing the earliest date.
  let from = fromParam;
  if (fromParam === "auto") {
    const conds = [];
    if (accountIds?.length) conds.push(inArray(transactions.accountId, accountIds));
    const [row] = await db
      .select({ min: sql<string | null>`MIN(${transactions.date})` })
      .from(transactions)
      .where(conds.length ? and(...conds) : undefined);
    from = row?.min ?? to; // empty dataset → trivial single-day range
  }

  const allAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.isArchived, false));

  // Fetch every real transaction with date >= from (no upper bound). The
  // compute function needs all post-`from` transactions to roll back from
  // currentBalance to the start-of-`from` balance — bounding by `to` would
  // undershoot the back-compute when viewing past months.
  const txnConditions = [gte(transactions.date, from)];
  if (accountIds?.length) {
    txnConditions.push(inArray(transactions.accountId, accountIds));
  }

  const realTxns = await db
    .select()
    .from(transactions)
    .where(and(...txnConditions));

  const scheduledTxns = await db
    .select()
    .from(scheduledTransactions)
    .where(eq(scheduledTransactions.isActive, true));

  const result = computeCashflow({
    accounts: allAccounts,
    realTransactions: realTxns,
    scheduledTransactions: scheduledTxns,
    from: parseISO(from),
    to: parseISO(to),
    accountIds,
  });

  return NextResponse.json(result);
}
