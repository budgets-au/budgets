import { NextResponse } from "next/server";
import { db } from "@/db";
import { investments, investmentVests } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { getDailyHistory, persistPriceCache } from "@/lib/investments/yahoo";
import { vestedQuantity, dividendsReceived } from "@/lib/investments/calc";
import { withAuthAndId } from "@/lib/api/route-guards";

interface ChartPoint {
  date: string;
  close: number;
  value: number; // close × quantity-held-on-this-date
}

interface DividendEvent {
  date: string;
  perShare: number;
  totalAmount: number;
}

const RANGE_DAYS: Record<string, number> = {
  "1m": 31,
  "3m": 92,
  "1y": 366,
  "5y": 366 * 5,
  // "all" defaults to 20y back — effectively all the history Yahoo will
  // return for any liquid ticker.
  all: 366 * 20,
};

export const GET = withAuthAndId(async (id, request) => {
  // Range purely from the picker: 1m / 3m / 1y / 5y / all. Always anchors
  // at today; we no longer trim by purchase / grant / vest dates so the
  // chart shows market context regardless of when the user bought.
  const { searchParams } = new URL(request.url);
  const rangeParam = searchParams.get("range") ?? "all";
  const rangeDays = RANGE_DAYS[rangeParam] ?? RANGE_DAYS.all;

  const [inv] = await db.select().from(investments).where(eq(investments.id, id)).limit(1);
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const vests = await db
    .select()
    .from(investmentVests)
    .where(eq(investmentVests.investmentId, id))
    .orderBy(asc(investmentVests.vestDate));

  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - rangeDays * 24 * 60 * 60 * 1000);

  let closes: { date: string; close: number }[] = [];
  let dividends: { date: string; amount: number }[] = [];
  try {
    const hist = await getDailyHistory(inv.symbol, fromDate, toDate);
    closes = hist.closes;
    dividends = hist.dividends;
    // Cache the closes for future point-in-time lookups.
    void persistPriceCache(inv.symbol, closes);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "History fetch failed" },
      { status: 502 },
    );
  }

  // Build the series. Value-at-date uses the FULL granted quantity for every
  // kind (matching the table's Value column). The vested schedule informs
  // the chart's anchor (above) but not the per-point quantity, so an
  // unvested grant still renders as a meaningful "what would this be worth"
  // line instead of a flat zero.
  const totalQty = parseFloat(inv.quantity);
  const series: ChartPoint[] = closes.map((c) => ({
    date: c.date,
    close: c.close,
    value: totalQty * c.close,
  }));

  // Show every dividend in the window — the chart colours pre- vs post-
  // purchase differently. Total ("received") still respects purchase_date
  // because we only get paid divs that happened after we bought.
  const dividendEvents: DividendEvent[] = dividends.map((d) => ({
    date: d.date,
    perShare: d.amount,
    totalAmount: totalQty * d.amount,
  }));

  const dividendsTotal = dividendsReceived(inv, vests, totalQty, dividends);

  return NextResponse.json({
    series,
    dividends: dividendEvents,
    dividendsTotal,
  });
});
