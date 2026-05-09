import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
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
  // Without it, a paired transfer's surviving partner could keep
  // is_transfer=true while transfer_pair_id (cleared by FK SET NULL) goes
  // back to NULL.
  const deleted = await db.transaction(async (tx) => {
    // Find the partner ids of any rows we're about to delete that were
    // half of a transfer pair. Exclude any partners that are themselves
    // in the delete set (the relationship is dying entirely, no flag to
    // clear) and clear the flag on the rest.
    const targets = await tx
      .select({
        id: transactions.id,
        transferPairId: transactions.transferPairId,
      })
      .from(transactions)
      .where(and(inArray(transactions.id, ids), isNotNull(transactions.transferPairId)));
    const idSet = new Set(ids);
    const partnersToClear = targets
      .map((t) => t.transferPairId)
      .filter((p): p is string => !!p && !idSet.has(p));
    if (partnersToClear.length > 0) {
      await tx
        .update(transactions)
        .set({ isTransfer: false, updatedAt: new Date() })
        .where(inArray(transactions.id, partnersToClear));
      // Note: partners' transfer_pair_id is cleared automatically by the
      // FK's ON DELETE SET NULL once the originals delete.
    }
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
