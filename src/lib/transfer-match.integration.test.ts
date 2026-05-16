import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, categories, transactions } from "@/db/schema";
import {
  createTestDb,
  installTestDb,
  type TestDb,
} from "@/__tests__/golden/_helpers/test-db";

/**
 * End-to-end tests for `pairTransfersInWindow` (the real entry point
 * the `/api/transfers/repair` endpoint calls). The pure-unit scoring
 * tests live in `./transfer-match.test.ts`; this file exercises the
 * full SQL → score → tiebreak → greedy-pair flow against an in-memory
 * SQLite that has the same schema as prod.
 *
 * The motivating bug: when two same-day same-amount transfers happen
 * between four distinct accounts with generic payees, the v0.122-era
 * matcher gave up (top-of-byTxn ties → bestFor returned null) and left
 * everything unpaired. The fix adds:
 *   1. a posted-order tiebreaker (third sort key in `bestFor` + outer
 *      greedy)
 *   2. live-filtering of taken candidates inside `bestFor` so cascading
 *      uniqueness resolves the assignment after the first pair commits.
 */

let db: TestDb;
let pairTransfersInWindow: (typeof import("./transfer-match"))["pairTransfersInWindow"];

beforeAll(async () => {
  db = createTestDb();
  installTestDb(db);
  // Dynamic import AFTER installTestDb so transfer-match.ts's `@/db`
  // resolve hits our in-memory handle.
  ({ pairTransfersInWindow } = await import("./transfer-match"));

  // Seed the always-needed system rows: a single "internal" transfer
  // category so the matcher's transfer-kind signal fires consistently.
  db.drizzleDb
    .insert(categories)
    .values({
      id: "cat-internal",
      name: "Internal Transfer",
      type: "expense",
      transferKind: "internal",
    })
    .run();
});

afterAll(() => {
  db.close();
});

beforeEach(() => {
  // Wipe state between tests so each scenario seeds from a clean
  // slate. Categories survive (seeded once in beforeAll).
  db.client.exec("DELETE FROM transfer_suggestions");
  db.client.exec("DELETE FROM transactions");
  db.client.exec("DELETE FROM accounts");
});

function seedAccount(id: string, name: string, type = "checking"): void {
  db.drizzleDb
    .insert(accounts)
    .values({
      id,
      name,
      type,
      currentBalance: "0",
      startingBalance: "0",
    })
    .run();
}

function seedTxn(opts: {
  id: string;
  accountId: string;
  amount: string;
  date: string;
  postedSeq?: number;
  payee?: string | null;
  /** `undefined` defaults to the seeded internal-transfer category;
   *  pass `null` to leave the transaction uncategorised. (`??`-style
   *  defaulting would collapse explicit nulls — careful.) */
  categoryId?: string | null;
  createdAt?: Date;
}): void {
  db.drizzleDb
    .insert(transactions)
    .values({
      id: opts.id,
      accountId: opts.accountId,
      amount: opts.amount,
      date: opts.date,
      payee: opts.payee ?? null,
      categoryId:
        "categoryId" in opts ? opts.categoryId : "cat-internal",
      postedSeq: opts.postedSeq ?? null,
      createdAt: opts.createdAt ?? new Date(),
    })
    .run();
}

function pairIdOf(txnId: string): string | null {
  return (
    db.drizzleDb
      .select({ id: transactions.id, pairId: transactions.transferPairId })
      .from(transactions)
      .all()
      .find((r) => r.id === txnId)?.pairId ?? null
  );
}

