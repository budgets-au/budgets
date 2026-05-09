import { db } from "@/db";
import { investmentPrices } from "@/db/schema";
import { and, eq, gte, lte, inArray } from "drizzle-orm";

// Yahoo blocks the default Node fetch UA on these endpoints; a browser-ish
// header is enough to get through. There's no rate-limit advertised but we
// cache aggressively in `investment_prices` to keep traffic minimal.
const UA =
  "Mozilla/5.0 (compatible; budgets/1.0; +https://github.com/anthropics/claude-code)";

const SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search";
const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string; // 'ASX' | 'US' | other
  currency: string;
  quoteType: string; // 'EQUITY' | 'ETF' | etc.
}

export interface Quote {
  symbol: string;
  price: number;
  name: string | null;
  currency: string | null;
  exchange: string | null;
}

export interface HistoryResult {
  closes: { date: string; close: number }[]; // ISO YYYY-MM-DD
  dividends: { date: string; amount: number }[];
}

interface YahooSearchResponse {
  quotes?: Array<{
    symbol: string;
    shortname?: string;
    longname?: string;
    quoteType?: string;
    exchange?: string;
    currency?: string;
  }>;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        regularMarketPrice?: number;
        currency?: string;
        exchangeName?: string;
        instrumentType?: string;
        longName?: string;
        shortName?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: (number | null)[] }>;
        adjclose?: Array<{ adjclose?: (number | null)[] }>;
      };
      events?: {
        dividends?: Record<string, { amount: number; date: number }>;
      };
    }>;
    error?: { code: string; description: string } | null;
  };
}

/** Map Yahoo's exchange name to our 'ASX' | 'US' bucket. */
function bucketExchange(yahooExchange: string | null | undefined): string {
  if (!yahooExchange) return "US";
  const upper = yahooExchange.toUpperCase();
  if (upper === "ASX" || upper === "AUX") return "ASX";
  // NYQ, NMS, NGM, ASE, NYE all → US
  return "US";
}

function toISO(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

async function yahooFetch(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    // Don't cache at the runtime layer; we have our own DB cache.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Yahoo fetch failed: ${res.status} ${res.statusText}`);
  }
  return res;
}

/** Top-N ticker matches for a free-text query (used by the add-investment search box). */
export async function searchTicker(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
  const res = await yahooFetch(url);
  const data = (await res.json()) as YahooSearchResponse;
  return (data.quotes ?? [])
    .filter((q) => q.symbol && (q.quoteType === "EQUITY" || q.quoteType === "ETF"))
    .map((q) => ({
      symbol: q.symbol,
      name: q.longname ?? q.shortname ?? q.symbol,
      exchange: bucketExchange(q.exchange),
      currency: q.currency ?? (bucketExchange(q.exchange) === "ASX" ? "AUD" : "USD"),
      quoteType: q.quoteType ?? "EQUITY",
    }));
}

