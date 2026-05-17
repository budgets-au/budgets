import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
// Auto-learning has been removed — the trigram suggester reads
// directly from the categorised history, so re-categorising a
// transaction makes the next import smarter without spawning more
// rule rows.

const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  categoryId: z.string().uuid().nullable(),
});

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { ids, categoryId } = bulkSchema.parse(body);

  const updated = await db
    .update(transactions)
    .set({ categoryId, updatedAt: new Date() })
    .where(inArray(transactions.id, ids))
    .returning({ id: transactions.id, payee: transactions.payee });

  return NextResponse.json({ updated: updated.length });
}

const deleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
});

/**
 * Bulk-delete transactions by id, then refresh `currentBalance` on every
 * affected account. Mirrors the per-row DELETE in
 * `/api/transactions/[id]` but in a single round-trip.
 */
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { ids } = deleteSchema.parse(body);

  // Inside a transaction so partner-flag cleanup commits with the delete.
  // The FK's `ON DELETE SET NULL` on `transfer_pair_id` cleans
  // each surviving partner's pointer automatically when the deletes
  // fire below — no per-partner pre-step needed.
  const deleted = await db.transaction(async (tx) => {
    return tx
      .delete(transactions)
      .where(inArray(transactions.id, ids))
      .returning({ id: transactions.id, accountId: transactions.accountId });
  });

  const accountIds = Array.from(
    new Set(deleted.map((r) => r.accountId).filter((x): x is string => !!x)),
  );
  for (const accountId of accountIds) {
    await db
      .update(accounts)
      .set({
        currentBalance: sql`${accounts.startingBalance} + (SELECT COALESCE(SUM(amount), 0) FROM ${transactions} WHERE ${transactions.accountId} = ${accountId})`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));
  }

  return NextResponse.json({
    deleted: deleted.length,
    accountsRefreshed: accountIds.length,
  });
}
