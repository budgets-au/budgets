import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { watchlist } from "@/db/schema";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { getQuote } from "@/lib/investments/yahoo";

const createSchema = z.object({
  symbol: z.string().min(1).max(32),
  exchange: z.string().min(1).max(16),
  currency: z.string().min(1).max(8),
  name: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

interface ListRow {
  id: string;
  symbol: string;
  exchange: string;
  name: string | null;
  currency: string;
  notes: string | null;
  currentPrice: number | null;
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.select().from(watchlist).orderBy(asc(watchlist.symbol));

  // Latest quote per unique symbol; tolerate failures so a single bad ticker
  // doesn't break the whole list.
  const symbols = Array.from(new Set(rows.map((r) => r.symbol)));
  const quoteEntries = await Promise.all(
    symbols.map(async (s) => {
      try {
        const q = await getQuote(s);
        return [s, q.price] as const;
      } catch {
        return [s, null] as const;
      }
    }),
  );
  const priceBySymbol = new Map<string, number | null>(quoteEntries);

  const out: ListRow[] = rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    exchange: r.exchange,
    name: r.name,
    currency: r.currency,
    notes: r.notes,
    currentPrice: priceBySymbol.get(r.symbol) ?? null,
  }));
  return NextResponse.json(out);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const data = createSchema.parse(body);

  // Fill name from Yahoo when the client didn't supply one.
  let name = data.name ?? null;
  if (!name) {
    try {
      const q = await getQuote(data.symbol);
      name = q.name;
    } catch {
      // Non-fatal — symbol still gets watched, name can be edited later.
    }
  }

  try {
    const [row] = await db
      .insert(watchlist)
      .values({
        symbol: data.symbol,
        exchange: data.exchange,
        currency: data.currency,
        name,
        notes: data.notes ?? null,
      })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    // Unique violation on symbol → friendly 409.
    if (err instanceof Error && err.message.includes("watchlist_symbol_unique")) {
      return NextResponse.json(
        { error: `${data.symbol} is already on the watchlist` },
        { status: 409 },
      );
    }
    throw err;
  }
}
