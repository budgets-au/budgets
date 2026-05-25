import { NextResponse } from "next/server";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { sql } from "drizzle-orm";
import { withAuth } from "@/lib/api/route-guards";

/** GET /api/transactions/date-range — earliest and latest
 *  transaction dates in the ledger. Used by the reports range
 *  popover to seed an "All" preset bounded by real data (an
 *  unbounded "All" would force the report endpoints' monthly
 *  generators to enumerate hundreds of empty buckets back to
 *  whatever sentinel was used). */
export const GET = withAuth(async () => {
  const [row] = await db
    .select({
      minDate: sql<string | null>`MIN(${transactions.date})`,
      maxDate: sql<string | null>`MAX(${transactions.date})`,
    })
    .from(transactions);
  return NextResponse.json({
    minDate: row?.minDate ?? null,
    maxDate: row?.maxDate ?? null,
  });
});
