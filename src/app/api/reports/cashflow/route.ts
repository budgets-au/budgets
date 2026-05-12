import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { scheduledTransactions, categories } from "@/db/schema";
import { sql, and, eq, ne, isNotNull, gte, lte, inArray, or, isNull } from "drizzle-orm";
import { format, startOfMonth, endOfMonth, subMonths, addMonths, parseISO } from "date-fns";
import { expandRecurrence } from "@/lib/recurrence";

export interface CashflowCategory {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  grandparentId: string | null;
  grandparentName: string | null;
  type: "income" | "expense";
  byMonth: Record<string, number>; // "YYYY-MM" → amount
  countByMonth: Record<string, number>; // "YYYY-MM" → transaction count
  total: number;
  totalCount: number;
  budgetPerMonth: number;    // monthly-normalised budget (0 if no budget)
  scheduledPerMonth: number; // monthly-normalised scheduled amount (0 if none)
  budgetByMonth: Record<string, number>;    // per-month allocation (uniform from monthly-normalised budget)
  scheduledByMonth: Record<string, number>; // sum of expanded scheduled occurrences per month
}

export interface CashflowReport {
  months: string[]; // ["2026-01", "2026-02", ...]
  income: CashflowCategory[];
  expenses: CashflowCategory[];
  totals: {
    income: Record<string, number>;
    expenses: Record<string, number>;
    net: Record<string, number>;
  };
  closingBalance: Record<string, number>;
  openingBalance: number;
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

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const from = searchParams.get("from") ?? format(startOfMonth(subMonths(now, 5)), "yyyy-MM-dd");
  const to = searchParams.get("to") ?? format(endOfMonth(now), "yyyy-MM-dd");
  const hideTransfers = searchParams.get("hideTransfers") === "true";

