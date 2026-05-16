import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { categoryDescendantIds } from "@/lib/category-descendants";

const MAX_POINTS = 5_000;

/** GET /api/reports/transactions-points
 *
 * Returns one row per transaction in `[from..to]`, intended for
 * the scatter-report's dot plot:
 *   { id, date, amount, categoryId, categoryName, categoryColor }
 *
 * `amount` is the absolute value (sign is implicit from `kind`).
 *
 * Hard cap at MAX_POINTS so a multi-year request doesn't ship 50k
 * rows over the wire. `capped: true` in the response lets the UI
 * surface a warning. The cap drops the OLDEST rows first — the
 * recent end of the window is usually what the operator cares
 * about.
 *
 * `?kind=expense|income|all` filters by category type
 * (uncategorised rows are included only on `all`). */
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
  const kind: "expense" | "income" | "all" =
    kindParam === "income" || kindParam === "all" ? kindParam : "expense";

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
  const transferFilter = hideTransfers
    ? sql`AND (c.transfer_kind IS NULL OR c.transfer_kind = 'none')`
    : sql``;
  const kindFilter =
    kind === "expense"
      ? sql`AND c.type = 'expense'`
      : kind === "income"
        ? sql`AND c.type = 'income'`
        : sql``;

  // Optional drill-down: restrict to a category root + descendants.
  // Walks the parent → children adjacency once via the shared
  // helper so the SQL just gets a flat IN-list.
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

  const rows = await db.all(sql`
    SELECT
      t.id                            AS id,
      t.date                          AS date,
      CAST(ABS(t.amount) AS REAL)     AS amount,
      c.id                            AS category_id,
      c.name                          AS category_name,
      c.color                         AS category_color
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ${from}
      AND t.date <= ${to}
      ${accountFilter}
      ${transferFilter}
      ${kindFilter}
      ${categoryFilter}
    ORDER BY t.date DESC
    LIMIT ${MAX_POINTS + 1}
  `);

  const raw = rows as Array<{
    id: string;
    date: string;
    amount: number;
    category_id: string | null;
    category_name: string | null;
    category_color: string | null;
  }>;
  const capped = raw.length > MAX_POINTS;
  const points = raw.slice(0, MAX_POINTS).map((r) => ({
    id: r.id,
    date: r.date,
    amount: Number(r.amount) ?? 0,
    categoryId: r.category_id,
    categoryName: r.category_name,
    categoryColor: r.category_color,
  }));

  return NextResponse.json({ points, capped });
}
