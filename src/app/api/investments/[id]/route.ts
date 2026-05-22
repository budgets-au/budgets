import { NextResponse } from "next/server";
import { withAuthAndId } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";
import { db } from "@/db";
import { investments, investmentVests } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { getPriceOnDate } from "@/lib/investments/yahoo";

const updateSchema = z.object({
  kind: z.enum(["stock", "rsu", "option", "paper"]).optional(),
  symbol: z.string().min(1).max(32).optional(),
  exchange: z.string().min(1).max(16).optional(),
  currency: z.string().min(1).max(8).optional(),
  name: z.string().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  quantity: z.string().optional(),
  purchaseDate: z.string().optional(),
  purchasePrice: z.string().nullable().optional(),
  strikePrice: z.string().nullable().optional(),
  expiryDate: z.string().nullable().optional(),
  serviceDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  isArchived: z.boolean().optional(),
});

export const GET = withAuthAndId(async (id) => {
  const [row] = await db.select().from(investments).where(eq(investments.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const vests = await db
    .select()
    .from(investmentVests)
    .where(eq(investmentVests.investmentId, id))
    .orderBy(asc(investmentVests.vestDate));

  return NextResponse.json({ ...row, vests });
});

export const PATCH = withAuthAndId(async (id, request) => {
  const parsed = await parseJsonBody(request, updateSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  // For paper trades, "what-if I bought on day X" is the whole point, so when
  // the user moves the purchase date we re-anchor the cost basis to that
  // date's market close. Skipped if the user typed a different price in the
  // same edit (we treat that as an explicit override).
  const [existing] = await db
    .select()
    .from(investments)
    .where(eq(investments.id, id))
    .limit(1);
  if (
    existing?.kind === "paper" &&
    data.purchaseDate &&
    data.purchaseDate !== existing.purchaseDate &&
    (data.purchasePrice == null || data.purchasePrice === existing.purchasePrice)
  ) {
    try {
      const px = await getPriceOnDate(existing.symbol, data.purchaseDate);
      if (px != null) data.purchasePrice = px.toFixed(6);
    } catch {
      // Non-fatal — leave price untouched and let the user edit if needed.
    }
  }

  const [row] = await db
    .update(investments)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(investments.id, id))
    .returning();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
});

export const DELETE = withAuthAndId(async (id) => {
  // Issue #67: 404 when no row matched.
  const deleted = await db
    .delete(investments)
    .where(eq(investments.id, id))
    .returning({ id: investments.id });
  if (deleted.length === 0) {
    return NextResponse.json({ error: "Investment not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
