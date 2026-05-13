/**
 * Golden integration test for the cashflow report. Seeds the Golden
 * Book into an in-memory DB and exercises `/api/reports/cashflow`
 * end-to-end, asserting every figure against the hand-computed truth
 * table.
 *
 * Bugs this would have caught in the past:
 *   - commit 140d53e: starting_balance dropped from opening — catches
 *     via openingBalance assertion.
 *   - commit a183ba8: hideTransfers leaked into balance walk — catches
 *     via the closing-balance walk assertion.
 *   - commit 9a2c47b: Plan/mo double-counted superseded schedules —
 *     catches via PLAN_PER_MONTH.health = 580 (not 1127).
 *   - commit 07326cb: superseded predecessor missing from history —
 *     catches via CATEGORY_BY_MONTH.health[Jan]=-547 (which depends
 *     on the predecessor's expansion contributing past months).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  GOLDEN_FROM,
  GOLDEN_TO,
  GOLDEN_MONTHS,
  CAT,
  seedGoldenBook,
} from "@/lib/test-fixtures/golden-book";
import {
  AVG_PER_MONTH,
  CATEGORY_BY_MONTH,
  CATEGORY_TOTALS,
  CLOSING_BALANCE,
  EXPENSE_TOTAL_PER_MONTH,
  INCOME_TOTAL_PER_MONTH,
  MONTHLY_NET,
  OPENING_BALANCE,
  PLAN_PER_MONTH,
} from "@/lib/test-fixtures/golden-book-truth";
import { assertPeriodContinuity } from "@/lib/test-invariants/accounting-invariants";
import { createTestDb, installTestDb, type TestDb } from "./_helpers/test-db";
import { testAuth } from "./_helpers/auth-mock";

vi.mock("@/lib/auth", () => ({ auth: testAuth }));

type CashflowResp = {
  months: string[];
  income: Array<{
    id: string;
    name: string;
    parentId: string | null;
    grandparentId: string | null;
    byMonth: Record<string, number>;
    total: number;
    scheduledPerMonth: number;
    scheduledByMonth: Record<string, number>;
  }>;
  expenses: Array<{
    id: string;
    name: string;
    parentId: string | null;
    grandparentId: string | null;
    byMonth: Record<string, number>;
    total: number;
    scheduledPerMonth: number;
    scheduledByMonth: Record<string, number>;
  }>;
  totals: {
    income: Record<string, number>;
    expenses: Record<string, number>;
    net: Record<string, number>;
  };
  closingBalance: Record<string, number>;
  openingBalance: number;
};

describe("golden / cashflow report", () => {
  let db: TestDb;
  let cashflowGET: (req: Request) => Promise<Response>;
  let body: CashflowResp;

  beforeAll(async () => {
    db = createTestDb();
    installTestDb(db);
    seedGoldenBook(db.drizzleDb);
    const mod = await import("@/app/api/reports/cashflow/route");
    cashflowGET = mod.GET as unknown as (req: Request) => Promise<Response>;
    const res = await cashflowGET(
      new Request(
        `http://test/api/reports/cashflow?from=${GOLDEN_FROM}&to=${GOLDEN_TO}`,
      ),
    );
    expect(res.status).toBe(200);
    body = (await res.json()) as CashflowResp;
  });
  afterAll(() => {
    db.close();
  });

  it("returns the expected 12 months", () => {
    expect(body.months).toEqual([...GOLDEN_MONTHS]);
  });

  it("opening balance includes starting_balance from every account", () => {
    expect(body.openingBalance).toBeCloseTo(OPENING_BALANCE, 2);
  });

  it("monthly net matches the truth table", () => {
    for (const m of GOLDEN_MONTHS) {
      expect(body.totals.net[m]).toBeCloseTo(MONTHLY_NET[m], 2);
    }
  });

  it("closing balance walk is consistent (period continuity invariant)", () => {
    assertPeriodContinuity(
      body.openingBalance,
      body.totals.net,
      body.closingBalance,
    );
  });

  it("closing balance matches the truth table", () => {
    for (const m of GOLDEN_MONTHS) {
      expect(body.closingBalance[m]).toBeCloseTo(CLOSING_BALANCE[m], 2);
    }
  });

  it("Income total per month is +6000 (salary only)", () => {
    for (const m of GOLDEN_MONTHS) {
      expect(body.totals.income[m]).toBeCloseTo(INCOME_TOTAL_PER_MONTH[m], 2);
    }
  });

  it("Expense total per month covers health + groceries (with March refund)", () => {
    for (const m of GOLDEN_MONTHS) {
      expect(body.totals.expenses[m]).toBeCloseTo(
        EXPENSE_TOTAL_PER_MONTH[m],
        2,
      );
    }
  });

  describe("per-category totals", () => {
    it("Salary total over 12 months", () => {
      const salary = body.income.find((c) => c.id === CAT.salary);
      expect(salary).toBeDefined();
      expect(salary!.total).toBeCloseTo(CATEGORY_TOTALS.salary, 2);
    });
    it("Health total covers the V1→V2 supersession ($547×6 + $580×6)", () => {
      const health = body.expenses.find((c) => c.id === CAT.health);
      expect(health).toBeDefined();
      expect(health!.total).toBeCloseTo(CATEGORY_TOTALS.health, 2);
    });
    it("Groceries total includes the March refund offset", () => {
      const groceries = body.expenses.find((c) => c.id === CAT.groceries);
      expect(groceries).toBeDefined();
      expect(groceries!.total).toBeCloseTo(CATEGORY_TOTALS.groceries, 2);
    });
  });

  describe("per-category-per-month amounts", () => {
    it("Salary byMonth: +6000 every month", () => {
      const salary = body.income.find((c) => c.id === CAT.salary)!;
      for (const m of GOLDEN_MONTHS) {
        expect(salary.byMonth[m]).toBeCloseTo(CATEGORY_BY_MONTH.salary[m], 2);
      }
    });
    it("Health byMonth flips from -547 (Jan-Jun) to -580 (Jul-Dec)", () => {
      const health = body.expenses.find((c) => c.id === CAT.health)!;
      for (const m of GOLDEN_MONTHS) {
        expect(health.byMonth[m]).toBeCloseTo(CATEGORY_BY_MONTH.health[m], 2);
      }
    });
    it("Groceries byMonth picks up the March refund (-775 in March, -800 elsewhere)", () => {
      const groceries = body.expenses.find((c) => c.id === CAT.groceries)!;
      for (const m of GOLDEN_MONTHS) {
        expect(groceries.byMonth[m]).toBeCloseTo(
          CATEGORY_BY_MONTH.groceries[m],
          2,
        );
      }
    });
  });

  describe("Plan/mo — currently-active schedules only", () => {
    it("Salary Plan/mo = 6000", () => {
      const salary = body.income.find((c) => c.id === CAT.salary)!;
      expect(salary.scheduledPerMonth).toBeCloseTo(PLAN_PER_MONTH.salary, 2);
    });
    it("Health Plan/mo = 580 (V2 only, NOT 1127 = V1+V2)", () => {
      // This is the exact bug behind commit 9a2c47b. The fix ensured
      // superseded (isActive=false) schedules don't contribute to
      // scheduledByCategory even though they're still pulled in for
      // historical projection. A regression would surface here as
      // 1127.
      const health = body.expenses.find((c) => c.id === CAT.health)!;
      expect(health.scheduledPerMonth).toBeCloseTo(PLAN_PER_MONTH.health, 2);
    });
    it("Groceries Plan/mo = 800", () => {
      const groceries = body.expenses.find((c) => c.id === CAT.groceries)!;
      expect(groceries.scheduledPerMonth).toBeCloseTo(
        PLAN_PER_MONTH.groceries,
        2,
      );
    });
  });

  describe("Plan per-month expansion includes superseded predecessor's historical firings", () => {
    // Commit 07326cb's contract: V1 (Jan-Jun, isActive=false,
    // endDate=2026-06-30) should still emit projected occurrences in
    // Jan-Jun so the historical Plan column lines up. V2 fires
    // Jul-Dec. Combined: every month has exactly one health firing.
    it("scheduledByMonth.health has a firing in every month", () => {
      const health = body.expenses.find((c) => c.id === CAT.health)!;
      for (const m of GOLDEN_MONTHS) {
        const v = health.scheduledByMonth[m] ?? 0;
        expect(v).toBeGreaterThan(0); // V1 in Jan-Jun, V2 in Jul-Dec
      }
    });
  });

  describe("Avg/mo idempotency", () => {
    it("Health total / 12 ≈ truth-table Avg/mo", () => {
      const health = body.expenses.find((c) => c.id === CAT.health)!;
      const avg = health.total / GOLDEN_MONTHS.length;
      expect(avg).toBeCloseTo(AVG_PER_MONTH.health, 2);
    });
  });
});
