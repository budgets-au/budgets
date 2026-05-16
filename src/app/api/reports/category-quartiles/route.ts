import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { fiveNumberSummary } from "@/lib/reports/quartiles";
import { categoryDescendantIds } from "@/lib/category-descendants";

/** GET /api/reports/category-quartiles
 *
 * For each leaf category (no children that themselves have
 * transactions in window), returns the five-number summary of
 * absolute transaction amounts plus the outliers list:
 *
 *   { rows: { categoryId, categoryName, categoryColor, min, q1,
 *             median, q3, max, outliers: number[], n }[] }
 *
 * SQLite has no `PERCENTILE_CONT`, so we SELECT the amounts and
 * compute the five-number summary in Node. For a typical
 * household budget (thousands of rows) this is negligible vs the
 * SQL round-trip. */
export async function GET(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? "9999-12-31";
  const hideTransfers = searchParams.get("hideTransfers") === "true";
  const kindParam = searchParams.get("kind") ?? "expense";
  const kind: "expense" | "income" =
    kindParam === "income" ? "income" : "expense";

  const accountIdsRaw = searchParams.get("accountIds");
  const accountIdsAll = accountIdsRaw
    ? accountIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const accountIds = accountIdsAll.filter((id) => UUID_RE.test(id));
  const idList = sql.join(
    accountIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const accountFilter =
    accountIds.length > 0
      ? sql`AND t.account_id IN (${idList})`
      : sql`AND t.account_id IN (SELECT id FROM accounts WHERE is_archived = 0)`;
  // Internal transfers (own-account moves) aren't real spending so
  // we always exclude them from the box-plot's per-category
  // distribution; external transfers (CC payoff, etc.) stay.
  const transferFilter = hideTransfers
    ? sql`AND (c.transfer_kind IS NULL OR c.transfer_kind = 'none')`
    : sql`AND (c.transfer_kind IS NULL OR c.transfer_kind != 'internal')`;

  // Optional drill-down: restrict to a root category + descendants
  // so the operator can zoom into one branch of the hierarchy
  // without losing the box-plot's per-category breakdown for the
  // remaining sub-categories.
  const rootCategoryId = searchParams.get("rootCategoryId");
  let categoryFilter = sql``;
  if (rootCategoryId && UUID_RE.test(rootCategoryId)) {
    const subtree = await categoryDescendantIds(rootCategoryId);
    if (subtree.length > 0) {
      const subList = sql.join(
        subtree.map((id) => sql`${id}`),
        sql`, `,
      );
      categoryFilter = sql`AND t.category_id IN (${subList})`;
    }
  }

  // Pull every (categoryId, amount) pair in window, group in Node.
  const raw = (await db.all(sql`
    SELECT
      c.id                          AS category_id,
      c.name                        AS category_name,
      c.color                       AS category_color,
      CAST(ABS(t.amount) AS REAL)   AS amount
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ${from}
      AND t.date <= ${to}
      AND c.type = ${kind}
      ${accountFilter}
      ${transferFilter}
      ${categoryFilter}
  `)) as Array<{
    category_id: string;
    category_name: string;
    category_color: string;
    amount: number;
  }>;

  const grouped = new Map<
    string,
    { name: string; color: string; values: number[] }
  >();
  for (const r of raw) {
    const g = grouped.get(r.category_id);
    if (g) {
      g.values.push(Number(r.amount));
    } else {
      grouped.set(r.category_id, {
        name: r.category_name,
        color: r.category_color,
        values: [Number(r.amount)],
      });
    }
  }

  const rows = Array.from(grouped.entries()).map(([id, g]) => {
    const s = fiveNumberSummary(g.values);
    return {
      categoryId: id,
      categoryName: g.name,
      categoryColor: g.color,
      ...s,
    };
  });
  // Sort by median descending so the most spend-heavy categories
  // sit at the top of the chart.
  rows.sort((a, b) => b.median - a.median);

  return NextResponse.json({ rows });
}
