import { NextResponse } from "next/server";
import { db } from "@/db";
import { scheduledTransactions, scheduleSuggestionDismissals } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { normalizePayee } from "@/lib/categorize";
import { withAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

export const DELETE = withAuth(async (request) => {
  const parsed = await parseJsonBody(request, bulkDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { ids } = parsed.data;

  // Returning columns we need to plant suggestion-dismissals — otherwise
  // the suggestion engine would re-detect each pattern from historical
  // transactions and resurface it.
  const deleted = await db
    .delete(scheduledTransactions)
    .where(inArray(scheduledTransactions.id, ids))
    .returning({
      id: scheduledTransactions.id,
      accountId: scheduledTransactions.accountId,
      transferToAccountId: scheduledTransactions.transferToAccountId,
      payee: scheduledTransactions.payee,
    });

  // Build a deduped (accountId, normalizedPayee) set across both transfer
  // legs. Insert each as an idempotent dismissal.
  const dismissalKeys = new Set<string>();
  const dismissals: { accountId: string; normalizedPayee: string }[] = [];
  for (const row of deleted) {
    if (!row.payee) continue;
    const norm = normalizePayee(row.payee);
    if (norm.length < 3) continue;
    const targets: string[] = [];
    if (row.accountId) targets.push(row.accountId);
    if (row.transferToAccountId) targets.push(row.transferToAccountId);
    for (const accountId of targets) {
      const k = `${accountId}#${norm}`;
      if (dismissalKeys.has(k)) continue;
      dismissalKeys.add(k);
      dismissals.push({ accountId, normalizedPayee: norm });
    }
  }

  for (const d of dismissals) {
    await db
      .insert(scheduleSuggestionDismissals)
      .values(d)
      .onConflictDoUpdate({
        target: [
          scheduleSuggestionDismissals.accountId,
          scheduleSuggestionDismissals.normalizedPayee,
        ],
        set: { dismissedAt: new Date() },
      });
  }

  // Issue #69: surface `requested` so the client can distinguish
  // "all gone, success" from "all already gone, nothing happened".
  return NextResponse.json({
    deleted: deleted.length,
    requested: ids.length,
    dismissed: dismissals.length,
  });
});
