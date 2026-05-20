import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { accountIdSql, parseAccountIds } from "@/lib/api/account-ids";
import { withAuth } from "@/lib/api/route-guards";

/** GET /api/reports/payee-totals
 *
 * Top-N payees by absolute spend in `[from..to]`:
 *   { rows: { payee, total, count }[], otherTotal, otherCount }
 *
 * Payees with no name (null or empty) are bucketed as "(no payee)"
 * — they still get an entry rather than being dropped, so the
 * Pareto cumulative-% adds to 100. `otherTotal` / `otherCount`
 * capture everything past the limit so the visualisation can
 * show "the long tail accounts for $X".
 *
 * `?kind=expense|income|all` filters by the row's category type;
 * uncategorised rows are included only on `all`. */
export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? "1970-01-01";
  const to = searchParams.get("to") ?? "9999-12-31";
  const hideTransfers = searchParams.get("hideTransfers") === "true";
  const limitRaw = Number(searchParams.get("limit") ?? 25);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw < 200
    ? Math.floor(limitRaw)
    : 25;
  const kindParam = searchParams.get("kind") ?? "expense";
  const kind: "expense" | "income" | "all" =
    kindParam === "income" || kindParam === "all" ? kindParam : "expense";

  const accountIds = parseAccountIds(searchParams);
  const { accountFilterT: accountFilter } = accountIdSql(accountIds);
  // Internal transfers between own accounts aren't useful in a
  // payee Pareto — the "payee" is just the other account. Always
  // exclude. External transfers (real outflow) stay.
  const transferFilter = hideTransfers
    ? sql`AND (c.transfer_kind IS NULL OR c.transfer_kind = 'none')`
    : sql`AND (c.transfer_kind IS NULL OR c.transfer_kind != 'internal')`;
  const kindFilter =
    kind === "expense"
      ? sql`AND c.type = 'expense'`
      : kind === "income"
        ? sql`AND c.type = 'income'`
        : sql``;

  const raw = (await db.all(sql`
    SELECT
      COALESCE(NULLIF(TRIM(t.payee), ''), '(no payee)') AS payee,
      CAST(SUM(ABS(t.amount)) AS REAL)                  AS total,
      COUNT(*)                                           AS count
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ${from}
      AND t.date <= ${to}
      ${accountFilter}
      ${transferFilter}
      ${kindFilter}
    GROUP BY payee
    ORDER BY total DESC
  `)) as Array<{ payee: string; total: number; count: number }>;

  const all = raw.map((r) => ({
    payee: r.payee,
    total: Number(r.total) ?? 0,
    count: Number(r.count) ?? 0,
  }));
  const top = all.slice(0, limit);
  const rest = all.slice(limit);
  const otherTotal = rest.reduce((s, r) => s + r.total, 0);
  const otherCount = rest.reduce((s, r) => s + r.count, 0);

  return NextResponse.json({
    rows: top,
    otherTotal,
    otherCount,
  });
});
