import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, transactions } from "@/db/schema";
import {
  createTestDb,
  installTestDb,
  type TestDb,
} from "@/__tests__/golden/_helpers/test-db";

let db: TestDb;
let manualPairExternal: (typeof import("./transfer-match"))["manualPairExternal"];
let manualUnpair: (typeof import("./transfer-match"))["manualUnpair"];

beforeAll(async () => {
  db = createTestDb();
  installTestDb(db);
  ({ manualPairExternal, manualUnpair } = await import("./transfer-match"));
});

afterAll(() => {
  db.close();
});

beforeEach(() => {
  db.client.exec("DELETE FROM transfer_suggestions");
  db.client.exec("DELETE FROM transactions");
  db.client.exec("DELETE FROM accounts");
});

function seedAccount(
  id: string,
  name: string,
  opts?: { isExternal?: boolean },
): void {
  db.drizzleDb
    .insert(accounts)
    .values({
      id,
      name,
      type: "checking",
      currentBalance: "0",
      startingBalance: "0",
      isExternal: opts?.isExternal ?? false,
    })
    .run();
}

function seedTxn(id: string, accountId: string, amount: string): void {
  db.drizzleDb
    .insert(transactions)
    .values({
      id,
      accountId,
      amount,
      date: "2026-05-17",
      payee: "Test payee",
    })
    .run();
}

describe("manualPairExternal", () => {
  it("creates a new external account when none exists and links the pair", async () => {
    seedAccount("checking", "Checking");
    seedTxn("src-1", "checking", "-500.00");

    const result = await manualPairExternal("src-1", "HSBC savings");

    const source = db.drizzleDb
      .select()
      .from(transactions)
      .where(eq(transactions.id, "src-1"))
      .all()[0];
    const synthetic = db.drizzleDb
      .select()
      .from(transactions)
      .where(eq(transactions.id, result.syntheticId))
      .all()[0];
    const externalAccount = db.drizzleDb
      .select()
      .from(accounts)
      .where(eq(accounts.id, result.externalAccountId))
      .all()[0];

    expect(source.transferPairId).toBe(synthetic.id);
    expect(synthetic.transferPairId).toBe("src-1");
    expect(synthetic.amount).toBe("500.00");
    expect(synthetic.isSynthetic).toBe(true);
    expect(synthetic.payee).toBe("External transfer");
    expect(externalAccount.name).toBe("HSBC savings");
    expect(externalAccount.isExternal).toBe(true);
  });

  it("reuses an existing external account on case-insensitive name match", async () => {
    seedAccount("checking", "Checking");
    seedAccount("existing-ext", "HSBC Savings", { isExternal: true });
    seedTxn("src-1", "checking", "-200.00");

    const result = await manualPairExternal("src-1", "hsbc savings");

    expect(result.externalAccountId).toBe("existing-ext");
    // No second account created.
    const allExternals = db.drizzleDb
      .select()
      .from(accounts)
      .where(eq(accounts.isExternal, true))
      .all();
    expect(allExternals).toHaveLength(1);
  });

  it("deletes the synthetic when manualUnpair is called on the source", async () => {
    seedAccount("checking", "Checking");
    seedTxn("src-1", "checking", "-100.00");
    const { syntheticId } = await manualPairExternal("src-1", "PayPal");

    await manualUnpair("src-1");

    const source = db.drizzleDb
      .select()
      .from(transactions)
      .where(eq(transactions.id, "src-1"))
      .all()[0];
    const syntheticAfter = db.drizzleDb
      .select()
      .from(transactions)
      .where(eq(transactions.id, syntheticId))
      .all();
    expect(source.transferPairId).toBeNull();
    // Synthetic deleted outright.
    expect(syntheticAfter).toHaveLength(0);
  });

  it("clears a pre-existing pair on the source before re-pairing externally", async () => {
    seedAccount("checking", "Checking");
    seedAccount("savings", "Savings");
    seedTxn("src-1", "checking", "-300.00");
    seedTxn("dst-1", "savings", "300.00");
    // Pre-link these two as a regular pair.
    db.drizzleDb
      .update(transactions)
      .set({ transferPairId: "dst-1" })
      .where(eq(transactions.id, "src-1"))
      .run();
    db.drizzleDb
      .update(transactions)
      .set({ transferPairId: "src-1" })
      .where(eq(transactions.id, "dst-1"))
      .run();

    await manualPairExternal("src-1", "External");

    // The pre-existing destination's pair should be cleared (no more
    // dangling pointer) — and the source is now linked to a new
    // synthetic in an external account.
    const dst = db.drizzleDb
      .select()
      .from(transactions)
      .where(eq(transactions.id, "dst-1"))
      .all()[0];
    expect(dst.transferPairId).toBeNull();
  });
});
