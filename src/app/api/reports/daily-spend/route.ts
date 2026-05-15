import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";

/** GET /api/reports/daily-spend
 *
 * Returns one row per calendar day in `[from..to]` that has at
 * least one matching transaction:
 *   { date: "YYYY-MM-DD", total, count }
 * `total` is the SUM of absolute amounts — both income and
 * expenses contribute positively because the daily-heatmap is a
 * "how much money moved that day" view, not a net-cashflow one.
 *
 * Query params (all optional):
 *   from, to           — date range
 *   accountIds         — comma-separated UUIDs (default = all non-archived)
 *   hideTransfers      — "true" to drop transfer-kind categories
 *
 * SQL mirrors the cashflow route's `accountFilter` + UUID guard
 * pattern so the same security posture applies. */
export async function GET(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? "9999-12-31";
  const hideTransfers = searchParams.get("hideTransfers") === "true";

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

  const rows = await db.all(sql`
    SELECT
      t.date                          AS date,
      CAST(SUM(ABS(t.amount)) AS REAL) AS total,
      COUNT(*)                        AS count
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ${from}
      AND t.date <= ${to}
      ${accountFilter}
      ${transferFilter}
    GROUP BY t.date
    ORDER BY t.date ASC
  `);

  const days = (rows as { date: string; total: number; count: number }[]).map(
    (r) => ({
      date: r.date,
      total: Number(r.total) ?? 0,
      count: Number(r.count) ?? 0,
    }),
  );

  return NextResponse.json({ days });
}
