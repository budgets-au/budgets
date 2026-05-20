import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/route-guards";
import { getInvestmentTrend } from "@/lib/dashboard/stocks-trend";

/** Aggregate daily value of every owned stock position for the
 * dashboard Stocks card's sparkline. `?range=1m|3m|1y` (defaults
 * to 1m). Sources cached closes from `investment_prices`; if the
 * cache is empty the series is empty and the card falls back to
 * its number-only display. */
export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") ?? "1m";
  return NextResponse.json(await getInvestmentTrend("stock", range));
});
