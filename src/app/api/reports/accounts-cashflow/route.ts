import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { format, startOfMonth, endOfMonth, subMonths, addMonths, parseISO } from "date-fns";
import { auth } from "@/lib/auth";
import { db } from "@/db";

export interface TransferCounterpartyBreakdown {
  /** Paired account's id, or null when the transfer's pair lives at an
   *  external/unknown account (no `transfer_pair_id` recorded). */
  counterpartyId: string | null;
  counterpartyName: string;
  counterpartyColor: string | null;
  byMonth: Record<string, number>;
  total: number;
}

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
  /** Positive (signed) sum of money-in transactions whose category has
   *  transferKind in {'internal','external'} — i.e. transfers received
   *  into this account. Always a subset of `creditByMonth`. */
  transferInByMonth: Record<string, number>;
  /** Absolute sum of money-out transfer transactions per month
   *  (categories with transferKind != 'none'). Subset of debits. */
  transferOutByMonth: Record<string, number>;
  /** Transfer-in totals broken down by the counterparty account that
   *  sent the money. Ordered by total descending. */
  transferInBy: TransferCounterpartyBreakdown[];
  /** Transfer-out totals broken down by the counterparty account that
   *  received the money. Ordered by total descending. */
  transferOutBy: TransferCounterpartyBreakdown[];
  /** Closing balance at the end of each month in the window. */
  balanceByMonth: Record<string, number>;
  totalCredit: number;
  totalDebit: number;
  totalTransferIn: number;
  totalTransferOut: number;
  /** Balance at the end of `to`. */
  closingBalance: number;
}

