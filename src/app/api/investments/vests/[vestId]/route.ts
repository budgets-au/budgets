import { NextResponse } from "next/server";
import { db } from "@/db";
import { investmentVests } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/parse-body";
import { withAuth } from "@/lib/api/route-guards";

const updateSchema = z.object({
  vestDate: z.string().optional(),
  quantity: z.string().optional(),
  performanceNote: z.string().nullable().optional(),
  isSatisfied: z.boolean().optional(),
});

export const PATCH = withAuth<{ params: Promise<{ vestId: string }> }>(
  async (request, { params }) => {
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
  },
);

export const DELETE = withAuth<{ params: Promise<{ vestId: string }> }>(
  async (_request, { params }) => {
    const { vestId: rawId } = await params;
    const idParse = z.string().uuid().safeParse(rawId);
    if (!idParse.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    // Issue #67: 404 when no row matched.
    const deleted = await db
      .delete(investmentVests)
      .where(eq(investmentVests.id, idParse.data))
      .returning({ id: investmentVests.id });
    if (deleted.length === 0) {
      return NextResponse.json({ error: "Vest not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  },
);
