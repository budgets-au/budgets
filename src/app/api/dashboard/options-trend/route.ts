import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/route-guards";
import { getInvestmentTrend } from "@/lib/dashboard/stocks-trend";

/** Aggregate daily value of every owned option position for the
 * dashboard Options card's sparkline. `?range=1m|3m|1y` (defaults
 * to 1m). Same shape as `stocks-trend` — see that file for the
 * forward-fill semantics and the multi-currency caveat. */
export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") ?? "1m";
  return NextResponse.json(await getInvestmentTrend("option", range));
});
