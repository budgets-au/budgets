import { describe, it, expect } from "vitest";
import {
  savingsRateForMonth,
  savingsRateSeries,
  avgMonthlyExpenses,
  avgMonthlyIncome,
  resolveEmergencyFundAccounts,
  resolveLiabilityAccounts,
  emergencyFundMonths,
  debtToIncome,
  netWorth,
  topExpenseCategories,
  type AccountLite,
} from "./health-calcs";
import type { CashflowReport } from "@/app/api/reports/cashflow/route";

function baseReport(
  overrides: Partial<CashflowReport> = {},
): Pick<CashflowReport, "months" | "totals"> {
  return {
    months: ["2026-01", "2026-02", "2026-03"],
    totals: {
      income: { "2026-01": 5000, "2026-02": 5000, "2026-03": 4000 },
      // Expenses are stored negative in the cashflow API payload.
      expenses: { "2026-01": -3000, "2026-02": -4500, "2026-03": -3500 },
      net: { "2026-01": 2000, "2026-02": 500, "2026-03": 500 },
    },
    ...overrides,
  };
}

describe("savingsRateForMonth", () => {
  it("computes surplus / income", () => {
    const rate = savingsRateForMonth(baseReport(), "2026-01");
    // (5000 - 3000) / 5000 = 0.4
    expect(rate).toBeCloseTo(0.4);
  });

  it("returns null for a missing month", () => {
    expect(savingsRateForMonth(baseReport(), "2026-99")).toBeNull();
  });

  it("returns null when income is zero", () => {
    const r = baseReport({
      totals: {
        income: { "2026-01": 0 },
        expenses: { "2026-01": -100 },
        net: { "2026-01": -100 },
      },
    });
    expect(savingsRateForMonth(r, "2026-01")).toBeNull();
  });
});

describe("savingsRateSeries", () => {
  it("emits one row per month with income", () => {
    const series = savingsRateSeries(baseReport());
    expect(series).toHaveLength(3);
    expect(series[0]).toEqual({ month: "2026-01", rate: 0.4 });
  });

  it("skips months without income data", () => {
    const r = baseReport({
      totals: {
        income: { "2026-01": 5000 },
        expenses: { "2026-01": -1000, "2026-02": -1000 },
        net: { "2026-01": 4000 },
      },
    });
    const series = savingsRateSeries(r);
    expect(series).toEqual([{ month: "2026-01", rate: 0.8 }]);
  });
});

describe("avgMonthlyExpenses", () => {
  it("averages the last N months by absolute value", () => {
    // last 2 months: |-4500| + |-3500| = 8000, /2 = 4000
    expect(avgMonthlyExpenses(baseReport(), 2)).toBe(4000);
  });

  it("returns 0 for an empty report", () => {
    expect(
      avgMonthlyExpenses(
        { months: [], totals: { income: {}, expenses: {}, net: {} } },
        3,
      ),
    ).toBe(0);
  });
});

describe("avgMonthlyIncome", () => {
  it("averages the last N months", () => {
    expect(avgMonthlyIncome(baseReport(), 3)).toBeCloseTo(4666.67, 1);
  });
});

const accounts: AccountLite[] = [
  { id: "chk", type: "checking", currentBalance: 1500, isArchived: false },
  { id: "sav", type: "savings", currentBalance: 20000, isArchived: false },
  { id: "sav2", type: "savings", currentBalance: 5000, isArchived: false },
  { id: "cc", type: "credit", currentBalance: -1200, isArchived: false },
  { id: "loan", type: "loan", currentBalance: -50000, isArchived: false },
  { id: "old", type: "checking", currentBalance: 100, isArchived: true },
];

describe("resolveEmergencyFundAccounts", () => {
  it("defaults to non-archived savings when no override", () => {
    const picked = resolveEmergencyFundAccounts(accounts, []);
    expect(picked.map((a) => a.id).sort()).toEqual(["sav", "sav2"]);
  });

  it("respects an explicit override", () => {
    const picked = resolveEmergencyFundAccounts(accounts, ["chk", "sav"]);
    expect(picked.map((a) => a.id).sort()).toEqual(["chk", "sav"]);
  });
});

describe("resolveLiabilityAccounts", () => {
  it("defaults to non-archived credit + loan", () => {
    const picked = resolveLiabilityAccounts(accounts, []);
    expect(picked.map((a) => a.id).sort()).toEqual(["cc", "loan"]);
  });
});

describe("emergencyFundMonths", () => {
  it("computes months of runway", () => {
    expect(emergencyFundMonths(20000, 4000)).toBe(5);
  });

  it("returns null when expenses are zero", () => {
    expect(emergencyFundMonths(20000, 0)).toBeNull();
  });
});

describe("debtToIncome", () => {
  it("computes |debt| / annual income", () => {
    // 51200 / (5000 * 12) = 0.853...
    expect(debtToIncome(-51200, 5000)).toBeCloseTo(0.8533, 3);
  });

  it("returns null when there's no income", () => {
    expect(debtToIncome(-1000, 0)).toBeNull();
  });
});

describe("netWorth", () => {
  it("sums signed balances of non-archived accounts", () => {
    // 1500 + 20000 + 5000 + (-1200) + (-50000) = -24700
    expect(netWorth(accounts)).toBe(-24700);
  });

  it("skips archived accounts", () => {
    expect(netWorth([...accounts, { id: "arch", type: "savings", currentBalance: 99999, isArchived: true }])).toBe(-24700);
  });

  it("handles string balances", () => {
    const strAccounts: AccountLite[] = [
      { id: "a", type: "savings", currentBalance: "1000.50", isArchived: false },
      { id: "b", type: "credit", currentBalance: "-200.25", isArchived: false },
    ];
    expect(netWorth(strAccounts)).toBeCloseTo(800.25);
  });
});

describe("topExpenseCategories", () => {
  const expenses = [
    { id: "a", name: "Groceries", byMonth: { "2026-01": -400 } },
    { id: "b", name: "Rent", byMonth: { "2026-01": -1600 } },
    { id: "c", name: "Fuel", byMonth: { "2026-01": -200 } },
    { id: "d", name: "Dining", byMonth: { "2026-01": -100 } },
    { id: "e", name: "Cats", byMonth: { "2026-01": -50 } },
    { id: "f", name: "Streaming", byMonth: { "2026-01": -30 } },
  ];

  it("returns top-N by absolute spend + Other for the tail", () => {
    const rows = topExpenseCategories(expenses, "2026-01", 3);
    expect(rows.map((r) => r.id)).toEqual(["b", "a", "c", "__other__"]);
    // 100 + 50 + 30 = 180 in Other
    expect(rows[3].value).toBe(180);
  });

  it("returns all rows without Other when count <= topN", () => {
    const rows = topExpenseCategories(expenses, "2026-01", 10);
    expect(rows.length).toBe(6);
    expect(rows.find((r) => r.id === "__other__")).toBeUndefined();
  });

  it("skips zero-value rows", () => {
    const rows = topExpenseCategories(
      [
        { id: "a", name: "X", byMonth: {} },
        { id: "b", name: "Y", byMonth: { "2026-01": -100 } },
      ],
      "2026-01",
      3,
    );
    expect(rows.map((r) => r.id)).toEqual(["b"]);
  });
});