/** Latest price + metadata for a symbol. */
export async function getQuote(symbol: string): Promise<Quote> {
  const url = `${CHART_URL}/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const res = await yahooFetch(url);
  const data = (await res.json()) as YahooChartResponse;
  const result = data.chart?.result?.[0];
  if (!result || !result.meta) {
    throw new Error(`No quote data for ${symbol}`);
  }
  const meta = result.meta;
  // regularMarketPrice is the latest; if absent, fall back to the last close
  // in the 5-day window.
  let price = meta.regularMarketPrice ?? null;
  if (price == null) {
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i] != null) {
        price = closes[i] as number;
        break;
      }
    }
  }
  if (price == null) {
    throw new Error(`No price available for ${symbol}`);
  }
  return {
    symbol,
    price,
    name: meta.longName ?? meta.shortName ?? null,
    currency: meta.currency ?? null,
    exchange: bucketExchange(meta.exchangeName),
  };
}

/** Daily history (closes + dividends) over [fromDate, toDate]. */
export async function getDailyHistory(
  symbol: string,
  fromDate: Date,
  toDate: Date,
): Promise<HistoryResult> {
  const period1 = Math.floor(fromDate.getTime() / 1000);
  const period2 = Math.floor(toDate.getTime() / 1000);
  const url = `${CHART_URL}/${encodeURIComponent(
    symbol,
  )}?period1=${period1}&period2=${period2}&interval=1d&events=div`;
  const res = await yahooFetch(url);
  const data = (await res.json()) as YahooChartResponse;
  const result = data.chart?.result?.[0];
  if (!result) return { closes: [], dividends: [] };
  const ts = result.timestamp ?? [];
  const closeArr = result.indicators?.quote?.[0]?.close ?? [];
  const closes: { date: string; close: number }[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closeArr[i];
    if (c == null) continue;
    closes.push({ date: toISO(ts[i]), close: c });
  }
  const divs = result.events?.dividends ?? {};
  const dividends = Object.values(divs)
    .map((d) => ({ date: toISO(d.date), amount: d.amount }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { closes, dividends };
}

/**
 * Look up the close price for a symbol on a specific date. Reads the
 * `investment_prices` cache first; on miss, fetches a 5-trading-day window
 * around the requested date, snaps to the nearest available close, and
 * persists every returned date to the cache.
 *
 * Returns null when even the live fetch yields nothing (e.g. invalid symbol,
 * date before listing, future date).
 */
export async function getPriceOnDate(
  symbol: string,
  dateISO: string,
): Promise<number | null> {
  // Fast path — exact match in cache.
  const [exact] = await db
    .select()
    .from(investmentPrices)
    .where(and(eq(investmentPrices.symbol, symbol), eq(investmentPrices.date, dateISO)))
    .limit(1);
  if (exact) return parseFloat(exact.close);

  // Try a ±5d window from the cache before reaching out to Yahoo (covers
  // weekends/holidays when the requested date isn't a trading day).
  const target = new Date(dateISO);
  const windowFrom = new Date(target.getTime() - 5 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const windowTo = new Date(target.getTime() + 5 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const cached = await db
    .select()
    .from(investmentPrices)
    .where(
      and(
        eq(investmentPrices.symbol, symbol),
        gte(investmentPrices.date, windowFrom),
        lte(investmentPrices.date, windowTo),
      ),
    );
  const nearest = pickNearest(
    cached.map((c) => ({ date: c.date, close: parseFloat(c.close) })),
    dateISO,
  );
  if (nearest) return nearest.close;

  // Live fetch.
  const fromFetch = new Date(target.getTime() - 5 * 24 * 60 * 60 * 1000);
  const toFetch = new Date(target.getTime() + 5 * 24 * 60 * 60 * 1000);
  const { closes } = await getDailyHistory(symbol, fromFetch, toFetch);
  if (closes.length === 0) return null;
  await persistPriceCache(symbol, closes);
  const fresh = pickNearest(closes, dateISO);
  return fresh?.close ?? null;
}

function pickNearest<T extends { date: string }>(rows: T[], dateISO: string): T | null {
  if (rows.length === 0) return null;
  const target = new Date(dateISO).getTime();
  let best: T | null = null;
  let bestDist = Infinity;
  for (const r of rows) {
    const d = Math.abs(new Date(r.date).getTime() - target);
    if (d < bestDist) {
      best = r;
      bestDist = d;
    }
  }
  return best;
}

/** Bulk-upsert closes into the price cache. Skips rows already present. */
export async function persistPriceCache(
  symbol: string,
  closes: { date: string; close: number }[],
): Promise<void> {
  if (closes.length === 0) return;
  const existing = await db
    .select({ date: investmentPrices.date })
    .from(investmentPrices)
    .where(
      and(
        eq(investmentPrices.symbol, symbol),
        inArray(
          investmentPrices.date,
          closes.map((c) => c.date),
        ),
      ),
    );
  const have = new Set(existing.map((e) => e.date));
  const toInsert = closes
    .filter((c) => !have.has(c.date))
    .map((c) => ({ symbol, date: c.date, close: c.close.toString() }));
  if (toInsert.length === 0) return;
  await db.insert(investmentPrices).values(toInsert);
}
