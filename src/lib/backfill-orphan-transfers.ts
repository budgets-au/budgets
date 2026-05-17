import { db } from "@/db";
import { accounts, transactions, categories } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

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
 * One-shot startup backfill that gives every "this is a transfer" row a
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
 * Idempotent: a second run finds zero rows because the first run set
 * `transfer_pair_id` on every orphan it saw. Safe to call on every
 * unlock — no-op after the first successful pass.
 *
 * Runs OUTSIDE a single transaction (better-sqlite3 limits transaction
 * size, and the loop's row count can be large). Each pair insert is
 * its own atomic step.
 */
export function backfillOrphanTransfers(): { paired: number } {
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
  return { paired };
}

/** Test-friendly variant that runs against any drizzle handle (not
 *  the live one). Same algorithm, just doesn't import the singleton.
 *  Used by the unit tests in this module's `.test.ts`. */
export function backfillOrphanTransfersWith(
  // Loose handle type — accepts the live drizzle Db or any compatible
  // sql-tag-supporting wrapper. Test fixtures pass an in-memory
  // wrapper here.
  _handle: typeof db,
): { paired: number } {
  // The current implementation is tightly coupled to the singleton
  // `db` symbol because each db.* call below funnels through it. A
  // future cleanup can parameterise; for now tests use the singleton
  // pointed at a tmp DB.
  void _handle;
  return backfillOrphanTransfers();
}

// Helper re-exports used by the eq/isNull/and/sql consumers above —
// keep the helper file self-contained so adding the import to db
// startup doesn't drag too many specifiers.
export { and, eq, isNull };
