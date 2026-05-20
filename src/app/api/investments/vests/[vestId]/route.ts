import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { investmentVests } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/parse-body";

const updateSchema = z.object({
  vestDate: z.string().optional(),
  quantity: z.string().optional(),
  performanceNote: z.string().nullable().optional(),
  isSatisfied: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ vestId: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { vestId: rawId } = await params;
  const idParse = z.string().uuid().safeParse(rawId);
  if (!idParse.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const parsed = await parseJsonBody(request, updateSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  const [row] = await db
    .update(investmentVests)
    .set(data)
    .where(eq(investmentVests.id, idParse.data))
    .returning();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ vestId: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { vestId: rawId } = await params;
  const idParse = z.string().uuid().safeParse(rawId);
  if (!idParse.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  await db.delete(investmentVests).where(eq(investmentVests.id, idParse.data));
  return NextResponse.json({ ok: true });
}
