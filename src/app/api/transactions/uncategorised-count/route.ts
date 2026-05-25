import { NextResponse } from "next/server";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { isNull, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api/route-guards";

/** GET /api/transactions/uncategorised-count — cheap count of rows
 *  where category_id IS NULL. The /transactions topbar's
 *  "Categorise (N)" badge fetches this instead of the full
 *  `uncategorised-categorise` endpoint, which builds trigram
 *  suggestions for every uncategorised row and is wasted work when
 *  the caller only wants the badge count. */
export const GET = withAuth(async () => {
  const [row] = await db
    .select({ count: sql<number>`count(*)`.as("count") })
    .from(transactions)
    .where(isNull(transactions.categoryId));
  return NextResponse.json({ count: Number(row?.count ?? 0) });
});
