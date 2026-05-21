import { describe, expect, it } from "vitest";
import {
  assertAccountReconciliation,
  assertAvgIdempotency,
  assertCategorisationCompleteness,
  assertConservationOfMoney,
  assertPeriodContinuity,
  assertRollupIntegrity,
  assertScheduleProjectionConsistency,
} from "./accounting-invariants";

describe("conservation of money", () => {
  it("passes when internal transfers net to zero", () => {
    expect(() =>
      assertConservationOfMoney([
        { accountId: "a", amount: "-1000", categoryTransferKind: "internal" },
        { accountId: "b", amount: "1000", categoryTransferKind: "internal" },
      ]),
    ).not.toThrow();
  });
  it("fails when a leg is missing", () => {
    expect(() =>
      assertConservationOfMoney([
        { accountId: "a", amount: "-1000", categoryTransferKind: "internal" },
      ]),
    ).toThrow(/Conservation of money violated/);
  });
  it("ignores non-internal transfers (payments are legitimately one-sided)", () => {
    expect(() =>
      assertConservationOfMoney([
        { accountId: "a", amount: "-500", categoryTransferKind: "external" },
      ]),
    ).not.toThrow();
  });
});

describe("account reconciliation", () => {
  it("passes when currentBalance = starting + Σ amounts", () => {
    expect(() =>
      assertAccountReconciliation(
        { id: "a", startingBalance: "1000", currentBalance: "1500" },
        [{ accountId: "a", amount: "500" }],
      ),
    ).not.toThrow();
  });
  it("fails when stored balance drifts", () => {
    expect(() =>
      assertAccountReconciliation(
        { id: "a", startingBalance: "1000", currentBalance: "1499" },
        [{ accountId: "a", amount: "500" }],
      ),
    ).toThrow(/Account reconciliation violated/);
  });
  it("skips when currentBalance isn't stored", () => {
    expect(() =>
      assertAccountReconciliation(
        { id: "a", startingBalance: "1000", currentBalance: null },
        [{ accountId: "a", amount: "500" }],
      ),
    ).not.toThrow();
  });
});

describe("period continuity", () => {
  it("passes when closing = opening + Σ nets so far", () => {
    expect(() =>
      assertPeriodContinuity(
        100,
        { "2026-01": 50, "2026-02": -30 },
        { "2026-01": 150, "2026-02": 120 },
      ),
    ).not.toThrow();
  });
  it("fails when a month's closing drifts", () => {
    expect(() =>
      assertPeriodContinuity(
        100,
        { "2026-01": 50, "2026-02": -30 },
        { "2026-01": 150, "2026-02": 100 },
      ),
    ).toThrow(/Period continuity violated at 2026-02/);
  });
});

describe("categorisation completeness", () => {
  it("passes when buckets sum to the raw total", () => {
    expect(() =>
      assertCategorisationCompleteness(100, {
        income: 200,
        expenses: -60,
        uncategorised: -40,
        internalTransfers: 0,
      }),
    ).not.toThrow();
  });
  it("fails when a category was silently dropped", () => {
    expect(() =>
      assertCategorisationCompleteness(100, {
        income: 200,
        expenses: -60,
        uncategorised: 0,
        internalTransfers: 0,
      }),
    ).toThrow(/Categorisation completeness violated/);
  });
});

describe("roll-up integrity", () => {
  it("passes when parent-direct == sum-of-leaves-minus-descendants", () => {
    // Parent has $50 direct + child has $30 = $80 leafSum.
    // Stated parent.byMonth = 50 (own direct only).
    expect(() =>
      assertRollupIntegrity(
        [
          { id: "p", parentId: null, byMonth: { "2026-01": 50 } },
          { id: "c", parentId: "p", byMonth: { "2026-01": 30 } },
        ],
        "2026-01",
      ),
    ).not.toThrow();
  });
});

describe("avg idempotency", () => {
  it("passes when avg × N == total", () => {
    expect(() => assertAvgIdempotency(1200, 100, 12)).not.toThrow();
  });
  it("fails when avg drifted", () => {
    expect(() => assertAvgIdempotency(1200, 80, 12)).toThrow(
      /Avg\/mo idempotency violated/,
    );
  });
});

describe("schedule projection consistency", () => {
  it("passes when scheduledTotal equals Σ scheduledByMonth", () => {
    // Monthly schedule × 12, $100/firing → total $1200 in both forms.
    expect(() =>
      assertScheduleProjectionConsistency(
        Object.fromEntries(
          Array.from({ length: 12 }, (_, i) => [
            `2026-${String(i + 1).padStart(2, "0")}`,
            100,
          ]),
        ),
        1200,
      ),
    ).not.toThrow();
  });
  it("passes for a quarterly schedule (lumpy months, identity still holds)", () => {
    // Quarterly $100 firing 4× in 12 months → Σ byMonth = $400 = total.
    expect(() =>
      assertScheduleProjectionConsistency(
        {
          "2026-01": 100, "2026-04": 100, "2026-07": 100, "2026-10": 100,
        },
        400,
      ),
    ).not.toThrow();
  });
  it("throws when the total disagrees with Σ scheduledByMonth", () => {
    expect(() =>
      assertScheduleProjectionConsistency(
        { "2026-01": 100, "2026-02": 100 },
        500, // wrong — should be 200
      ),
    ).toThrow(/Schedule projection inconsistency/);
  });
});
