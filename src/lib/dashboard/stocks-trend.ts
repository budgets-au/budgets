import { and, eq, gte, inArray, asc } from "drizzle-orm";
import { db } from "@/db";
import { investments, investmentPrices } from "@/db/schema";

const RANGE_DAYS: Record<string, number> = {
  "1m": 31,
  "3m": 92,
  "1y": 366,
};

interface TrendPoint {
  date: string;
  value: number;
}

/** Aggregate daily value of every owned stock position. Pulls
 * cached daily closes from `investment_prices` (populated by the
 * per-investment history endpoint and by the periodic refresher),
 * multiplies each close by the current held quantity, and sums
 * across stocks per day.
 *
 * No FX conversion: the AUD and USD positions get summed in
 * local-currency units. The sparkline is a *shape* indicator —
 * "is the book moving up or down" — not a dollar truth; the
 * card's per-currency totals below the sparkline remain the
 * authoritative number for each currency. If we ever surface the
 * raw axis values (we don't right now), this assumption needs to
 * change. */
export async function getStocksTrend(
  range: string,
): Promise<{ series: TrendPoint[] }> {
  const days = RANGE_DAYS[range] ?? RANGE_DAYS["1m"];
  const fromDate = new Date(Date.now() - days * 86400000)
    .toISOString()
    .slice(0, 10);

  const stocks = await db
    .select({
      symbol: investments.symbol,
      quantity: investments.quantity,
    })
    .from(investments)
    .where(
      and(eq(investments.kind, "stock"), eq(investments.isArchived, false)),
    );
  if (stocks.length === 0) return { series: [] };

  // Symbol → total quantity held (collapse duplicates from
  // multi-lot purchases of the same ticker so one symbol's daily
  // close gets multiplied by the FULL position size, not each lot
  // individually).
  const qtyBySymbol = new Map<string, number>();
  for (const s of stocks) {
    const q = parseFloat(s.quantity);
    if (!Number.isFinite(q) || q === 0) continue;
    qtyBySymbol.set(s.symbol, (qtyBySymbol.get(s.symbol) ?? 0) + q);
  }
  const symbols = Array.from(qtyBySymbol.keys());
  if (symbols.length === 0) return { series: [] };

  const prices = await db
    .select({
      symbol: investmentPrices.symbol,
      date: investmentPrices.date,
      close: investmentPrices.close,
    })
    .from(investmentPrices)
    .where(
      and(
        inArray(investmentPrices.symbol, symbols),
        gte(investmentPrices.date, fromDate),
      ),
    )
    .orderBy(asc(investmentPrices.date));

  // Forward-fill per symbol: not every symbol has a price for every
  // trading day in the range (weekends, holidays, gaps in the cache).
  // For each symbol we walk dates forward and reuse the last seen
  // close, so the per-day sum stays smooth instead of dipping to 0
  // every time one symbol is missing.
  const dateSet = new Set<string>();
  const bySymbol = new Map<string, Map<string, number>>();
  for (const p of prices) {
    dateSet.add(p.date);
    const m = bySymbol.get(p.symbol) ?? new Map<string, number>();
    m.set(p.date, parseFloat(p.close));
    bySymbol.set(p.symbol, m);
  }
  const dates = Array.from(dateSet).sort();
  if (dates.length === 0) return { series: [] };

  const series: TrendPoint[] = [];
  const lastClose = new Map<string, number>();
  for (const date of dates) {
    let dayValue = 0;
    let anyContrib = false;
    for (const [symbol, qty] of qtyBySymbol) {
      const m = bySymbol.get(symbol);
      const close = m?.get(date) ?? lastClose.get(symbol);
      if (close == null) continue;
      lastClose.set(symbol, close);
      dayValue += close * qty;
      anyContrib = true;
    }
    if (anyContrib) series.push({ date, value: dayValue });
  }
  return { series };
}
