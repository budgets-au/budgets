import { NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";
// Auto-learning has been removed — the trigram suggester reads
// directly from the categorised history, so re-categorising a
// transaction makes the next import smarter without spawning more
// rule rows.

const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  categoryId: z.string().uuid().nullable(),
});

export const PATCH = withAuth(async (request) => {
  const parsed = await parseJsonBody(request, bulkSchema);
  if (!parsed.ok) return parsed.response;
  const { ids, categoryId } = parsed.data;

  const updated = await db
    .update(transactions)
    .set({ categoryId, updatedAt: new Date() })
    .where(inArray(transactions.id, ids))
    .returning({ id: transactions.id, payee: transactions.payee });

  return NextResponse.json({ updated: updated.length });
});

const deleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
});

/**
 * Bulk-delete transactions by id, then refresh `currentBalance` on every
 * affected account. Mirrors the per-row DELETE in
 * `/api/transactions/[id]` but in a single round-trip.
 */
export const DELETE = withAuth(async (request) => {
  const parsed = await parseJsonBody(request, deleteSchema);
  if (!parsed.ok) return parsed.response;
  const { ids } = parsed.data;

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
  // Issue #74: was looping per-account UPDATE with a correlated
  // SUM subquery — N writes + N full account-scoped SUMs. Now one
  // UPDATE that correlates against `accounts.id` via SQL so each
  // touched account gets its balance recomputed in a single
  // statement. Same shape as `/api/import/undo-commit` uses below.
  if (accountIds.length > 0) {
    await db
      .update(accounts)
      .set({
        currentBalance: sql`${accounts.startingBalance} + COALESCE((SELECT SUM(amount) FROM ${transactions} WHERE ${transactions.accountId} = ${accounts.id}), 0)`,
        updatedAt: new Date(),
      })
      .where(inArray(accounts.id, accountIds));
  }

  return NextResponse.json({
    deleted: deleted.length,
    accountsRefreshed: accountIds.length,
  });
});
