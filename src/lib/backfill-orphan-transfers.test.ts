import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/__tests__/golden/_helpers/test-db";
import { accounts, appSettings, categories, transactions } from "@/db/schema";
import {
  backfillOrphanTransfers,
  runOrphanBackfillIfNeeded,
} from "./backfill-orphan-transfers";

/** Unit coverage for the orphan-transfer backfill (#12).
 *
 *  Two layers:
 *
 *   - `backfillOrphanTransfers(db)` — the worker. Finds rows that
 *     are marked as transfers but have no counterparty and mints
 *     synthetic counterparts on an "External" account.
 *
 *   - `runOrphanBackfillIfNeeded(db)` — the gate. Wraps the
 *     worker in a BEGIN IMMEDIATE transaction, checks the
 *     `app_settings.transfer_backfill_done` flag first, and
 *     sets it after a successful run. Returns `{ ran, paired }`
 *     so the caller can log only when there was work to do.
 *
 *  The gate's contract is what this issue is about: restoring an
 *  older DB with the flag already set must NOT re-fire the
 *  backfill (a double-mint would corrupt the ledger). */

interface OrphanSeed {
  /** Account id to attach the orphan to. */
  accountId: string;
  /** Amount as a string (e.g. "-100"). */
  amount: string;
  /** Date in YYYY-MM-DD. */
  date: string;
  /** Payee text for the orphan row. */
  payee: string;
}

function seedOrphan(db: TestDb, seed: OrphanSeed): string {
  // The backfill function looks for transfer-marked rows with no
  // pair set. Use drizzle's typed insert so timestamp columns are
  // handled correctly (the schema uses `timestamp_ms` mode →
  // integer milliseconds, NOT ISO strings).
  const [cat] = db.drizzleDb
    .insert(categories)
    .values({
      name: `Transfer-${seed.payee}`,
      type: "expense",
      transferKind: "internal",
    })
    .returning()
    .all();
  const [txn] = db.drizzleDb
    .insert(transactions)
    .values({
      accountId: seed.accountId,
      date: seed.date,
      amount: seed.amount,
      payee: seed.payee,
      categoryId: cat.id,
      isTransfer: true,
      transferPairId: null,
      isSynthetic: false,
    })
    .returning()
    .all();
  return txn.id;
}

describe("orphan-transfer backfill (#12)", () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("backfillOrphanTransfers mints synthetics on the External account", () => {
    // Seed: one real account, one orphan transfer txn.
    const insertedAccts = db.drizzleDb
      .insert(accounts)
      .values({
        name: "Checking",
        type: "checking",
        currency: "AUD",
        startingBalance: "0",
        currentBalance: "0",
      })
      .returning()
      .all();
    const acct = insertedAccts[0];
    seedOrphan(db, {
      accountId: acct.id,
      amount: "-100",
      date: "2026-04-15",
      payee: "atm-withdrawal",
    });

    const result = backfillOrphanTransfers(db.drizzleDb);
    expect(result.paired).toBe(1);

    // External account exists and is flagged.
    const ext = db.drizzleDb
      .select()
      .from(accounts)
      .where(eq(accounts.isExternal, true))
      .all();
    expect(ext).toHaveLength(1);
    expect(ext[0].name).toBe("External");

    // The orphan now has a pair pointing at a synthetic on
    // External, and the synthetic carries the opposite-sign amount.
    const allTxns = db.drizzleDb.select().from(transactions).all();
    expect(allTxns).toHaveLength(2);
    const orphan = allTxns.find((t) => t.payee === "atm-withdrawal")!;
    const synthetic = allTxns.find((t) => t.isSynthetic)!;
    expect(orphan.transferPairId).toBe(synthetic.id);
    expect(synthetic.transferPairId).toBe(orphan.id);
    expect(parseFloat(synthetic.amount)).toBe(100);
    expect(synthetic.accountId).toBe(ext[0].id);
  });

  it("runOrphanBackfillIfNeeded runs once + sets the flag; second call no-ops", () => {
    const insertedAccts = db.drizzleDb
      .insert(accounts)
      .values({
        name: "Checking",
        type: "checking",
        currency: "AUD",
        startingBalance: "0",
        currentBalance: "0",
      })
      .returning()
      .all();
    const acct = insertedAccts[0];
    seedOrphan(db, {
      accountId: acct.id,
      amount: "-100",
      date: "2026-04-15",
      payee: "atm-1",
    });

    // First call: runs, pairs 1.
    const first = runOrphanBackfillIfNeeded(db.drizzleDb);
    expect(first.ran).toBe(true);
    expect(first.paired).toBe(1);

    // Flag is set.
    const flagRows = db.drizzleDb
      .select({ flag: appSettings.transferBackfillDone })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .all();
    expect(flagRows[0]?.flag).toBe(true);

    // Seed ANOTHER orphan — this would normally be paired.
    seedOrphan(db, {
      accountId: acct.id,
      amount: "-50",
      date: "2026-04-20",
      payee: "atm-2",
    });

    // Second call: flag is set, gate refuses to run. The new
    // orphan is left untouched — guarantees re-runs are opt-in.
    const second = runOrphanBackfillIfNeeded(db.drizzleDb);
    expect(second.ran).toBe(false);
    expect(second.paired).toBe(0);

    // Count synthetics: still 1 (the second orphan wasn't paired).
    const synthetics = db.drizzleDb
      .select()
      .from(transactions)
      .where(eq(transactions.isSynthetic, true))
      .all();
    expect(synthetics).toHaveLength(1);
  });

  it("runOrphanBackfillIfNeeded sets the flag even on a zero-orphan fresh DB", () => {
    const result = runOrphanBackfillIfNeeded(db.drizzleDb);
    expect(result.ran).toBe(true);
    expect(result.paired).toBe(0);

    const flagRows = db.drizzleDb
      .select({ flag: appSettings.transferBackfillDone })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .all();
    expect(flagRows[0]?.flag).toBe(true);
  });

  it("runOrphanBackfillIfNeeded second call after flag-clear re-fires (Settings → Re-run)", () => {
    // First run sets the flag.
    runOrphanBackfillIfNeeded(db.drizzleDb);

    // Operator clears the flag via Settings → Maintenance →
    // "Re-run transfer backfill". Simulate that.
    db.drizzleDb
      .update(appSettings)
      .set({ transferBackfillDone: false })
      .where(eq(appSettings.id, 1))
      .run();

    // Second call now re-fires.
    const second = runOrphanBackfillIfNeeded(db.drizzleDb);
    expect(second.ran).toBe(true);
  });
});
