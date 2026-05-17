import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { superannuationSnapshots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const updateSchema = z.object({
  fyEndYear: z.number().int().min(1990).max(2200).optional(),
  balance: z.string().optional(),
  contributions: z.string().optional(),
  // Free-text person key; see /api/super/route.ts for the why.
  person: z.string().min(1).max(60).optional(),
  fundName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  const idParse = z.string().uuid().safeParse(rawId);
  if (!idParse.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json();
  const data = updateSchema.parse(body);

  const [row] = await db
    .update(superannuationSnapshots)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(superannuationSnapshots.id, idParse.data))
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

  await db
    .delete(superannuationSnapshots)
    .where(eq(superannuationSnapshots.id, idParse.data));
  return NextResponse.json({ ok: true });
}
