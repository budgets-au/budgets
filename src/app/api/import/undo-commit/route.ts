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

  await db.delete(importLogs).where(inArray(importLogs.id, importLogIds));

  // Recompute currentBalance for every account whose transactions changed.
  for (const accountId of accountIdSet) {
    await db
      .update(accounts)
      .set({
        currentBalance: sql`${accounts.startingBalance} + (SELECT COALESCE(SUM(amount), 0) FROM ${transactions} WHERE ${transactions.accountId} = ${accountId})`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));
  }

  return NextResponse.json({
    deletedTransactions: deleted.length,
    deletedImportLogs: importLogIds.length,
    accountsRefreshed: accountIdSet.size,
  });
});
