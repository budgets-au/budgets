import { NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, categories } from "@/db/schema";
import { and, gte, lte, eq, sql, inArray, ne } from "drizzle-orm";
import { withAuth } from "@/lib/api/route-guards";
import { parseDateRange } from "@/lib/api/date-range";

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  // Issue #51: shared range-validation gate. Was previously taking
  // raw strings into `gte(transactions.date, from)`, which a hostile
  // `?from=banana&to=zzzz` quietly accepted as lexicographic
  // comparison (matched everything). Also caps the range at 12y.
  const range = parseDateRange(searchParams);
  if (!range.ok) return range.response;
  const { from, to } = range;
  const groupBy = searchParams.get("groupBy") ?? "category"; // category | month
  const accountIds = searchParams.get("accountIds")?.split(",").filter(Boolean);
  const hideTransfers = searchParams.get("hideTransfers") === "true";

  const conditions = [];
  conditions.push(gte(transactions.date, from));
  conditions.push(lte(transactions.date, to));
  // When the user picks accounts, scope to those. Otherwise default to
  // non-archived accounts only — archived accounts are hidden in the UI
  // and shouldn't be silently included in an "All accounts" total.
  if (accountIds?.length) {
    conditions.push(inArray(transactions.accountId, accountIds));
  } else {
    conditions.push(
      sql`${transactions.accountId} IN (SELECT id FROM accounts WHERE is_archived = false)`,
    );
  }

  if (groupBy === "month") {
    const monthConditions = [...conditions];
    if (hideTransfers) monthConditions.push(
      sql`(${transactions.categoryId} IS NULL OR EXISTS (
        SELECT 1 FROM categories c WHERE c.id = ${transactions.categoryId} AND c.transfer_kind != 'internal'
      ))`
    );

    const rows = await db
      .select({
        month: sql<string>`substr(${transactions.date}, 1, 7)`,
        income: sql<string>`COALESCE(SUM(CASE WHEN CAST(${transactions.amount} AS REAL) > 0 THEN CAST(${transactions.amount} AS REAL) ELSE 0 END), 0)`,
        expenses: sql<string>`COALESCE(SUM(CASE WHEN CAST(${transactions.amount} AS REAL) < 0 THEN ABS(CAST(${transactions.amount} AS REAL)) ELSE 0 END), 0)`,
        net: sql<string>`COALESCE(SUM(CAST(${transactions.amount} AS REAL)), 0)`,
      })
      .from(transactions)
      .where(monthConditions.length ? and(...monthConditions) : undefined)
      .groupBy(sql`substr(${transactions.date}, 1, 7)`)
      .orderBy(sql`substr(${transactions.date}, 1, 7)`);

    return NextResponse.json(rows);
  }

  // Group by category
  if (hideTransfers) conditions.push(
    sql`(${transactions.categoryId} IS NULL OR ${categories.transferKind} != 'internal')`
  );

  // Net total in the category's direction. The CASE mirrors
  // `categorySignMultiplier` in src/lib/reports-aggregation.ts:
  //   income → SUM(amount)        (reversals reduce)
  //   else   → -SUM(amount)       (refunds reduce a spending category)
  // Without this the report inflates refunded spend by twice the
  // refund amount and the pie chart over-weights categories where
  // money round-trips. Order BY uses the same expression so the
  // sort and the displayed value stay in sync.
  const netTotal = sql<string>`COALESCE(SUM(CAST(${transactions.amount} AS REAL) * CASE WHEN ${categories.type} = 'income' THEN 1 ELSE -1 END), 0)`;

  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      categoryType: categories.type,
      categoryParentId: categories.parentId,
      total: netTotal,
      count: sql<string>`COUNT(*)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(
      transactions.categoryId,
      categories.name,
      categories.color,
      categories.type,
      categories.parentId
    )
    .orderBy(sql`${netTotal} DESC`);

  return NextResponse.json(rows);
});
