import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  const idParse = z.string().uuid().safeParse(rawId);
  if (!idParse.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const id = idParse.data;

  const [row] = await db.select().from(investments).where(eq(investments.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const vests = await db
    .select()
    .from(investmentVests)
    .where(eq(investmentVests.investmentId, id))
    .orderBy(asc(investmentVests.vestDate));

  return NextResponse.json({ ...row, vests });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  const idParse = z.string().uuid().safeParse(rawId);
  if (!idParse.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const id = idParse.data;

  const body = await request.json();
  const data = updateSchema.parse(body);

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
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  const idParse = z.string().uuid().safeParse(rawId);
  if (!idParse.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const id = idParse.data;

  await db.delete(investments).where(eq(investments.id, id));
  return NextResponse.json({ ok: true });
}
