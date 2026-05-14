import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRecentTransactions } from "@/lib/dashboard/recent-transactions";

/** Latest 50 posted transactions across non-archived accounts.
 * The client widget slices to whatever fits the card's height; the
 * generous server cap lets a generously-sized card show many rows
 * without a second round-trip. */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await getRecentTransactions());
}
