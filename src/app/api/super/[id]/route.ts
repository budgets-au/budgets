import { NextResponse } from "next/server";
import { db } from "@/db";
import { superannuationSnapshots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withAuthAndId } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

const updateSchema = z.object({
  fyEndYear: z.number().int().min(1990).max(2200).optional(),
  balance: z.string().optional(),
  contributions: z.string().optional(),
  // Free-text person key; see /api/super/route.ts for the why.
  person: z.string().min(1).max(60).optional(),
  fundName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const PATCH = withAuthAndId(async (id, request) => {
  const parsed = await parseJsonBody(request, updateSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  const [row] = await db
    .update(superannuationSnapshots)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(superannuationSnapshots.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
});

export const DELETE = withAuthAndId(async (id) => {
  await db
    .delete(superannuationSnapshots)
    .where(eq(superannuationSnapshots.id, id));
  return NextResponse.json({ ok: true });
});
