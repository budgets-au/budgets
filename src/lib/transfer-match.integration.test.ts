import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, categories, transactions } from "@/db/schema";
import {
  createTestDb,
  installTestDb,
  type TestDb,
} from "@/__tests__/golden/_helpers/test-db";

/** Convenience filter — every test repeatedly queries a single
 *  transaction by id, so wrap the drizzle WHERE clause once. */
const eqTxnId = (id: string) => eq(transactions.id, id);

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

describe("pairTransfersInWindow — realistic single-bank flows", () => {
  it("pairs a transfer where one payee names the other account's name (lenient word match)", async () => {
    // The typical bank statement: "TFR Savings Cara…" truncated on
    // the source side, plain "Internet Transfer" on the destination.
    // Score = 1 (same-day) + 5 (a_payee mentions "Savings", a >=5
    // char word in b's account name) = 6 ≥ AUTO_THRESHOLD. No
    // transfer-kind needed.
    seedAccount("checking", "Checking");
    seedAccount("savings", "Savings");
    seedTxn({
      id: "chk-1",
      accountId: "checking",
      amount: "-200",
      date: "2026-05-16",
      payee: "TFR Savings Caravan",
      categoryId: null,
    });
    seedTxn({
      id: "sav-1",
      accountId: "savings",
      amount: "200",
      date: "2026-05-16",
      payee: "Internet Transfer",
      categoryId: null,
    });

    const result = await pairTransfersInWindow({});
    expect(result.paired).toBe(1);
    expect(pairIdOf("chk-1")).toBe("sav-1");
    expect(pairIdOf("sav-1")).toBe("chk-1");
  });

  it("pairs across a ±3 day gap (bank posts the credit a day late)", async () => {
    seedAccount("checking", "Checking");
    seedAccount("savings", "Savings");
    seedTxn({
      id: "chk-1",
      accountId: "checking",
      amount: "-300",
      date: "2026-05-15",
      payee: "TFR Savings",
    });
    seedTxn({
      id: "sav-1",
      accountId: "savings",
      amount: "300",
      // Posted 2 days later — within MAX_DATE_GAP_DAYS (3).
      date: "2026-05-17",
      payee: "Internet Transfer",
    });
    const result = await pairTransfersInWindow({});
    expect(result.paired).toBe(1);
    expect(pairIdOf("chk-1")).toBe("sav-1");
  });

  it("refuses to pair across a >3 day gap (out of window)", async () => {
    seedAccount("checking", "Checking");
    seedAccount("savings", "Savings");
    seedTxn({
      id: "chk-1",
      accountId: "checking",
      amount: "-100",
      date: "2026-05-10",
      payee: "TFR Savings",
    });
    seedTxn({
      id: "sav-1",
      accountId: "savings",
      amount: "100",
      // 4 days later — outside MAX_DATE_GAP_DAYS.
      date: "2026-05-14",
      payee: "TFR Savings",
    });
    const result = await pairTransfersInWindow({});
    expect(result.paired).toBe(0);
    expect(pairIdOf("chk-1")).toBeNull();
  });
});

describe("pairTransfersInWindow — loan / credit boundary auto-categorisation", () => {
  /** Seed a Loan-Payment category (transferKind = external) so the
   *  matcher's auto-assign-payment-category branch has somewhere to
   *  put the source-side categorisation. */
  beforeEach(() => {
    db.drizzleDb
      .insert(categories)
      .values({
        id: "cat-loan-payment",
        name: "Loan Payment",
        type: "expense",
        transferKind: "external",
      })
      .run();
  });

  it("pairs a checking → loan payoff AND auto-assigns Loan Payment on the source", async () => {
    // Asymmetric account types — checking (asset) → loan (liability).
    // Score: 1 (same-day) + 3 (loan-boundary) + 5 (payee mentions
    // the loan account name) = 9 ≥ AUTO_THRESHOLD. The matcher
    // also patches the SOURCE leg's category to "Loan Payment" when
    // it was previously uncategorised — that's the auto-categorise
    // behaviour from transfer-match.ts lines 285-292.
    seedAccount("checking", "Checking");
    seedAccount("home-loan", "Home Loan", "loan");
    seedTxn({
      id: "chk-1",
      accountId: "checking",
      amount: "-1200",
      date: "2026-05-16",
      payee: "Home Loan Payment",
      // categoryId left undefined → defaults to "cat-internal" in
      // seedTxn; explicitly clear it so the auto-categorise branch
      // can fire.
      categoryId: null,
    });
    seedTxn({
      id: "loan-1",
      accountId: "home-loan",
      amount: "1200",
      date: "2026-05-16",
      payee: "Payment",
      categoryId: null,
    });

    const result = await pairTransfersInWindow({});
    expect(result.paired).toBe(1);
    expect(pairIdOf("chk-1")).toBe("loan-1");

    const [chk] = db.drizzleDb
      .select({ categoryId: transactions.categoryId })
      .from(transactions)
      .where(eqTxnId("chk-1"))
      .all();
    expect(chk.categoryId).toBe("cat-loan-payment");
  });
});

