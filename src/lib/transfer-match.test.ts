import { describe, it, expect } from "vitest";
import { scoreCandidate, AUTO_THRESHOLD, type CandidateRow } from "./transfer-match";

function candidate(over: Partial<CandidateRow> = {}): CandidateRow {
  return {
    a_id: "a",
    b_id: "b",
    a_payee: null,
    b_payee: null,
    a_account_name: "Savings",
    b_account_name: "Bills",
    a_account_last4: null,
    b_account_last4: null,
    a_account_type: "checking",
    b_account_type: "checking",
    a_is_transfer_cat: false,
    b_is_transfer_cat: false,
    a_is_payment_cat: false,
    b_is_payment_cat: false,
    a_category_id: null,
    b_category_id: null,
    date_gap: 0,
    ...over,
  };
}

describe("scoreCandidate — date proximity", () => {
  it("same-day +1, 1-day-apart 0, 2-day -1, 3-day -2", () => {
    expect(scoreCandidate(candidate({ date_gap: 0 }))).toBe(1);
    expect(scoreCandidate(candidate({ date_gap: 1 }))).toBe(0);
    expect(scoreCandidate(candidate({ date_gap: 2 }))).toBe(-1);
    expect(scoreCandidate(candidate({ date_gap: 3 }))).toBe(-2);
  });
});

describe("scoreCandidate — account-name match", () => {
  it("payee mentions the OTHER account's full name → +5", () => {
    const c = candidate({
      a_payee: "TRANSFER TO BILLS",
      b_account_name: "Bills",
      date_gap: 0,
    });
    // 0 (date) + 5 (account name) = 5
    expect(scoreCandidate(c)).toBe(6); // includes +1 same-day
  });

  it("significant ≥5-char word from the account name in the payee → +5", () => {
    // Bank truncated "Caravan Loan" payee to "TFR Caravan Loa" — payee
    // doesn't contain full name but does contain "CARAVAN" (≥5 chars).
    const c = candidate({
      a_payee: "TFR Caravan Loa",
      b_account_name: "Caravan Loan",
      date_gap: 0,
    });
    expect(scoreCandidate(c)).toBeGreaterThanOrEqual(AUTO_THRESHOLD);
  });

  it("4-char account word does NOT count as significant", () => {
    // "Loan" is 4 chars; only the full-name match should fire (or not at
    // all). Construct a payee that contains "LOAN" but not the full name.
    const c = candidate({
      a_payee: "PAYMENT FOR LOAN",
      b_account_name: "Loan",
      date_gap: 1, // no date bonus
    });
    // Full-name match fires because "Loan" is in payee → +5. But this is
    // the documented limitation: a 4-char account name still matches via
    // full payeeMentions, just not via the significant-word fallback.
    expect(scoreCandidate(c)).toBe(5);
  });
});

describe("scoreCandidate — last4 mention", () => {
  it("last4 of the OTHER account in the payee → +5", () => {
    const c = candidate({
      a_payee: "PMT TO 4321",
      b_account_last4: "4321",
      date_gap: 0,
    });
    expect(scoreCandidate(c)).toBe(6); // 1 (date) + 5 (last4)
  });
});

describe("scoreCandidate — shared reference token", () => {
  it("any 6+ alnum token shared between payees → +3 (only once)", () => {
    const c = candidate({
      a_payee: "TRANSFER REF AB123XY",
      b_payee: "DEPOSIT REF AB123XY",
      date_gap: 1,
    });
    expect(scoreCandidate(c)).toBe(3); // shared token only
  });

  it("a 5-char token is too short to count", () => {
    const c = candidate({
      a_payee: "REF AB12X",
      b_payee: "DEP AB12X",
      date_gap: 1,
    });
    // No 6+ char token; both account names fall back, no match.
    expect(scoreCandidate(c)).toBe(0);
  });
});

describe("scoreCandidate — linked-class signals", () => {
  it("both sides have transfer-class category → +2", () => {
    const c = candidate({
      a_is_transfer_cat: true,
      b_is_transfer_cat: true,
      date_gap: 1,
    });
    expect(scoreCandidate(c)).toBe(2);
  });

  it("payment-class on one side and transfer-class on the other → +2", () => {
    const c = candidate({
      a_is_payment_cat: true,
      b_is_transfer_cat: true,
      date_gap: 1,
    });
    expect(scoreCandidate(c)).toBe(2);
  });

  it("only one side linked → no bonus", () => {
    const c = candidate({
      a_is_transfer_cat: true,
      b_is_transfer_cat: false,
      date_gap: 1,
    });
    expect(scoreCandidate(c)).toBe(0);
  });
});

describe("scoreCandidate — asymmetric loan signal", () => {
  it("exactly one side is loan-typed → +3", () => {
    expect(
      scoreCandidate(
        candidate({ a_account_type: "loan", b_account_type: "checking", date_gap: 1 }),
      ),
    ).toBe(3);
    expect(
      scoreCandidate(
        candidate({ a_account_type: "checking", b_account_type: "credit", date_gap: 1 }),
      ),
    ).toBe(3);
  });

  it("both loan-typed (or neither) → no bonus", () => {
    expect(
      scoreCandidate(
        candidate({ a_account_type: "loan", b_account_type: "loan", date_gap: 1 }),
      ),
    ).toBe(0);
    expect(
      scoreCandidate(
        candidate({ a_account_type: "checking", b_account_type: "savings", date_gap: 1 }),
      ),
    ).toBe(0);
  });
});

describe("scoreCandidate — auto-link threshold combinations", () => {
  it("strong account-name match alone clears the threshold", () => {
    const c = candidate({
      a_payee: "Transfer to Savings",
      b_account_name: "Savings",
      date_gap: 0,
    });
    expect(scoreCandidate(c)).toBeGreaterThanOrEqual(AUTO_THRESHOLD);
  });

  it("loan + linked-cat + same-day combine to clear the threshold", () => {
    const c = candidate({
      a_account_type: "checking",
      b_account_type: "loan",
      a_is_transfer_cat: true,
      b_is_payment_cat: true,
      date_gap: 0,
    });
    // 1 (date) + 2 (linked) + 3 (asymmetric loan) = 6
    expect(scoreCandidate(c)).toBeGreaterThanOrEqual(AUTO_THRESHOLD);
  });

  it("pure inverse-amount + same-day alone does NOT auto-link", () => {
    const c = candidate({ date_gap: 0 });
    expect(scoreCandidate(c)).toBeLessThan(AUTO_THRESHOLD);
  });
});
