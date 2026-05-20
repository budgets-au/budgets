import { NextResponse } from "next/server";
import { eq, and, ne, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  appSettings,
  payeeRules,
  scheduledTransactions,
  transactions,
} from "@/db/schema";
import { takeBackup } from "@/lib/backup/sqlite-backup";
import { withAdminAuth } from "@/lib/api/route-guards";

/** Admin-only sample-data control plane. The Settings UI calls
 * GET → render the panel with current counts.
 * POST → wipe everything tagged isSample = 1, plus any user rows
 *        attached to sample accounts (already surfaced via the GET so
 *        the operator can see what they're agreeing to).
 *
 * The sample-data flag in app_settings is *not* reset — once removed,
 * the seeder won't repopulate even after the rows are gone. Re-seeding
 * is a dev workflow, available via `npm run db:seed -- --force`. */

interface SampleCounts {
  sampleAccounts: number;
  sampleTransactions: number;
  sampleScheduled: number;
  samplePayeeRules: number;
  /** User-created rows attached to sample accounts. The DELETE in
   * POST will sweep these too — surface the count first so the
   * confirm dialog can warn. */
  dependentNonSample: {
    transactions: number;
    scheduled: number;
  };
  sampleDataSeeded: boolean;
}

async function readCounts(): Promise<SampleCounts> {
  const [accountIds, sampleTxnCount, sampleSchedCount, samplePayeeCount, settings] =
    await Promise.all([
      db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.isSample, true)),
      db
        .select({ n: sql<number>`count(*)` })
        .from(transactions)
        .where(eq(transactions.isSample, true)),
      db
        .select({ n: sql<number>`count(*)` })
        .from(scheduledTransactions)
        .where(eq(scheduledTransactions.isSample, true)),
      db
        .select({ n: sql<number>`count(*)` })
        .from(payeeRules)
        .where(eq(payeeRules.isSample, true)),
      db
        .select({ flag: appSettings.sampleDataSeeded })
        .from(appSettings)
        .where(eq(appSettings.id, 1)),
    ]);

  const sampleAccountIds = accountIds.map((a) => a.id);
  let dependentTxns = 0;
  let dependentScheduled = 0;
  if (sampleAccountIds.length > 0) {
    const [t, s] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)` })
        .from(transactions)
        .where(
          and(
            inArray(transactions.accountId, sampleAccountIds),
            ne(transactions.isSample, true),
          ),
        ),
      db
        .select({ n: sql<number>`count(*)` })
        .from(scheduledTransactions)
        .where(
          and(
            inArray(scheduledTransactions.accountId, sampleAccountIds),
            ne(scheduledTransactions.isSample, true),
          ),
        ),
    ]);
    dependentTxns = Number(t[0]?.n ?? 0);
    dependentScheduled = Number(s[0]?.n ?? 0);
  }

  return {
    sampleAccounts: sampleAccountIds.length,
    sampleTransactions: Number(sampleTxnCount[0]?.n ?? 0),
    sampleScheduled: Number(sampleSchedCount[0]?.n ?? 0),
    samplePayeeRules: Number(samplePayeeCount[0]?.n ?? 0),
    dependentNonSample: {
      transactions: dependentTxns,
      scheduled: dependentScheduled,
    },
    sampleDataSeeded: settings[0]?.flag === true,
  };
}

export const GET = withAdminAuth(async () => {
  const counts = await readCounts();
  return NextResponse.json(counts);
});

export const POST = withAdminAuth(async () => {
  const counts = await readCounts();
  if (counts.sampleAccounts === 0 && counts.sampleTransactions === 0 && counts.sampleScheduled === 0 && counts.samplePayeeRules === 0) {
    return NextResponse.json({ ok: true, removed: counts });
  }

  // Pre-removal snapshot — matches the pre-restore convention so the
  // operator always has an undo path. Failure here aborts the
  // removal: better to keep the data than to wipe without a backup.
  try {
    await takeBackup("pre-restore");
  } catch (e) {
    return NextResponse.json(
      {
        error:
          "Failed to take pre-removal backup; aborting. " +
          (e instanceof Error ? e.message : String(e)),
      },
      { status: 500 },
    );
  }

  // Single transaction. transactions and scheduled are deleted by
  // the FK ON DELETE CASCADE when the parent account goes, so the
  // explicit DELETEs below cover the cases where the row is itself
  // sample without sitting on a sample account, plus any non-sample
  // rows the user attached to a sample account (caught by the
  // accountId filter).
  await db.transaction(async (tx) => {
    const sampleAccountRows = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.isSample, true));
    const sampleAccountIds = sampleAccountRows.map((a) => a.id);

    await tx.delete(transactions).where(eq(transactions.isSample, true));
    await tx
      .delete(scheduledTransactions)
      .where(eq(scheduledTransactions.isSample, true));
    await tx.delete(payeeRules).where(eq(payeeRules.isSample, true));

    if (sampleAccountIds.length > 0) {
      // Sweep any user rows still pointing at sample accounts so the
      // account delete doesn't get blocked by ON DELETE RESTRICT —
      // and matches what the GET counts surfaced as dependents.
      await tx
        .delete(transactions)
        .where(inArray(transactions.accountId, sampleAccountIds));
      await tx
        .delete(scheduledTransactions)
        .where(inArray(scheduledTransactions.accountId, sampleAccountIds));
      await tx.delete(accounts).where(eq(accounts.isSample, true));
    }
  });

  const after = await readCounts();
  return NextResponse.json({
    ok: true,
    removed: {
      accounts: counts.sampleAccounts,
      transactions: counts.sampleTransactions + counts.dependentNonSample.transactions,
      scheduled: counts.sampleScheduled + counts.dependentNonSample.scheduled,
      payeeRules: counts.samplePayeeRules,
    },
    counts: after,
  });
});
