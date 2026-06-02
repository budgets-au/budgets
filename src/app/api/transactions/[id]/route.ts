import { NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, accounts } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { deriveMatchPayee, loadTokenFreq, normalizePayee } from "@/lib/categorize";
import { isoDateString, numericString } from "@/lib/zod-helpers";
import { withAuthAndId } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";
// Auto-learning has been removed — the trigram suggester reads
// directly from the categorised history, so re-categorising a
// transaction is itself the training signal for future imports.

const updateSchema = z.object({
  date: isoDateString.optional(),
  amount: numericString.optional(),
  payee: z.string().optional(),
  description: z.string().optional(),
  categoryId: z.string().uuid().optional().nullable(),
  notes: z.string().nullable().optional(),
  isReconciled: z.boolean().optional(),
});

async function refreshBalance(accountId: string) {
  await db
    .update(accounts)
    .set({
      currentBalance: sql`(SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE account_id = ${accountId}) + ${accounts.startingBalance}`,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, accountId));
}

export const GET = withAuthAndId(async (id) => {
  const [row] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
});

export const PATCH = withAuthAndId(async (id, request) => {
  const parsed = await parseJsonBody(request, updateSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  // When the payee text changes, recompute normalizedPayee + matchPayee in
  // lockstep — otherwise the trigram engine and rules lookup keep matching
  // the old form and the next import suggests stale categories. The original
  // POST/insert path already does this; PATCH was missing it.
  const patch: Partial<typeof transactions.$inferInsert> = {
    ...data,
    updatedAt: new Date(),
  };
  if (data.payee !== undefined) {
    const normalized = data.payee ? normalizePayee(data.payee) : null;
    const tokenFreq = await loadTokenFreq();
    patch.normalizedPayee = normalized;
    patch.matchPayee = deriveMatchPayee(normalized, tokenFreq);
  }

  const [row] = await db
    .update(transactions)
    .set(patch)
    .where(eq(transactions.id, id))
    .returning();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await refreshBalance(row.accountId);

  return NextResponse.json(row);
});

export const DELETE = withAuthAndId(async (id) => {
  // Inside a transaction so the partner-cleanup and the delete commit
  // together — half-applied state can leave a partner with a stale
  // is_transfer=true flag.
  const result = await db.transaction(async (tx) => {
    const [target] = await tx
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        transferPairId: transactions.transferPairId,
      })
      .from(transactions)
      .where(eq(transactions.id, id))
      .limit(1);
    if (!target) return null;
    // The FK's `ON DELETE SET NULL` clears the partner's
    // transfer_pair_id automatically. No is_transfer fix-up needed
    // — that column was retired in PR 2 (transfer_pair_id alone is
    // the truth) and the auto-matcher no longer writes it. Per-row
    // touch on the partner is unnecessary.
    await tx.delete(transactions).where(eq(transactions.id, id));
    return target;
  });
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await refreshBalance(result.accountId);
  return NextResponse.json({ ok: true });
});
