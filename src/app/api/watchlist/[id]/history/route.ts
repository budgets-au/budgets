import { NextResponse } from "next/server";
import { db } from "@/db";
import { watchlist } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getDailyHistory, persistPriceCache } from "@/lib/investments/yahoo";
import { withAuthAndId } from "@/lib/api/route-guards";

interface PricePoint {
  date: string;
  close: number;
}

interface DividendEvent {
  date: string;
  perShare: number;
}

const RANGE_DAYS: Record<string, number> = {
  "1m": 31,
  "3m": 92,
  "1y": 366,
  "5y": 366 * 5,
  all: 366 * 20,
};

export const GET = withAuthAndId(async (id, request) => {
  const [row] = await db
    .select()
    .from(watchlist)
    .where(eq(watchlist.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const rangeParam = searchParams.get("range") ?? "1y";
  const rangeDays = RANGE_DAYS[rangeParam] ?? RANGE_DAYS["1y"];
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - rangeDays * 24 * 60 * 60 * 1000);

  let closes: PricePoint[] = [];
  let dividends: DividendEvent[] = [];
  try {
    const hist = await getDailyHistory(row.symbol, fromDate, toDate);
    closes = hist.closes;
    dividends = hist.dividends.map((d) => ({ date: d.date, perShare: d.amount }));
    void persistPriceCache(row.symbol, hist.closes);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "History fetch failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({ series: closes, dividends });
});
