import { NextResponse } from "next/server";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { sql, eq } from "drizzle-orm";
import { categoryDescendantIds } from "@/lib/category-descendants";
import { accountIdSql, parseAccountIds } from "@/lib/api/account-ids";
import { withAuth } from "@/lib/api/route-guards";

/** Per-period trend for a single category (or its whole subtree).
 *
 *  Fed by the "Category trend" report on /reports. The client sends a
 *  categoryId + a group-by granularity + the standard from/to window
 *  and gets back one row per period with the total amount and
 *  transaction count. Descendants of the selected category are
 *  aggregated by default — pick a grandparent to see its subtree
 *  roll up, pick a leaf to see just that line.
 *
 *  `total` is signed: expense categories return negative totals,
 *  income categories return positive. The chart plots absolute
 *  values so a rising line reads as rising spend regardless of side. */
export interface CategoryTrendResponse {
  categoryId: string;
  categoryName: string;
  categoryType: "income" | "expense" | null;
  groupBy: "day" | "week" | "month" | "year";
  periods: Array<{
    period: string;
    total: number;
    count: number;
  }>;
}

const GROUP_BY_VALUES = ["day", "week", "month", "year"] as const;
type GroupBy = (typeof GROUP_BY_VALUES)[number];

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const categoryId = searchParams.get("categoryId");
  if (!categoryId) {
    return NextResponse.json({ error: "categoryId is required" }, { status: 400 });
  }
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!from || !to || !ISO_RE.test(from) || !ISO_RE.test(to)) {
    return NextResponse.json({ error: "from / to must be YYYY-MM-DD" }, { status: 400 });
  }
  if (Date.parse(from) > Date.parse(to)) {
    return NextResponse.json({ error: "from must be <= to" }, { status: 400 });
  }
  const groupByRaw = searchParams.get("groupBy") ?? "month";
  const groupBy: GroupBy = (GROUP_BY_VALUES as readonly string[]).includes(groupByRaw)
    ? (groupByRaw as GroupBy)
    : "month";

  const accountIds = parseAccountIds(searchParams);
  const { accountFilterT } = accountIdSql(accountIds);

  // Category metadata lookup — verifies the id exists and gives us
  // the display name + type for the response header.
  const [meta] = await db
    .select({
      id: categories.id,
      name: categories.name,
      type: categories.type,
    })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  if (!meta) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  // Walk the tree — include the selected category and every
  // descendant. Matches the semantics every other category-scoped
  // report uses (Cashflow, Envelope, etc.) so parent selections feel
  // consistent across the app.
  const catIds = await categoryDescendantIds(categoryId);
  const idListSql = sql.join(catIds.map((id) => sql`${id}`), sql`, `);

  // Period bucket — computed via substr / strftime on the ISO date
  // column. sqlite's `strftime('%Y-W%W', date)` gives a stable
  // "YYYY-WNN" week key; a week that straddles a year end reports
  // the number of the year containing its Sunday, which matches
  // strftime's own convention. Day / month / year are direct
  // substrings — deterministic and cheap.
  const periodExpr =
    groupBy === "day"
      ? sql`substr(date, 1, 10)`
      : groupBy === "week"
        ? sql`strftime('%Y-W%W', date)`
        : groupBy === "month"
          ? sql`substr(date, 1, 7)`
          : sql`substr(date, 1, 4)`;

  const rows = await db.all(sql`
    SELECT
      ${periodExpr}              AS period,
      CAST(SUM(amount) AS REAL) AS total,
      COUNT(id)                  AS count
    FROM transactions
    WHERE category_id IN (${idListSql})
      AND date >= ${from} AND date <= ${to}
      ${accountFilterT}
    GROUP BY period
    ORDER BY period
  `);

  const periods = (rows as unknown as Array<{
    period: string;
    total: number;
    count: number;
  }>).map((r) => ({
    period: r.period,
    total: r.total ?? 0,
    count: r.count ?? 0,
  }));

  return NextResponse.json({
    categoryId,
    categoryName: meta.name,
    categoryType: (meta.type as "income" | "expense" | null) ?? null,
    groupBy,
    periods,
  } satisfies CategoryTrendResponse);
});
