import { NextResponse } from "next/server";
import { db } from "@/db";
import { investmentVests } from "@/db/schema";
import { z } from "zod";
import { withAuthAndId } from "@/lib/api/route-guards";

const createSchema = z.object({
  vestDate: z.string(),
  quantity: z.string(),
  performanceNote: z.string().nullable().optional(),
  isSatisfied: z.boolean().default(true),
});

export const POST = withAuthAndId(async (id, request) => {
  const body = await request.json();
  const data = createSchema.parse(body);

  const [row] = await db
    .insert(investmentVests)
    .values({
      investmentId: id,
      vestDate: data.vestDate,
      quantity: data.quantity,
      performanceNote: data.performanceNote ?? null,
      isSatisfied: data.isSatisfied,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
});