  const accountIdsRaw = searchParams.get("accountIds");
  const accountIdsAll = accountIdsRaw
    ? accountIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  // UUID-shape guard so the filter can only ever contain canonical UUIDs;
  // prevents any malformed input from sneaking into the SQL fragments below.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const accountIds = accountIdsAll.filter((id) => UUID_RE.test(id));
  // Apply the same accountIds filter to every transactions sub-query below.
  // Each id is bound as its own parameter via sql.join — no string concat.
  // When the user hasn't picked any accounts, default to non-archived
  // accounts only — archived accounts are hidden in the UI and shouldn't
  // be silently included by an "All accounts" selection.
  const idList = sql.join(
    accountIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const accountFilter =
    accountIds.length > 0
      ? sql`AND account_id IN (${idList})`
      : sql`AND account_id IN (SELECT id FROM accounts WHERE is_archived = 0)`;
  const accountFilterT =
    accountIds.length > 0
      ? sql`AND t.account_id IN (${idList})`
      : sql`AND t.account_id IN (SELECT id FROM accounts WHERE is_archived = 0)`;

  const months = generateMonths(from, to);

  // SQLite stores `date` as TEXT in YYYY-MM-DD form, so substr(date, 1, 7)
  // gives the YYYY-MM bucket without needing pg's `to_char(date::date,...)`.
  // SUM/COUNT return numeric values directly under better-sqlite3 — no
  // ::float / ::int coercion needed.
  // Category × month breakdown (categorised transactions)
  const catRows = await db.all(sql`
    SELECT
      c.id                                AS category_id,
      c.name                              AS category_name,
      c.type                              AS category_type,
      p.id                                AS parent_id,
      p.name                              AS parent_name,
      gp.id                               AS grandparent_id,
      gp.name                             AS grandparent_name,
      substr(t.date, 1, 7)                AS month,
      CAST(SUM(t.amount) AS REAL)         AS total,
      COUNT(t.id)                         AS count
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    LEFT JOIN categories p ON p.id = c.parent_id
    LEFT JOIN categories gp ON gp.id = p.parent_id
    WHERE t.date >= ${from} AND t.date <= ${to}
      ${hideTransfers ? sql`AND c.transfer_kind != 'internal'` : sql``}
      ${accountFilterT}
    GROUP BY c.id, c.name, c.type, p.id, p.name, gp.id, gp.name, substr(t.date, 1, 7)
    ORDER BY c.type DESC, c.name, month
  `);

  // Uncategorised income (positive amounts, no category)
  const uncatIncome = await db.all(sql`
    SELECT
      substr(date, 1, 7)            AS month,
      CAST(SUM(amount) AS REAL)     AS total,
      COUNT(id)                     AS count
    FROM transactions
    WHERE category_id IS NULL AND CAST(amount AS REAL) > 0
      AND date >= ${from} AND date <= ${to}
      ${hideTransfers ? sql`AND is_transfer = 0` : sql``}
      ${accountFilter}
    GROUP BY substr(date, 1, 7)
  `);

  // Uncategorised expenses (negative amounts, no category)
  const uncatExpenses = await db.all(sql`
    SELECT
      substr(date, 1, 7)            AS month,
      CAST(SUM(amount) AS REAL)     AS total,
      COUNT(id)                     AS count
    FROM transactions
    WHERE category_id IS NULL AND CAST(amount AS REAL) < 0
      AND date >= ${from} AND date <= ${to}
      ${hideTransfers ? sql`AND is_transfer = 0` : sql``}
      ${accountFilter}
    GROUP BY substr(date, 1, 7)
  `);

  // Opening balance = sum of all transactions before `from`
  const [openingRow] = await db.all(sql`
    SELECT CAST(COALESCE(SUM(amount), 0) AS REAL) AS balance
    FROM transactions WHERE date < ${from}
    ${hideTransfers ? sql`AND is_transfer = 0` : sql``}
    ${accountFilter}
  `);
  const openingBalance = (openingRow as { balance: number }).balance ?? 0;

  // Monthly net for closing balance calculation
  const monthlyNets = await db.all(sql`
    SELECT
      substr(date, 1, 7)            AS month,
      CAST(SUM(amount) AS REAL)     AS net
    FROM transactions
    WHERE date >= ${from} AND date <= ${to}
    ${hideTransfers ? sql`AND is_transfer = 0` : sql``}
    ${accountFilter}
    GROUP BY substr(date, 1, 7)
  `);

  // Budgets and non-budget schedules both live in scheduled_transactions —
  // only `kind` distinguishes them. The legacy `budgets` table is no longer
  // written to by any UI (budget-progress also reads from kind='budget'
  // schedules), so it's intentionally not consulted here.
  // expandRecurrence + the per-category aggregation only need the
  // following columns. Skip amountMin / lineageId / createdAt / updatedAt
  // since cashflow doesn't use them — keeps the per-schedule payload
  // tight when a user has hundreds of recurring rows.
  // Transfer-type schedules used to be excluded outright. With the new
  // `categories.transferKind` enum we instead let any schedule with a
  // categoryId through, then skip the ones whose category is `internal`
  // (asset-to-asset moves the user doesn't want polluting the rollup).
  // `external` transfers (mortgage/loan payments) project just like a
  // normal expense.
  const allActiveSchedules = await db
    .select({
      id: scheduledTransactions.id,
      kind: scheduledTransactions.kind,
      payee: scheduledTransactions.payee,
      description: scheduledTransactions.description,
      amount: scheduledTransactions.amount,
      type: scheduledTransactions.type,
      categoryId: scheduledTransactions.categoryId,
      accountId: scheduledTransactions.accountId,
      transferToAccountId: scheduledTransactions.transferToAccountId,
      frequency: scheduledTransactions.frequency,
      interval: scheduledTransactions.interval,
      startDate: scheduledTransactions.startDate,
      endDate: scheduledTransactions.endDate,
      dayOfMonth: scheduledTransactions.dayOfMonth,
      categoryTransferKind: categories.transferKind,
    })
    .from(scheduledTransactions)
    .leftJoin(categories, eq(scheduledTransactions.categoryId, categories.id))
    .where(
      and(
        eq(scheduledTransactions.isActive, true),
        isNotNull(scheduledTransactions.categoryId),
        ne(scheduledTransactions.frequency, "once"),
        or(isNull(scheduledTransactions.endDate), gte(scheduledTransactions.endDate, from)),
        lte(scheduledTransactions.startDate, to),
        accountIds.length > 0
          ? inArray(scheduledTransactions.accountId, accountIds)
          : undefined,
      ),
    );

  // expandRecurrence walks per-occurrence dates so a quarterly/yearly schedule
  // gets its real "lumpy" shape instead of a uniform 1/3 or 1/12 per month.
  const scheduledRowsFull = allActiveSchedules.filter((s) => s.kind !== "budget");
  const budgetSchedules = allActiveSchedules.filter((s) => s.kind === "budget");

  const FREQ_MONTHLY: Record<string, number> = { daily: 365/12, weekly: 52/12, fortnightly: 26/12, monthly: 1, quarterly: 1/3, yearly: 1/12 };

  const budgetByCategory = new Map<string, number>();
  for (const b of budgetSchedules) {
    if (!b.categoryId) continue;
    const factor = (FREQ_MONTHLY[b.frequency] ?? 1) / (b.interval || 1);
    budgetByCategory.set(
      b.categoryId,
      (budgetByCategory.get(b.categoryId) ?? 0) + Math.abs(parseFloat(b.amount)) * factor,
    );
  }

  const scheduledByCategory = new Map<string, number>();
  const scheduledByCategoryByMonth = new Map<string, Record<string, number>>();
  const fromDate = parseISO(from);
  const toDate = parseISO(to);
  for (const s of scheduledRowsFull) {
    if (!s.categoryId) continue;
    // Inner transfers are net-zero by definition — don't roll their
    // projected amounts into any category's expense/income aggregate.
    if (s.categoryTransferKind === "internal") continue;
    const factor = (FREQ_MONTHLY[s.frequency] ?? 1) / (s.interval || 1);
    scheduledByCategory.set(
      s.categoryId,
      (scheduledByCategory.get(s.categoryId) ?? 0) + Math.abs(parseFloat(s.amount)) * factor,
    );
    // Expand the per-occurrence dates so a quarterly bill lands in the
    // months it actually fires, not 1/3 of the amount in every month.
    const events = expandRecurrence(s, fromDate, toDate);
    const monthMap = scheduledByCategoryByMonth.get(s.categoryId) ?? {};
    for (const e of events) {
      // Transfer schedules emit two events per occurrence (source +
      // destination). Both legs describe the same monetary movement, so
      // count only the source leg into the category's per-month bucket —
      // otherwise the Plan column shows 2× the actual amount.
      if (s.accountId && e.accountId !== s.accountId) continue;
      const month = e.date.slice(0, 7);
      monthMap[month] = (monthMap[month] ?? 0) + Math.abs(parseFloat(e.amount));
    }
    scheduledByCategoryByMonth.set(s.categoryId, monthMap);
  }
  // Budgets are constant targets — distribute the monthly-normalised amount
  // uniformly across every month in the report window.
  const budgetByCategoryByMonth = new Map<string, Record<string, number>>();
  for (const [catId, monthlyAmount] of budgetByCategory) {
    const map: Record<string, number> = {};
    for (const m of months) map[m] = monthlyAmount;
    budgetByCategoryByMonth.set(catId, map);
  }

  // --- Build category map ---
  const categoryMap = new Map<string, CashflowCategory>();

  for (const row of catRows as unknown as Array<{ category_id: string; category_name: string; category_type: string; parent_id: string | null; parent_name: string | null; grandparent_id: string | null; grandparent_name: string | null; month: string; total: number; count: number }>) {
    if (!categoryMap.has(row.category_id)) {
      categoryMap.set(row.category_id, {
        id: row.category_id,
        name: row.category_name,
        parentId: row.parent_id ?? null,
        parentName: row.parent_name ?? null,
        grandparentId: row.grandparent_id ?? null,
        grandparentName: row.grandparent_name ?? null,
        type: row.category_type as "income" | "expense",
        byMonth: {},
        countByMonth: {},
        total: 0,
        totalCount: 0,
        budgetPerMonth: budgetByCategory.get(row.category_id) ?? 0,
        scheduledPerMonth: scheduledByCategory.get(row.category_id) ?? 0,
        budgetByMonth: budgetByCategoryByMonth.get(row.category_id) ?? {},
        scheduledByMonth: scheduledByCategoryByMonth.get(row.category_id) ?? {},
      });
    }
    const cat = categoryMap.get(row.category_id)!;
    cat.byMonth[row.month] = (cat.byMonth[row.month] ?? 0) + row.total;
    cat.countByMonth[row.month] = (cat.countByMonth[row.month] ?? 0) + row.count;
    cat.total += row.total;
    cat.totalCount += row.count;
  }

  // A budget or schedule may sit on a category that has no direct
  // transactions in the window (e.g. a Food budget on the parent while only
  // Groceries/Dining Out have actuals). Inject zero-transaction rows for
  // those so buildGroups can roll the budget into the parent's header total.
  const orphanCatIds: string[] = [];
  for (const id of budgetByCategory.keys()) {
    if (!categoryMap.has(id)) orphanCatIds.push(id);
  }
  for (const id of scheduledByCategory.keys()) {
    if (!categoryMap.has(id) && !orphanCatIds.includes(id)) orphanCatIds.push(id);
  }
  if (orphanCatIds.length > 0) {
    const orphanIdList = sql.join(
      orphanCatIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const orphanMeta = await db.all(sql`
      SELECT
        c.id                        AS category_id,
        c.name                      AS category_name,
        c.type                      AS category_type,
        p.id                        AS parent_id,
        p.name                      AS parent_name,
        gp.id                       AS grandparent_id,
        gp.name                     AS grandparent_name
      FROM categories c
      LEFT JOIN categories p ON p.id = c.parent_id
      LEFT JOIN categories gp ON gp.id = p.parent_id
      WHERE c.id IN (${orphanIdList})
        ${hideTransfers ? sql`AND c.transfer_kind != 'internal'` : sql``}
    `);
    for (const row of orphanMeta as unknown as Array<{ category_id: string; category_name: string; category_type: string; parent_id: string | null; parent_name: string | null; grandparent_id: string | null; grandparent_name: string | null }>) {
      categoryMap.set(row.category_id, {
        id: row.category_id,
        name: row.category_name,
        parentId: row.parent_id ?? null,
        parentName: row.parent_name ?? null,
        grandparentId: row.grandparent_id ?? null,
        grandparentName: row.grandparent_name ?? null,
        type: row.category_type as "income" | "expense",
        byMonth: {},
        countByMonth: {},
        total: 0,
        totalCount: 0,
        budgetPerMonth: budgetByCategory.get(row.category_id) ?? 0,
        scheduledPerMonth: scheduledByCategory.get(row.category_id) ?? 0,
        budgetByMonth: budgetByCategoryByMonth.get(row.category_id) ?? {},
        scheduledByMonth: scheduledByCategoryByMonth.get(row.category_id) ?? {},
      });
    }
  }

  // Uncategorised rows
  const uncatIncomeByMonth: Record<string, number> = {};
  const uncatIncomeCountByMonth: Record<string, number> = {};
  let uncatIncomeTotal = 0;
  let uncatIncomeTotalCount = 0;
  for (const r of uncatIncome as unknown as Array<{ month: string; total: number; count: number }>) {
    uncatIncomeByMonth[r.month] = r.total;
    uncatIncomeCountByMonth[r.month] = r.count;
    uncatIncomeTotal += r.total;
    uncatIncomeTotalCount += r.count;
  }

  const uncatExpensesByMonth: Record<string, number> = {};
  const uncatExpensesCountByMonth: Record<string, number> = {};
  let uncatExpensesTotal = 0;
  let uncatExpensesTotalCount = 0;
  for (const r of uncatExpenses as unknown as Array<{ month: string; total: number; count: number }>) {
    uncatExpensesByMonth[r.month] = r.total;
    uncatExpensesCountByMonth[r.month] = r.count;
    uncatExpensesTotal += r.total;
    uncatExpensesTotalCount += r.count;
  }

  const income: CashflowCategory[] = [];
  const expenses: CashflowCategory[] = [];

  for (const cat of categoryMap.values()) {
    if (cat.type === "income") income.push(cat);
    else expenses.push(cat);
  }

  // Add uncategorised rows if they have data
  if (uncatIncomeTotal !== 0) {
    income.push({ id: "uncategorised-income", name: "Uncategorised", parentId: null, parentName: null, grandparentId: null, grandparentName: null, type: "income", byMonth: uncatIncomeByMonth, countByMonth: uncatIncomeCountByMonth, total: uncatIncomeTotal, totalCount: uncatIncomeTotalCount, budgetPerMonth: 0, scheduledPerMonth: 0, budgetByMonth: {}, scheduledByMonth: {} });
  }
  if (uncatExpensesTotal !== 0) {
    expenses.push({ id: "uncategorised-expenses", name: "Uncategorised", parentId: null, parentName: null, grandparentId: null, grandparentName: null, type: "expense", byMonth: uncatExpensesByMonth, countByMonth: uncatExpensesCountByMonth, total: uncatExpensesTotal, totalCount: uncatExpensesTotalCount, budgetPerMonth: 0, scheduledPerMonth: 0, budgetByMonth: {}, scheduledByMonth: {} });
  }

  income.sort((a, b) => a.name.localeCompare(b.name));
  expenses.sort((a, b) => a.name.localeCompare(b.name));

  // --- Totals ---
  const netByMonth: Record<string, number> = {};
  for (const r of monthlyNets as unknown as Array<{ month: string; net: number }>) {
    netByMonth[r.month] = r.net;
  }

  const incomeTotalByMonth: Record<string, number> = {};
  for (const cat of income) {
    for (const [m, v] of Object.entries(cat.byMonth)) {
      incomeTotalByMonth[m] = (incomeTotalByMonth[m] ?? 0) + v;
    }
  }

  const expensesTotalByMonth: Record<string, number> = {};
  for (const cat of expenses) {
    for (const [m, v] of Object.entries(cat.byMonth)) {
      expensesTotalByMonth[m] = (expensesTotalByMonth[m] ?? 0) + v;
    }
  }

  // --- Closing balance (cumulative) ---
  const closingBalance: Record<string, number> = {};
  let running = openingBalance;
  for (const m of months) {
    running += netByMonth[m] ?? 0;
    closingBalance[m] = running;
  }

  return NextResponse.json({
    months,
    income,
    expenses,
    totals: {
      income: incomeTotalByMonth,
      expenses: expensesTotalByMonth,
      net: netByMonth,
    },
    closingBalance,
    openingBalance,
  } satisfies CashflowReport);
}
