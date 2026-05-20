import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/route-guards";
import { getRecentTransactions } from "@/lib/dashboard/recent-transactions";

/** Latest 50 posted transactions across non-archived accounts.
 * The client widget slices to whatever fits the card's height; the
 * generous server cap lets a generously-sized card show many rows
 * without a second round-trip. */
export const GET = withAuth(async () => {
  return NextResponse.json(await getRecentTransactions());
});
