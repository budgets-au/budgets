import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { format, startOfMonth, endOfMonth, subMonths, addMonths, parseISO } from "date-fns";
import { auth } from "@/lib/auth";
import { db } from "@/db";

export interface AccountsCashflowAccount {
  id: string;
  name: string;
  color: string;
  type: string;
  /** Balance immediately before `from` (starting_balance + every txn before
   *  the window). The first month's opening balance. */
  startingBalance: number;
  /** Positive sum of money-in transactions per month. */
  creditByMonth: Record<string, number>;
  /** Absolute (positive) sum of money-out transactions per month. */
  debitByMonth: Record<string, number>;
  /** Closing balance at the end of each month in the window. */
  balanceByMonth: Record<string, number>;
  totalCredit: number;
  totalDebit: number;
  /** Balance at the end of `to`. */
  closingBalance: number;
}

export interface AccountsCashflowReport {
  months: string[];
  accounts: AccountsCashflowAccount[];
  totals: {
    creditByMonth: Record<string, number>;
    debitByMonth: Record<string, number>;
    balanceByMonth: Record<string, number>;
    totalCredit: number;
    totalDebit: number;
    closingBalance: number;
  };
}

function generateMonths(from: string, to: string): string[] {
  const months: string[] = [];
  let cur = startOfMonth(parseISO(from));
  const end = startOfMonth(parseISO(to));
  while (cur <= end) {
    months.push(format(cur, "yyyy-MM"));
    cur = addMonths(cur, 1);
  }
  return months;
}

/** GET /api/reports/accounts-cashflow
 *
 * Per-account monthly cashflow: credit (money in), debit (money out,
 * sign-flipped to positive), and closing balance. Mirrors the shape of
 * the cashflow report but keyed by account instead of category.
 *
 * `?accountIds=` restricts to a comma-separated list; default is all
 * non-archived accounts. The starting balance walk uses each account's
 * `starting_balance` field + every transaction with `date < from` for
 * that account, matching how the calendar's per-account series is
 * back-computed. */
