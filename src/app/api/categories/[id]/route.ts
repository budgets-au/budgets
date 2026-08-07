import { NextResponse } from "next/server";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { transferKindEnum } from "@/lib/api/enums";
import { wouldCreateCycle } from "@/lib/category-descendants";
import { withAuthAndId } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  parentId: z.string().uuid().optional().nullable(),
  transferKind: transferKindEnum.optional(),
  sortOrder: z.number().int().min(0).optional(),
  // undefined = don't touch. null OR [] = clear all tags. Otherwise
  // replaces the tag set outright (no per-tag deltas).
  tags: z.array(z.string().trim().min(1)).nullable().optional(),
});

export const PATCH = withAuthAndId(async (id, request) => {
  const parsed = await parseJsonBody(request, updateSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  // Cycle prevention: a category can't be its own parent, and can't be
  // moved under any of its own descendants. Either would create a loop
  // that crashes every recursive CTE that walks the tree (transactions
  // includeChildren, scheduled budget-progress, expenses drilldown).
  if (data.parentId !== undefined && data.parentId !== null) {
    if (data.parentId === id) {
      return NextResponse.json(
        { error: "A category can't be its own parent." },
        { status: 400 },
      );
    }
    if (await wouldCreateCycle(id, data.parentId)) {
      return NextResponse.json(
        { error: "A category can't be moved under one of its own descendants." },
        { status: 400 },
      );
    }
  }

  // Store empty array as NULL — parity with POST + keeps the JSON
  // blob out of the DB for untagged categories.
  const patch =
    data.tags !== undefined && (data.tags === null || data.tags.length === 0)
      ? { ...data, tags: null }
      : data;

  const [row] = await db
    .update(categories)
    .set(patch)
    .where(eq(categories.id, id))
    .returning();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
});

export const DELETE = withAuthAndId(async (id) => {
  const [cat] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);

  if (!cat) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Promote children up one level (to the deleted category's own parent)
  await db
    .update(categories)
    .set({ parentId: cat.parentId ?? null })
    .where(eq(categories.parentId, id));

  await db.delete(categories).where(eq(categories.id, id));
  return NextResponse.json({ ok: true });
});