export interface AccountsCashflowReport {
  months: string[];
  accounts: AccountsCashflowAccount[];
  totals: {
    creditByMonth: Record<string, number>;
    debitByMonth: Record<string, number>;
    transferInByMonth: Record<string, number>;
    transferOutByMonth: Record<string, number>;
    balanceByMonth: Record<string, number>;
    totalCredit: number;
    totalDebit: number;
    totalTransferIn: number;
    totalTransferOut: number;
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

  // Cache of every account's display data — used to resolve transfer
  // counterparties below (which may live at accounts NOT in the
  // operator's current filter, e.g. archived ones).
  const allAccountsRows = (await db.all(sql`
    SELECT id, name, color FROM accounts
  `)) as Array<{ id: string; name: string; color: string }>;
  const accountNameById = new Map(
    allAccountsRows.map((a) => [a.id, { name: a.name, color: a.color }]),
  );

  if (accountRows.length === 0) {
    return NextResponse.json({
      months,
      accounts: [],
      totals: {
        creditByMonth: Object.fromEntries(months.map((m) => [m, 0])),
        debitByMonth: Object.fromEntries(months.map((m) => [m, 0])),
        transferInByMonth: Object.fromEntries(months.map((m) => [m, 0])),
        transferOutByMonth: Object.fromEntries(months.map((m) => [m, 0])),
        balanceByMonth: Object.fromEntries(months.map((m) => [m, 0])),
        totalCredit: 0,
        totalDebit: 0,
        totalTransferIn: 0,
        totalTransferOut: 0,
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
  // (amount < 0), plus the transfer subset of each (categorised
  // 'internal' or 'external'). Transfers are intentionally included
  // in the overall credit/debit totals — from a single-account
  // perspective every transfer is real cashflow on both legs; the
  // separate transfer rows let the operator see which slice of the
  // credit/debit came from moving money between own accounts.
  const monthRows = (await db.all(sql`
    SELECT
      t.account_id                                                                                                        AS account_id,
      substr(t.date, 1, 7)                                                                                                 AS month,
      CAST(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS REAL)                                                   AS credit,
      CAST(SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END) AS REAL)                                                   AS debit,
      CAST(SUM(CASE WHEN t.amount > 0 AND c.transfer_kind IN ('internal','external') THEN t.amount ELSE 0 END) AS REAL)    AS transfer_in,
      CAST(SUM(CASE WHEN t.amount < 0 AND c.transfer_kind IN ('internal','external') THEN t.amount ELSE 0 END) AS REAL)    AS transfer_out
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ${from} AND t.date <= ${to}
      AND t.account_id IN (${idList})
    GROUP BY t.account_id, substr(t.date, 1, 7)
  `)) as Array<{
    account_id: string;
    month: string;
    credit: number;
    debit: number;
    transfer_in: number;
    transfer_out: number;
  }>;

  const byAccount = new Map<
    string,
    {
      credit: Map<string, number>;
      debit: Map<string, number>;
      transferIn: Map<string, number>;
      transferOut: Map<string, number>;
    }
  >();
  for (const id of accountIds) {
    byAccount.set(id, {
      credit: new Map(),
      debit: new Map(),
      transferIn: new Map(),
      transferOut: new Map(),
    });
  }
  for (const r of monthRows) {
    const slot = byAccount.get(r.account_id);
    if (!slot) continue;
    slot.credit.set(r.month, Number(r.credit) || 0);
    slot.debit.set(r.month, Math.abs(Number(r.debit) || 0));
    slot.transferIn.set(r.month, Number(r.transfer_in) || 0);
    slot.transferOut.set(r.month, Math.abs(Number(r.transfer_out) || 0));
  }

  // Per-account × month × counterparty breakdown for transfers only.
  // The "counterparty" is the other leg's account_id (joined via
  // transfer_pair_id). External / unpaired transfers (no transfer
  // pair recorded) come through with counterparty_id = NULL — we
  // bucket them under a synthetic "external" key in the JS
  // aggregation so the UI can render them as a separate row.
  const transferRows = (await db.all(sql`
    SELECT
      t.account_id                                                            AS account_id,
      substr(t.date, 1, 7)                                                    AS month,
      pair.account_id                                                          AS counterparty_id,
      CAST(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS REAL)       AS in_amount,
      CAST(SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END) AS REAL)       AS out_amount
    FROM transactions t
    LEFT JOIN transactions pair ON pair.id = t.transfer_pair_id
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ${from} AND t.date <= ${to}
      AND t.account_id IN (${idList})
      AND c.transfer_kind IN ('internal', 'external')
    GROUP BY t.account_id, substr(t.date, 1, 7), pair.account_id
  `)) as Array<{
    account_id: string;
    month: string;
    counterparty_id: string | null;
    in_amount: number;
    out_amount: number;
  }>;

  // accountId → counterpartyKey → { byMonth, total } for in / out
  // separately. counterpartyKey is the actual id when known, or the
  // sentinel "(external)" when the pair is missing.
  const EXTERNAL_KEY = "(external)";
  const counterpartyAgg = new Map<
    string,
    {
      in: Map<string, { byMonth: Map<string, number>; total: number }>;
      out: Map<string, { byMonth: Map<string, number>; total: number }>;
    }
  >();
  for (const id of accountIds) {
    counterpartyAgg.set(id, { in: new Map(), out: new Map() });
  }
  function bumpCp(
    side: "in" | "out",
    accountId: string,
    counterpartyKey: string,
    month: string,
    amount: number,
  ) {
    const slot = counterpartyAgg.get(accountId);
    if (!slot) return;
    let cp = slot[side].get(counterpartyKey);
    if (!cp) {
      cp = { byMonth: new Map(), total: 0 };
      slot[side].set(counterpartyKey, cp);
    }
    cp.byMonth.set(month, (cp.byMonth.get(month) ?? 0) + amount);
    cp.total += amount;
  }
  for (const r of transferRows) {
    const key = r.counterparty_id ?? EXTERNAL_KEY;
    const inAmt = Number(r.in_amount) || 0;
    const outAmt = Math.abs(Number(r.out_amount) || 0);
    if (inAmt > 0) bumpCp("in", r.account_id, key, r.month, inAmt);
    if (outAmt > 0) bumpCp("out", r.account_id, key, r.month, outAmt);
  }

  const totals = {
    creditByMonth: Object.fromEntries(months.map((m) => [m, 0])),
    debitByMonth: Object.fromEntries(months.map((m) => [m, 0])),
    transferInByMonth: Object.fromEntries(months.map((m) => [m, 0])),
    transferOutByMonth: Object.fromEntries(months.map((m) => [m, 0])),
    balanceByMonth: Object.fromEntries(months.map((m) => [m, 0])),
    totalCredit: 0,
    totalDebit: 0,
    totalTransferIn: 0,
    totalTransferOut: 0,
    closingBalance: 0,
  };

  const accounts: AccountsCashflowAccount[] = accountRows.map((a) => {
    const slot = byAccount.get(a.id);
    const startingBalance =
      Number(a.starting_balance || 0) + (openingByAccount.get(a.id) ?? 0);
    const creditByMonth: Record<string, number> = {};
    const debitByMonth: Record<string, number> = {};
    const transferInByMonth: Record<string, number> = {};
    const transferOutByMonth: Record<string, number> = {};
    const balanceByMonth: Record<string, number> = {};
    let running = startingBalance;
    let totalCredit = 0;
    let totalDebit = 0;
    let totalTransferIn = 0;
    let totalTransferOut = 0;
    for (const m of months) {
      const cr = slot?.credit.get(m) ?? 0;
      const dr = slot?.debit.get(m) ?? 0;
      const ti = slot?.transferIn.get(m) ?? 0;
      const to_ = slot?.transferOut.get(m) ?? 0;
      creditByMonth[m] = cr;
      debitByMonth[m] = dr;
      transferInByMonth[m] = ti;
      transferOutByMonth[m] = to_;
      running = running + cr - dr;
      balanceByMonth[m] = Math.round(running * 100) / 100;
      totalCredit += cr;
      totalDebit += dr;
      totalTransferIn += ti;
      totalTransferOut += to_;
      totals.creditByMonth[m] = (totals.creditByMonth[m] ?? 0) + cr;
      totals.debitByMonth[m] = (totals.debitByMonth[m] ?? 0) + dr;
      totals.transferInByMonth[m] = (totals.transferInByMonth[m] ?? 0) + ti;
      totals.transferOutByMonth[m] = (totals.transferOutByMonth[m] ?? 0) + to_;
      totals.balanceByMonth[m] = (totals.balanceByMonth[m] ?? 0) + balanceByMonth[m];
    }
    const closingBalance = balanceByMonth[months[months.length - 1]] ?? startingBalance;
    totals.totalCredit += totalCredit;
    totals.totalDebit += totalDebit;
    totals.totalTransferIn += totalTransferIn;
    totals.totalTransferOut += totalTransferOut;
    totals.closingBalance += closingBalance;

    // Materialise the counterparty Maps into the public shape:
    // a sorted array (descending by total) where each entry knows
    // the other account's display name. Missing counterparties get
    // the "(external)" sentinel resolved to "External".
    const cpSlot = counterpartyAgg.get(a.id);
    function materialiseCp(
      side: "in" | "out",
    ): TransferCounterpartyBreakdown[] {
      const rows: TransferCounterpartyBreakdown[] = [];
      const map = cpSlot ? cpSlot[side] : new Map();
      for (const [key, agg] of map) {
        const isExternal = key === EXTERNAL_KEY;
        const meta = isExternal ? null : accountNameById.get(key);
        const byMonth: Record<string, number> = {};
        for (const m of months) byMonth[m] = agg.byMonth.get(m) ?? 0;
        rows.push({
          counterpartyId: isExternal ? null : key,
          counterpartyName: meta?.name ?? "External",
          counterpartyColor: meta?.color ?? null,
          byMonth,
          total: Math.round(agg.total * 100) / 100,
        });
      }
      rows.sort((x, y) => y.total - x.total);
      return rows;
    }

    return {
      id: a.id,
      name: a.name,
      color: a.color,
      type: a.type,
      startingBalance: Math.round(startingBalance * 100) / 100,
      creditByMonth,
      debitByMonth,
      transferInByMonth,
      transferOutByMonth,
      transferInBy: materialiseCp("in"),
      transferOutBy: materialiseCp("out"),
      balanceByMonth,
      totalCredit: Math.round(totalCredit * 100) / 100,
      totalDebit: Math.round(totalDebit * 100) / 100,
      totalTransferIn: Math.round(totalTransferIn * 100) / 100,
      totalTransferOut: Math.round(totalTransferOut * 100) / 100,
      closingBalance,
    };
  });

  return NextResponse.json({
    months,
    accounts,
    totals,
  } satisfies AccountsCashflowReport);
}
