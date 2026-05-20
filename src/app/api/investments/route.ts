import { NextResponse } from "next/server";
import { db } from "@/db";
import { investments, investmentVests } from "@/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import { z } from "zod";
import { getQuote, getDailyHistory, getPriceOnDate } from "@/lib/investments/yahoo";
import { vestedQuantity, costBasis, currentValue, totalReturn } from "@/lib/investments/calc";
import { withAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

const createSchema = z.object({
  kind: z.enum(["stock", "rsu", "option", "paper"]),
  symbol: z.string().min(1).max(32),
  exchange: z.string().min(1).max(16),
  currency: z.string().min(1).max(8),
  name: z.string().optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  quantity: z.string(),
  purchaseDate: z.string(),
  purchasePrice: z.string().optional().nullable(),
  strikePrice: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  serviceDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

interface ListRow {
  id: string;
  kind: string;
  symbol: string;
  exchange: string;
  name: string | null;
  currency: string;
  quantity: string;
  purchaseDate: string;
  purchasePrice: string | null;
  strikePrice: string | null;
  expiryDate: string | null;
  serviceDate: string | null;
  /** Latest (maximum) vest_date across all vests; for LTI grants this is the
   * maturation date. Null if no vests are recorded. */
  maturationDate: string | null;
  notes: string | null;
  vestedQuantity: number;
  currentPrice: number | null;
  /** Most recent prior trading day's close; used by the table to render a
   * day-over-day gain column. */
  priorClose: number | null;
  /** Close from ~5 trading days ago; used for the week gain column. */
  weekAgoClose: number | null;
  /** Close from ~22 trading days ago; used for the month gain column. */
  monthAgoClose: number | null;
  costBasis: number;
  currentValue: number;
  totalReturnAbs: number;
  totalReturnPct: number | null;
}

export const GET = withAuth(async () => {
  const rows = await db
    .select()
    .from(investments)
    .where(eq(investments.isArchived, false))
    .orderBy(asc(investments.symbol));

  const ids = rows.map((r) => r.id);
  const vestRows = ids.length
    ? await db.select().from(investmentVests).where(inArray(investmentVests.investmentId, ids))
    : [];
  const vestsById = new Map<string, typeof vestRows>();
  for (const v of vestRows) {
    const arr = vestsById.get(v.investmentId) ?? [];
    arr.push(v);
    vestsById.set(v.investmentId, arr);
  }

  // Fetch a ~6-week window of closes per unique symbol so we can extract
  // current / prior-day / week-ago / month-ago prices for the gain
  // columns. Tolerate failures so a single bad ticker doesn't tank the
  // whole list.
  interface KeyPrices {
    current: number | null;
    prior: number | null;
    weekAgo: number | null;
    monthAgo: number | null;
  }
  const symbols = Array.from(new Set(rows.map((r) => r.symbol)));
  const today = new Date();
  const windowStart = new Date(today.getTime() - 42 * 24 * 60 * 60 * 1000);
  const priceEntries = await Promise.all(
    symbols.map(async (s): Promise<readonly [string, KeyPrices]> => {
      const empty: KeyPrices = {
        current: null,
        prior: null,
        weekAgo: null,
        monthAgo: null,
      };
      try {
        const { closes } = await getDailyHistory(s, windowStart, today);
        if (closes.length === 0) return [s, empty] as const;
        const sorted = closes.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
        const current = sorted.at(-1)?.close ?? null;
        const prior = sorted.length >= 2 ? sorted[sorted.length - 2].close : null;
        // 5 trading days back = 6th-from-last bar (today included).
        const weekAgo =
          sorted.length >= 6 ? sorted[sorted.length - 6].close : null;
        // ~22 trading days back ≈ one calendar month.
        const monthAgo =
          sorted.length >= 23 ? sorted[sorted.length - 23].close : null;
        return [s, { current, prior, weekAgo, monthAgo }] as const;
      } catch {
        return [s, empty] as const;
      }
    }),
  );
  const priceBySymbol = new Map<string, KeyPrices>(priceEntries);

  const out: ListRow[] = rows.map((r) => {
    const vests = vestsById.get(r.id) ?? [];
    const vested = vestedQuantity(r, vests);
    const prices = priceBySymbol.get(r.symbol) ?? {
      current: null,
      prior: null,
      weekAgo: null,
      monthAgo: null,
    };
    const price = prices.current;
    const cb = costBasis(r);
    const cv = price != null ? currentValue(r, price) : 0;
    // Dividends are computed in the detail endpoint where we have the full
    // history; the list view just shows return-vs-cost without dividends.
    const ret = totalReturn(cb, cv, 0);
    const maturationDate =
      vests.length > 0
        ? vests
            .map((v) => v.vestDate)
            .sort()
            .at(-1) ?? null
        : null;
    return {
      id: r.id,
      kind: r.kind,
      symbol: r.symbol,
      exchange: r.exchange,
      name: r.name,
      currency: r.currency,
      quantity: r.quantity,
      purchaseDate: r.purchaseDate,
      purchasePrice: r.purchasePrice,
      strikePrice: r.strikePrice,
      expiryDate: r.expiryDate,
      serviceDate: r.serviceDate,
      maturationDate,
      notes: r.notes,
      vestedQuantity: vested,
      currentPrice: price,
      priorClose: prices.prior,
      weekAgoClose: prices.weekAgo,
      monthAgoClose: prices.monthAgo,
      costBasis: cb,
      currentValue: cv,
      totalReturnAbs: ret.absolute,
      totalReturnPct: ret.percent,
    };
  });

  return NextResponse.json(out);
});

export const POST = withAuth(async (request) => {
  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  // Resolve missing metadata from Yahoo when the client didn't provide it.
  let name = data.name ?? null;
  if (!name) {
    try {
      const q = await getQuote(data.symbol);
      name = q.name;
    } catch {
      // Non-fatal — user can edit later.
    }
  }

  // Auto-fill purchase price from market when omitted. Applies to stocks
  // and paper-trade what-if buys so cost basis is meaningful from day 1
  // (otherwise return = full current value because basis = 0).
  let purchasePrice: string | null = data.purchasePrice ?? null;
  if (!purchasePrice && (data.kind === "stock" || data.kind === "paper")) {
    try {
      const px = await getPriceOnDate(data.symbol, data.purchaseDate);
      if (px != null) purchasePrice = px.toFixed(6);
    } catch {
      // Non-fatal.
    }
  }
  // RSUs default to 0 cost.
  if (data.kind === "rsu" && !purchasePrice) purchasePrice = "0";

  const [row] = await db
    .insert(investments)
    .values({
      kind: data.kind,
      symbol: data.symbol,
      exchange: data.exchange,
      name,
      currency: data.currency,
      accountId: data.accountId ?? null,
      quantity: data.quantity,
      purchaseDate: data.purchaseDate,
      purchasePrice,
      strikePrice: data.strikePrice ?? null,
      expiryDate: data.expiryDate ?? null,
      serviceDate: data.serviceDate ?? null,
      notes: data.notes ?? null,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
});
