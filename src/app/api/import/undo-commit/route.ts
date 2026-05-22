import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { accounts, importLogs, transactions } from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

const bodySchema = z.object({
  importLogIds: z.array(z.string().uuid()).min(1),
});

/**
 * Roll back a recent commit. Given a list of importLogIds (returned by
 * `/api/import/commit-batched`), delete every transaction tagged with
 * those logs, then delete the logs themselves, then refresh the
 * affected accounts' currentBalance.
 *
 * Surgical — only touches rows the import created. Transactions that
 * existed before the commit (and had their importHash migrated or
 * type/balance backfilled) keep their patches; that's a separate undo
 * not provided here. The user mainly needs this when "possible" matches
 * were re-inserted as duplicates and they want them gone.
 */
export const POST = withAuth(async (request) => {
  const parsed = await parseJsonBody(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  const { importLogIds } = parsed.data;

  // Collect the affected accounts BEFORE deleting so we can refresh
  // their currentBalance afterwards.
  const accountIdsToRefresh = await db
    .selectDistinct({ accountId: transactions.accountId })
    .from(transactions)
    .where(inArray(transactions.importLogId, importLogIds));
  const accountIdSet = new Set(
    accountIdsToRefresh.map((r) => r.accountId).filter((x): x is string => !!x),
  );

  const deleted = await db
    .delete(transactions)
    .where(inArray(transactions.importLogId, importLogIds))
    .returning({ id: transactions.id });

  // .returning() so the response reports the rows actually deleted —
  // not the input id count, which would falsely report "1 deleted" on
  // a re-undo of an already-undone log.
  const deletedLogs = await db
    .delete(importLogs)
    .where(inArray(importLogs.id, importLogIds))
    .returning({ id: importLogs.id });

  // Recompute currentBalance for every account whose transactions
  // changed. Issue #74: was N separate UPDATEs in a loop; now one
  // UPDATE correlated against accounts.id so each affected row
  // gets its balance recomputed in a single statement.
  const accountIds = Array.from(accountIdSet);
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
    deletedTransactions: deleted.length,
    deletedImportLogs: deletedLogs.length,
    accountsRefreshed: accountIdSet.size,
  });
});
