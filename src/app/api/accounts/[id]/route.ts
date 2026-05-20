import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { accountTypeEnum } from "@/lib/api/enums";

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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(row);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const data = updateSchema.parse(body);

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
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await db.update(accounts).set({ isArchived: true }).where(eq(accounts.id, id));
  return NextResponse.json({ ok: true });
}
