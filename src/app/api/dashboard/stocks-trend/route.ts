import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getStocksTrend } from "@/lib/dashboard/stocks-trend";

/** Aggregate daily value of every owned stock position for the
 * dashboard Stocks card's sparkline. `?range=1m|3m|1y` (defaults
 * to 1m). Sources cached closes from `investment_prices`; if the
 * cache is empty the series is empty and the card falls back to
 * its number-only display. */
export async function GET(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") ?? "1m";
  return NextResponse.json(await getStocksTrend(range));
}