export async function GET(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const from = searchParams.get("from") ?? format(startOfMonth(subMonths(now, 5)), "yyyy-MM-dd");
  const to = searchParams.get("to") ?? format(endOfMonth(now), "yyyy-MM-dd");

  const accountIdsRaw = searchParams.get("accountIds");
  const accountIdsAll = accountIdsRaw
    ? accountIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const accountIdFilter = accountIdsAll.filter((id) => UUID_RE.test(id));

  const accountWhere =
    accountIdFilter.length > 0
      ? sql`WHERE id IN (${sql.join(accountIdFilter.map((id) => sql`${id}`), sql`, `)})`
      : sql`WHERE is_archived = 0`;

  // Active (or explicitly-selected) accounts. Listed in a stable
  // type-then-name order to match the sidebar's grouping.
  const accountRows = (await db.all(sql`
    SELECT
      id,
      name,
      type,
      color,
      CAST(starting_balance AS REAL) AS starting_balance
    FROM accounts
    ${accountWhere}
    ORDER BY type, LOWER(name)
  `)) as Array<{
    id: string;
    name: string;
    type: string;
    color: string;
    starting_balance: number;
  }>;

  const months = generateMonths(from, to);

  if (accountRows.length === 0) {
    return NextResponse.json({
      months,
      accounts: [],
      totals: {
        creditByMonth: Object.fromEntries(months.map((m) => [m, 0])),
        debitByMonth: Object.fromEntries(months.map((m) => [m, 0])),
        balanceByMonth: Object.fromEntries(months.map((m) => [m, 0])),
        totalCredit: 0,
        totalDebit: 0,
        closingBalance: 0,
      },
    } satisfies AccountsCashflowReport);
  }

  const accountIds = accountRows.map((a) => a.id);
  const idList = sql.join(
    accountIds.map((id) => sql`${id}`),
    sql`, `,
  );

  // Per-account opening: sum of all txn amounts strictly before `from`.
  // Combined with starting_balance below this yields the balance at the
  // moment the report's window opens. (sign in amount is already
  // correct: positive = credit, negative = debit.)
  const openingRows = (await db.all(sql`
    SELECT
      account_id                       AS account_id,
      CAST(SUM(amount) AS REAL)        AS pre_window
    FROM transactions
    WHERE date < ${from}
      AND account_id IN (${idList})
    GROUP BY account_id
  `)) as Array<{ account_id: string; pre_window: number }>;
  const openingByAccount = new Map(
    openingRows.map((r) => [r.account_id, Number(r.pre_window) || 0]),
  );

  // Per-account × month: split into credits (amount > 0) and debits
  // (amount < 0). Transfers are intentionally included — from a
  // single-account perspective every transfer is real cashflow on
  // both legs; netting only makes sense at the all-accounts level
  // and isn't what this report is meant to surface.
  const monthRows = (await db.all(sql`
    SELECT
      account_id                                                    AS account_id,
      substr(date, 1, 7)                                            AS month,
      CAST(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS REAL) AS credit,
      CAST(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS REAL) AS debit
    FROM transactions
    WHERE date >= ${from} AND date <= ${to}
      AND account_id IN (${idList})
    GROUP BY account_id, substr(date, 1, 7)
  `)) as Array<{ account_id: string; month: string; credit: number; debit: number }>;

  const byAccount = new Map<
    string,
    { credit: Map<string, number>; debit: Map<string, number> }
  >();
  for (const id of accountIds) {
    byAccount.set(id, { credit: new Map(), debit: new Map() });
  }
  for (const r of monthRows) {
    const slot = byAccount.get(r.account_id);
    if (!slot) continue;
    slot.credit.set(r.month, Number(r.credit) || 0);
    slot.debit.set(r.month, Math.abs(Number(r.debit) || 0));
  }

  const totals = {
    creditByMonth: Object.fromEntries(months.map((m) => [m, 0])),
    debitByMonth: Object.fromEntries(months.map((m) => [m, 0])),
    balanceByMonth: Object.fromEntries(months.map((m) => [m, 0])),
    totalCredit: 0,
    totalDebit: 0,
    closingBalance: 0,
  };

  const accounts: AccountsCashflowAccount[] = accountRows.map((a) => {
    const slot = byAccount.get(a.id);
    const startingBalance =
      Number(a.starting_balance || 0) + (openingByAccount.get(a.id) ?? 0);
    const creditByMonth: Record<string, number> = {};
    const debitByMonth: Record<string, number> = {};
    const balanceByMonth: Record<string, number> = {};
    let running = startingBalance;
    let totalCredit = 0;
    let totalDebit = 0;
    for (const m of months) {
      const cr = slot?.credit.get(m) ?? 0;
      const dr = slot?.debit.get(m) ?? 0;
      creditByMonth[m] = cr;
      debitByMonth[m] = dr;
      running = running + cr - dr;
      balanceByMonth[m] = Math.round(running * 100) / 100;
      totalCredit += cr;
      totalDebit += dr;
      totals.creditByMonth[m] = (totals.creditByMonth[m] ?? 0) + cr;
      totals.debitByMonth[m] = (totals.debitByMonth[m] ?? 0) + dr;
      totals.balanceByMonth[m] = (totals.balanceByMonth[m] ?? 0) + balanceByMonth[m];
    }
    const closingBalance = balanceByMonth[months[months.length - 1]] ?? startingBalance;
    totals.totalCredit += totalCredit;
    totals.totalDebit += totalDebit;
    totals.closingBalance += closingBalance;
    return {
      id: a.id,
      name: a.name,
      color: a.color,
      type: a.type,
      startingBalance: Math.round(startingBalance * 100) / 100,
      creditByMonth,
      debitByMonth,
      balanceByMonth,
      totalCredit: Math.round(totalCredit * 100) / 100,
      totalDebit: Math.round(totalDebit * 100) / 100,
      closingBalance,
    };
  });

  return NextResponse.json({
    months,
    accounts,
    totals,
  } satisfies AccountsCashflowReport);
}