describe("pairTransfersInWindow — same-day same-amount collision", () => {
  it("pairs A↔B and C↔D when correct candidates outscore cross-pairs", async () => {
    // Four-way collision where the correct pairs' payees mention
    // the destination but the cross-pairs' payees don't — so the
    // correct-pair score is strictly higher (8) than the cross-pair
    // (6 — both-linked + shared "INTERNET" token + same-day).
    // Tests that the algorithm processes high-score candidates
    // first and the live-filter in `bestFor` lets the second
    // correct pair commit even though its candidates partially
    // overlap with already-taken cross-pairs.
    seedAccount("checking", "Checking");
    seedAccount("savings", "Savings");
    seedAccount("brokerage", "Brokerage");

    seedTxn({
      id: "chk-1",
      accountId: "checking",
      amount: "-500",
      date: "2026-05-16",
      payee: "INTERNET TFR SAVINGS",
    });
    seedTxn({
      id: "sav-1",
      accountId: "savings",
      amount: "500",
      date: "2026-05-16",
      payee: "INTERNET TFR SAVINGS",
    });
    seedTxn({
      id: "chk-2",
      accountId: "checking",
      amount: "-500",
      date: "2026-05-16",
      payee: "INTERNET TFR BROKERAGE",
    });
    seedTxn({
      id: "brk-1",
      accountId: "brokerage",
      amount: "500",
      date: "2026-05-16",
      payee: "INTERNET TFR BROKERAGE",
    });

    const result = await pairTransfersInWindow({});

    expect(result.paired).toBe(2);
    expect(pairIdOf("chk-1")).toBe("sav-1");
    expect(pairIdOf("sav-1")).toBe("chk-1");
    expect(pairIdOf("chk-2")).toBe("brk-1");
    expect(pairIdOf("brk-1")).toBe("chk-2");
  });

  it("defers all four to suggestions when scores genuinely tie across cross-pairs", async () => {
    // Truly ambiguous case: every leg's payee mentions every other
    // account name. All four candidates score identically. The
    // matcher must NOT guess — defer to suggestions so the user
    // can manually link via the dialog.
    seedAccount("checking", "Checking");
    seedAccount("savings", "Savings");
    seedAccount("brokerage", "Brokerage");

    // Payees mention both destinations on every leg, so the cross
    // pairs score the same as the correct pairs.
    const sharedPayee = "TRANSFER SAVINGS BROKERAGE CHECKING";
    for (const seed of [
      { id: "chk-1", accountId: "checking", amount: "-500", postedSeq: 1 },
      { id: "sav-1", accountId: "savings", amount: "500", postedSeq: 2 },
      { id: "chk-2", accountId: "checking", amount: "-500", postedSeq: 3 },
      { id: "brk-1", accountId: "brokerage", amount: "500", postedSeq: 4 },
    ]) {
      seedTxn({ ...seed, date: "2026-05-16", payee: sharedPayee });
    }

    const result = await pairTransfersInWindow({});

    // Genuinely indistinguishable on score+gap+tiebreak →
    // mutual-best returns null → nothing auto-pairs. The user
    // resolves via the suggestions panel or the manual-link
    // dialog. Pinned as a regression: don't ever guess when the
    // algorithm can't disambiguate.
    expect(result.paired).toBe(0);
    expect(pairIdOf("chk-1")).toBeNull();
    expect(pairIdOf("sav-1")).toBeNull();
    expect(pairIdOf("chk-2")).toBeNull();
    expect(pairIdOf("brk-1")).toBeNull();
  });

  it("pairs a single same-day transfer cleanly (regression: no collision)", async () => {
    seedAccount("checking", "Checking");
    seedAccount("savings", "Savings");

    seedTxn({
      id: "chk-1",
      accountId: "checking",
      amount: "-500",
      date: "2026-05-16",
      payee: "TFR TO SAVINGS",
    });
    seedTxn({
      id: "sav-1",
      accountId: "savings",
      amount: "500",
      date: "2026-05-16",
      payee: "FROM CHECKING",
    });

    const result = await pairTransfersInWindow({});

    expect(result.paired).toBe(1);
    expect(pairIdOf("chk-1")).toBe("sav-1");
    expect(pairIdOf("sav-1")).toBe("chk-1");
  });

  it("does not pair when score < AUTO_THRESHOLD even with posted_seq alignment", async () => {
    // Same-day, same-amount, generic payees, NO transfer-kind
    // category (left null). Score = 1 (same-day only). Below
    // SUGGEST_THRESHOLD-but-above-AUTO_THRESHOLD threshold — should
    // surface as a suggestion (or nothing), never auto-pair.
    // Pinned to make sure the new tiebreaker doesn't accidentally
    // start auto-pairing low-score candidates just because their
    // posted_seq are adjacent.
    seedAccount("checking", "Checking");
    seedAccount("savings", "Savings");

    seedTxn({
      id: "chk-1",
      accountId: "checking",
      amount: "-500",
      date: "2026-05-16",
      postedSeq: 1,
      payee: "PAYMENT",
      categoryId: null,
    });
    seedTxn({
      id: "sav-1",
      accountId: "savings",
      amount: "500",
      date: "2026-05-16",
      postedSeq: 2,
      payee: "PAYMENT",
      categoryId: null,
    });

    const result = await pairTransfersInWindow({});
    expect(result.paired).toBe(0);
    expect(pairIdOf("chk-1")).toBeNull();
    expect(pairIdOf("sav-1")).toBeNull();
  });
});
