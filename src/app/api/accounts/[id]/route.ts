import { NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { accountTypeEnum } from "@/lib/api/enums";
import { withAuthAndId } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  type: accountTypeEnum.optional(),
  institution: z.string().nullable().optional(),
  accountNumberLast4: z.string().nullable().optional(),
  color: z.string().optional(),
  isArchived: z.boolean().optional(),
  isExternal: z.boolean().optional(),
  // Re-anchor the account: starting_balance + starting_date are the historical
  // anchor; current_balance is the live value. When startingBalance changes
  // without an explicit currentBalance, currentBalance is recomputed from the
  // new anchor + existing transactions so the math stays consistent.
  startingBalance: z.string().optional(),
  startingDate: z.string().nullable().optional(),
  currentBalance: z.string().optional(),
});

export const GET = withAuthAndId(async (id) => {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(row);
});

export const PATCH = withAuthAndId(async (id, request) => {
  const parsed = await parseJsonBody(request, updateSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  const [row] = await db
    .update(accounts)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(accounts.id, id))
    .returning();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Recompute currentBalance from the new starting anchor + existing
  // transactions when startingBalance moved and the caller didn't pin
  // currentBalance directly. Mirrors the formula used by the import-commit
  // route so an Edit and a re-import produce the same result.
  if (data.startingBalance !== undefined && data.currentBalance === undefined) {
    const [updated] = await db
      .update(accounts)
      .set({
        currentBalance: sql`${accounts.startingBalance} + (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE account_id = ${id})`,
      })
      .where(eq(accounts.id, id))
      .returning();
    return NextResponse.json(updated ?? row);
  }

  return NextResponse.json(row);
});

export const DELETE = withAuthAndId(async (id) => {
  await db.update(accounts).set({ isArchived: true }).where(eq(accounts.id, id));
  return NextResponse.json({ ok: true });
});
