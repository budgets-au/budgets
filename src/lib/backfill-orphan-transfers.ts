// The drizzle `db` handle is now PASSED IN as a parameter rather
// than reached for via require("@/db").db. Pre-0.213 the latter
// worked in dev but the production webpack bundle hit a temporal-
// dead-zone error every time runOrphanTransferBackfill (called
// from unlock()) reached back through getDb(): `ReferenceError:
// Cannot access 'D' before initialization`. The lazy-require
// pattern wasn't enough — webpack's chunked bundle still cycled
// through Module.db's getter before its closure had finished
// initialising. Passing the handle in inverts the dependency and
// removes the cycle entirely.
import { accounts, appSettings, transactions, categories } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import type { db as dbType } from "@/db";

/** Default external-account name used when backfill mints synthetics
 * for legacy orphan transfer rows. The user can rename or split this
 * later via Settings → Accounts; we don't try to guess counterparty
 * names from payee text. */
const DEFAULT_EXTERNAL_NAME = "External";

interface OrphanRow {
  id: string;
  account_id: string;
  date: string;
  amount: string;
}

/**
 * One-shot backfill that gives every "this is a transfer" row a
 * `transfer_pair_id` by minting synthetic counterparties in a default
 * `isExternal=true` "External" account.
 *
 * Targets two flavours of orphan:
 *   1. `is_transfer=1 AND transfer_pair_id IS NULL` — rows the user
 *      manually flagged or the matcher tagged but couldn't pair
 *      (auto-matcher used to set the flag even on rejected candidates).
 *   2. `transfer_pair_id IS NULL AND category.transfer_kind IN
 *      ('internal','external')` — categorised-as-transfer rows that
 *      were never paired (legacy data from before the matcher landed,
 *      or from manual category assignment).
 *
 * Runs OUTSIDE a single transaction (better-sqlite3 limits transaction
 * size, and the loop's row count can be large). Each pair insert is
 * its own atomic step.
 *
 * Caller is responsible for the once-per-DB gating. The unlock-time
 * runner in `db/index.ts` checks `app_settings.transfer_backfill_done`
 * and only invokes this when the flag is false, then sets it true.
 * Re-runs are opt-in via Settings → Maintenance → "Re-run transfer
 * backfill".
 */
export function backfillOrphanTransfers(db: typeof dbType): { paired: number } {
  // 1. Find-or-create the default external account.
  const existingExternal = db.all(sql`
    SELECT id FROM accounts
    WHERE LOWER(name) = ${DEFAULT_EXTERNAL_NAME.toLowerCase()}
      AND is_external = 1
    LIMIT 1
  `) as Array<{ id: string }>;
  let externalAccountId: string;
  if (existingExternal.length > 0) {
    externalAccountId = existingExternal[0].id;
  } else {
    const [created] = db
      .insert(accounts)
      .values({
        name: DEFAULT_EXTERNAL_NAME,
        type: "cash",
        currency: "AUD",
        isExternal: true,
        isArchived: false,
        startingBalance: "0",
        currentBalance: "0",
      })
      .returning({ id: accounts.id })
      .all();
    externalAccountId = created.id;
  }

  // 2. Collect orphans from both sources. Union-ish via two queries.
  // Distinct on id (an orphan could theoretically satisfy both
  // conditions; we want to back-pair it once).
  const orphansByFlag = db.all(sql`
    SELECT id, account_id, date, amount
    FROM transactions
    WHERE is_transfer = 1
      AND transfer_pair_id IS NULL
  `) as OrphanRow[];

  const orphansByCategory = db.all(sql`
    SELECT t.id, t.account_id, t.date, t.amount
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.transfer_pair_id IS NULL
      AND c.transfer_kind IN ('internal','external')
  `) as OrphanRow[];

  const seen = new Set<string>();
  const orphans: OrphanRow[] = [];
  for (const r of [...orphansByFlag, ...orphansByCategory]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    orphans.push(r);
  }

  if (orphans.length === 0) return { paired: 0 };

  // 3. For each orphan, insert a synthetic counterpart in the External
  // account with the opposite amount + same date, then link both sides.
  // Per-row try/catch so one bad row doesn't abort the whole sweep.
  // Issue #65: after the loop we'll recompute the External account's
  // currentBalance once so the dashboard / accounts list / cashflow
  // back-compute don't anchor at the now-stale zero.
  let paired = 0;
  for (const orphan of orphans) {
    try {
      const oppositeAmount = (-parseFloat(orphan.amount)).toFixed(2);
      const [synthetic] = db
        .insert(transactions)
        .values({
          accountId: externalAccountId,
          date: orphan.date,
          amount: oppositeAmount,
          payee: "External transfer",
          description: null,
          categoryId: null,
          isTransfer: true,
          isSynthetic: true,
          transferPairId: orphan.id,
        })
        .returning({ id: transactions.id })
        .all();
      db
        .update(transactions)
        .set({
          transferPairId: synthetic.id,
          isTransfer: true,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, orphan.id))
        .run();
      paired += 1;
    } catch (e) {
      console.error(
        `[backfill-orphan-transfers] failed to pair ${orphan.id}:`,
        e,
      );
    }
  }
  // Recompute the External account's currentBalance after the batch
  // — see #65 for why this is needed. Standard pattern: starting
  // balance + sum(amount) of every txn on the account.
  if (paired > 0) {
    db
      .update(accounts)
      .set({
        currentBalance: sql`(SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE account_id = ${externalAccountId}) + ${accounts.startingBalance}`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, externalAccountId))
      .run();
  }

  return { paired };
}

/** Back-compat alias kept so the prior `backfillOrphanTransfersWith(db)`
 *  callers (tests) don't need to change names. The signature is now
 *  identical to `backfillOrphanTransfers` because `db` is always a
 *  parameter. */
export const backfillOrphanTransfersWith = backfillOrphanTransfers;

/**
 * Gate + run the backfill within a single `BEGIN IMMEDIATE`
 * transaction. The flag-read + backfill + flag-write must be atomic
 * (issue #49: two concurrent unlock paths racing the gate could
 * double-mint synthetic counterparts). Designed to be called from
 * the unlock path with `state.drizzleDb`, but also testable in
 * isolation against any drizzle handle.
 *
 * Returns `{ ran, paired }`:
 * - `ran: false` → flag was already set; nothing executed.
 * - `ran: true` → backfill executed; `paired` is the count of
 *   newly-minted synthetic counterparties (may be 0 on a fresh DB).
 *
 * Re-runs are opt-in via Settings → Maintenance → "Re-run transfer
 * backfill", which clears the flag before calling this again.
 */
export function runOrphanBackfillIfNeeded(
  db: typeof dbType,
): { ran: boolean; paired: number } {
  return db.transaction((tx) => {
    const flagRows = tx
      .select({ flag: appSettings.transferBackfillDone })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .all();
    if (flagRows[0]?.flag) return { ran: false, paired: 0 };

    const result = backfillOrphanTransfers(tx as typeof dbType);

    // Mark the flag regardless of whether anything was paired —
    // a fresh DB with zero orphans still "counts" as backfilled.
    tx
      .insert(appSettings)
      .values({ id: 1, transferBackfillDone: true })
      .onConflictDoUpdate({
        target: appSettings.id,
        set: { transferBackfillDone: true, updatedAt: new Date() },
      })
      .run();

    return { ran: true, paired: result.paired };
  }, { behavior: "immediate" });
}