describe("pairTransfersInWindow — idempotency + protection of existing pairs", () => {
  it("doesn't re-match rows that are already paired (manual or auto)", async () => {
    seedAccount("a", "Account A");
    seedAccount("b", "Account B");
    // Two rows pre-paired manually (this is what the LinkTransferDialog
    // produces).
    seedTxn({ id: "a1", accountId: "a", amount: "-50", date: "2026-05-16" });
    seedTxn({ id: "b1", accountId: "b", amount: "50", date: "2026-05-16" });
    db.drizzleDb
      .update(transactions)
      .set({ transferPairId: "b1", isTransfer: true })
      .where(eqTxnId("a1"))
      .run();
    db.drizzleDb
      .update(transactions)
      .set({ transferPairId: "a1", isTransfer: true })
      .where(eqTxnId("b1"))
      .run();

    // Add a fresh, definitely-pairable transfer that should match
    // alongside without disturbing the existing pair.
    seedAccount("c", "Checking");
    seedAccount("d", "Savings");
    seedTxn({
      id: "c1",
      accountId: "c",
      amount: "-200",
      date: "2026-05-16",
      payee: "TFR Savings",
    });
    seedTxn({
      id: "d1",
      accountId: "d",
      amount: "200",
      date: "2026-05-16",
      payee: "Internet Transfer",
    });

    const result = await pairTransfersInWindow({});
    expect(result.paired).toBe(1);
    expect(pairIdOf("a1")).toBe("b1"); // unchanged
    expect(pairIdOf("b1")).toBe("a1"); // unchanged
    expect(pairIdOf("c1")).toBe("d1"); // newly paired
  });

  it("is safe to run twice — second sweep produces zero new pairs", async () => {
    seedAccount("checking", "Checking");
    seedAccount("savings", "Savings");
    seedTxn({
      id: "chk-1",
      accountId: "checking",
      amount: "-99",
      date: "2026-05-16",
      payee: "TFR Savings",
    });
    seedTxn({
      id: "sav-1",
      accountId: "savings",
      amount: "99",
      date: "2026-05-16",
      payee: "Internet Transfer",
    });

    const first = await pairTransfersInWindow({});
    expect(first.paired).toBe(1);
    const second = await pairTransfersInWindow({});
    expect(second.paired).toBe(0);
    expect(pairIdOf("chk-1")).toBe("sav-1");
    expect(pairIdOf("sav-1")).toBe("chk-1");
  });
});

describe("pairTransfersInWindow — dismissed pairs stay dismissed", () => {
  it("does not re-suggest a pair recorded in dismissed_transfer_pairs", async () => {
    // Two accounts with one same-day same-amount pair. Matcher
    // ordinarily emits a suggestion since the amount is small and
    // the txns are categorised generic-spending, not transfer.
    seedAccount("chk", "Checking");
    seedAccount("sav", "Savings");
    seedTxn({
      id: "a",
      accountId: "chk",
      amount: "-50.00",
      date: "2026-01-10",
      categoryId: null,
    });
    seedTxn({
      id: "b",
      accountId: "sav",
      amount: "50.00",
      date: "2026-01-10",
      categoryId: null,
    });

    // First run produces the suggestion.
    const first = await pairTransfersInWindow({});
    expect(first.suggested).toBe(1);
    const suggestionsBefore = db.client
      .prepare("SELECT COUNT(*) AS n FROM transfer_suggestions")
      .get() as { n: number };
    expect(suggestionsBefore.n).toBe(1);

    // Simulate the dismiss API: insert into dismissed_transfer_pairs
    // (canonical a<b order) and drop the suggestion row. After this
    // the matcher should keep its mouth shut about this pair.
    db.client
      .prepare(
        "INSERT INTO dismissed_transfer_pairs (transaction_id, candidate_id, dismissed_at) VALUES (?, ?, ?)",
      )
      .run("a", "b", Date.now());
    db.client.exec("DELETE FROM transfer_suggestions");

    const second = await pairTransfersInWindow({});
    expect(second.suggested).toBe(0);
    const suggestionsAfter = db.client
      .prepare("SELECT COUNT(*) AS n FROM transfer_suggestions")
      .get() as { n: number };
    expect(suggestionsAfter.n).toBe(0);
  });
});
