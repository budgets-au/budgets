/**
 * Golden test for per-account balance reconciliation. Seeds the
 * Golden Book and confirms each account's stored currentBalance
 * matches starting_balance + Σ(amounts). This is the formula behind
 * the dashboard's "Current balance" pill — drift here is the most
 * user-visible accounting bug there is.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, transactions } from "@/db/schema";
import {
  ACC,
  seedGoldenBook,
} from "@/lib/test-fixtures/golden-book";
import { ACCOUNT_BALANCE_END } from "@/lib/test-fixtures/golden-book-truth";
import {
  assertAccountReconciliation,
  assertConservationOfMoney,
  type RawTxn,
} from "@/lib/test-invariants/accounting-invariants";
import { createTestDb, type TestDb } from "./_helpers/test-db";

describe("golden / per-account balance reconciliation", () => {
  let db: TestDb;

  beforeAll(() => {
    db = createTestDb();
    seedGoldenBook(db.drizzleDb);
  });
  afterAll(() => {
    db.close();
  });

  for (const [name, accId] of [
    ["cheque", ACC.cheque],
    ["savings", ACC.savings],
  ] as const) {
    it(`${name}: currentBalance == starting + Σ(amounts)`, () => {
      const acc = db.drizzleDb
        .select()
        .from(accounts)
        .where(eq(accounts.id, accId))
        .all()[0];
      const txns = db.drizzleDb
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, accId))
        .all();
      assertAccountReconciliation(acc, txns);
    });
    it(`${name}: ending balance matches the truth table`, () => {
      const acc = db.drizzleDb
        .select()
        .from(accounts)
        .where(eq(accounts.id, accId))
        .all()[0];
      expect(parseFloat(acc.currentBalance)).toBeCloseTo(
        ACCOUNT_BALANCE_END[name],
        2,
      );
    });
  }

  it("internal-transfer pairs sum to zero across both accounts", () => {
    // Pull every txn + join its category's transferKind so the
    // invariant has what it needs.
    const rows = db.client
      .prepare(
        `SELECT t.account_id, t.amount, c.transfer_kind AS ck
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id`,
      )
      .all() as Array<{ account_id: string; amount: string; ck: string | null }>;
    const txns: RawTxn[] = rows.map((r) => ({
      accountId: r.account_id,
      amount: r.amount,
      categoryTransferKind: r.ck,
    }));
    assertConservationOfMoney(txns);
  });
});
