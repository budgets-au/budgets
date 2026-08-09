import { NextResponse } from "next/server";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { transferKindEnum } from "@/lib/api/enums";
import { withAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

/** Per-tag string schema. Strips zero-width unicode (ZWSP, ZWJ,
 *  BOM, LRM, RLM) BEFORE trimming, then requires non-empty and
 *  caps at 64 chars. `.trim().min(1)` alone accepts an invisible-
 *  only tag like "​" which then renders as an empty chip that
 *  the operator can't easily see or remove — this pipeline rejects
 *  those cleanly at the API boundary. */
const tagStringSchema = z
  .string()
  .transform((s) => s.replace(/[​-‏‪-‮⁠-⁤﻿]/g, "").trim())
  .pipe(z.string().min(1).max(64));

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["income", "expense"]),
  color: z.string().default("#94a3b8"),
  parentId: z.string().uuid().optional().nullable(),
  transferKind: transferKindEnum.optional(),
  // Free-form labels — see src/lib/reports/virtual-rows.ts. Nullable
  // so callers can `{ tags: null }` on create for parity with PATCH.
  tags: z.array(tagStringSchema).nullable().optional(),
});

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  let query = db
    .select()
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .$dynamic();
  if (type === "income" || type === "expense") {
    query = query.where(eq(categories.type, type));
  }

  const rows = await query;
  return NextResponse.json(rows);
});

export const POST = withAuth(async (request) => {
  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  // Store empty array / null as NULL — the three are equivalent
  // for the Cashflow virtual-rows read path, and NULL keeps the
  // JSON blob out of the DB entirely for the common untagged case.
  const insertValues = {
    ...data,
    tags: data.tags && data.tags.length > 0 ? data.tags : null,
  };

  const [row] = await db.insert(categories).values(insertValues).returning();
  return NextResponse.json(row, { status: 201 });
});
