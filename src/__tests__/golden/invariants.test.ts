/**
 * Cross-cutting accounting invariants — runs every assertion in
 * `accounting-invariants.ts` against the Golden Book's actual report
 * output. This catches regressions where a feature change inflates
 * one number and a matching number elsewhere "happens to" still line
 * up with the truth table — the invariants here check the
 * relationships between figures, not their absolute values.
 *
 * If any of these fire, the codebase has silently violated an
 * accounting law. Fix the root cause; don't update the invariant
 * unless the underlying accounting principle has genuinely changed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { transactions } from "@/db/schema";
import {
  GOLDEN_FROM,
  GOLDEN_TO,
  GOLDEN_MONTHS,
  seedGoldenBook,
} from "@/lib/test-fixtures/golden-book";
import {
  assertCategorisationCompleteness,
  assertConservationOfMoney,
  assertPeriodContinuity,
  assertScheduleProjectionConsistency,
  type RawTxn,
} from "@/lib/test-invariants/accounting-invariants";
import { createTestDb, installTestDb, type TestDb } from "./_helpers/test-db";
import { testAuth } from "./_helpers/auth-mock";

vi.mock("@/lib/auth", () => ({ auth: testAuth }));

type CashflowResp = {
  months: string[];
  income: Array<{
    id: string;
    name: string;
    byMonth: Record<string, number>;
    scheduledTotal: number;
    scheduledByMonth: Record<string, number>;
  }>;
  expenses: Array<{
    id: string;
    name: string;
    byMonth: Record<string, number>;
    scheduledTotal: number;
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

describe("golden / cross-cutting accounting invariants", () => {
  let db: TestDb;
  let body: CashflowResp;
  let txns: RawTxn[];

  beforeAll(async () => {
    db = createTestDb();
    installTestDb(db);
    seedGoldenBook(db.drizzleDb);
    const mod = await import("@/app/api/reports/cashflow/route");
    const cashflowGET = mod.GET as unknown as (req: Request) => Promise<Response>;
    const res = await cashflowGET(
      new Request(
        `http://test/api/reports/cashflow?from=${GOLDEN_FROM}&to=${GOLDEN_TO}`,
      ),
    );
    body = (await res.json()) as CashflowResp;

    const rows = db.client
      .prepare(
        `SELECT t.account_id, t.amount, c.transfer_kind AS ck
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id`,
      )
      .all() as Array<{ account_id: string; amount: string; ck: string | null }>;
    txns = rows.map((r) => ({
      accountId: r.account_id,
      amount: r.amount,
      categoryTransferKind: r.ck,
    }));
  });
  afterAll(() => {
    db.close();
  });

  // ─ Conservation of money ────────────────────────────────────────
  it("internal transfers net to zero across all accounts", () => {
    assertConservationOfMoney(txns);
  });

  // ─ Period continuity (covers commits 140d53e + a183ba8) ─────────
  it("closing balance walk respects period continuity", () => {
    assertPeriodContinuity(
      body.openingBalance,
      body.totals.net,
      body.closingBalance,
    );
  });

  // ─ Categorisation completeness ──────────────────────────────────
  it("every transaction is accounted for in some bucket", () => {
    // Compute raw txn Σ for each month and verify income + expenses
    // + uncat (folded into expenses by API) + internalTransfers (we
    // pass 0 because the totals.expenses bucket already includes the
    // uncategorised pseudo-row, and totals doesn't expose internal
    // transfers separately).
    for (const m of GOLDEN_MONTHS) {
      const rawSum = db.client
        .prepare(
          `SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) AS s
           FROM transactions
           WHERE substr(date, 1, 7) = ?`,
        )
        .get(m) as { s: number };
      assertCategorisationCompleteness(rawSum.s, {
        income: body.totals.income[m] ?? 0,
        expenses: body.totals.expenses[m] ?? 0,
        uncategorised: 0,
        // Internal transfer txns net to zero PER MONTH (the pair is
        // same-date), so they don't contribute to the raw monthly sum
        // either.
        internalTransfers: 0,
      });
    }
  });

  // ─ Schedule projection consistency ──────────────────────────────
  it("schedule projection: scheduledTotal === Σ scheduledByMonth (lumpy view identity)", () => {
    for (const cat of [...body.income, ...body.expenses]) {
      // Only check categories whose stored Plan total is non-zero —
      // empty schedule cats just have nothing to compare.
      if (cat.scheduledTotal === 0) continue;
      assertScheduleProjectionConsistency(
        cat.scheduledByMonth,
        cat.scheduledTotal,
      );
    }
  });

  // ─ Plan total respects fixture bounds ───────────────────────────
  it("Plan total stays within the fixture's per-category ceiling", () => {
    // For the golden 12-month window, the largest legitimate Plan
    // total is salary = $72k (12 × $6k/mo). Anything wildly larger
    // would mean a regression that double-summed schedules. We use
    // $100k as a generous ceiling; the focused cashflow test pins
    // the exact values.
    for (const cat of [...body.income, ...body.expenses]) {
      expect(Math.abs(cat.scheduledTotal)).toBeLessThan(100_000);
    }
  });

  // ─ Net = Income + Expenses idempotency ──────────────────────────
  it("totals.net = totals.income + totals.expenses for every month", () => {
    for (const m of GOLDEN_MONTHS) {
      const reconstructed =
        (body.totals.income[m] ?? 0) + (body.totals.expenses[m] ?? 0);
      // The route's monthly net comes from a separate SQL query
      // summing ALL txn amounts (including transfers). For our
      // fixture transfers net to zero per month, so the two figures
      // line up exactly. A future fixture with cross-month transfers
      // would break this — that's a real bug if it does.
      expect(body.totals.net[m]).toBeCloseTo(reconstructed, 2);
    }
  });
});
