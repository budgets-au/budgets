import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { investmentVests } from "@/db/schema";
import { z } from "zod";

const createSchema = z.object({
  vestDate: z.string(),
  quantity: z.string(),
  performanceNote: z.string().nullable().optional(),
  isSatisfied: z.boolean().default(true),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  const idParse = z.string().uuid().safeParse(rawId);
  if (!idParse.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json();
  const data = createSchema.parse(body);

  const [row] = await db
    .insert(investmentVests)
    .values({
      investmentId: idParse.data,
      vestDate: data.vestDate,
      quantity: data.quantity,
      performanceNote: data.performanceNote ?? null,
      isSatisfied: data.isSatisfied,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
