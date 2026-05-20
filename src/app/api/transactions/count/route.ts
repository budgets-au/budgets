import { NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, accounts, categories } from "@/db/schema";
import { eq, and, gte, lte, like, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { categoryDescendantIds } from "@/lib/category-descendants";
import { withAuth } from "@/lib/api/route-guards";

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const categoryId = searchParams.get("categoryId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const search = searchParams.get("search");
  const transfersFilterRaw = searchParams.get("transfersFilter");
  const transfersFilter: "only" | "none" | null =
    transfersFilterRaw === "only" || transfersFilterRaw === "none"
      ? transfersFilterRaw
      : searchParams.get("transfersOnly") === "true"
        ? "only"
        : null;
  const includeChildren = searchParams.get("includeChildren") === "true";

  const accountIdsRaw = searchParams.get("accountIds");
  const accountIdsList = accountIdsRaw
    ? accountIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const conditions = [];
  if (accountId) {
    conditions.push(eq(transactions.accountId, accountId));
  } else if (accountIdsList.length > 0) {
    conditions.push(inArray(transactions.accountId, accountIdsList));
  } else {
    // Match the list endpoint: empty filter = visible (non-archived)
    // accounts only, so the row count agrees with what the table shows.
    conditions.push(
      sql`${transactions.accountId} IN (SELECT id FROM accounts WHERE is_archived = false)`,
    );
  }
  if (categoryId) {
    if (includeChildren) {
      const ids = await categoryDescendantIds(categoryId);
      conditions.push(
        ids.length > 1
          ? inArray(transactions.categoryId, ids)
          : eq(transactions.categoryId, ids[0] ?? categoryId),
      );
    } else {
      conditions.push(eq(transactions.categoryId, categoryId));
    }
  }
  if (from) conditions.push(gte(transactions.date, from));
  if (to) conditions.push(lte(transactions.date, to));
  if (search) conditions.push(like(transactions.payee, `%${search}%`));
  if (transfersFilter === "only") {
    conditions.push(isNotNull(transactions.transferPairId));
  } else if (transfersFilter === "none") {
    conditions.push(isNull(transactions.transferPairId));
  }

  const direction = searchParams.get("direction");
  if (direction === "out") conditions.push(sql`CAST(${transactions.amount} AS REAL) < 0`);
  else if (direction === "in") conditions.push(sql`CAST(${transactions.amount} AS REAL) > 0`);

  const [row] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(conditions.length ? and(...conditions) : undefined);

  return NextResponse.json({ total: row?.total ?? 0 });
});
