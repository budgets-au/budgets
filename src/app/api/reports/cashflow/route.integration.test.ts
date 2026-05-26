import { beforeAll, describe, expect, it, vi } from "vitest";
import { accounts, categories, transactions } from "@/db/schema";
import {
  createTestDb,
  installTestDb,
  type TestDb,
} from "@/__tests__/golden/_helpers/test-db";
import { testAuth } from "@/__tests__/golden/_helpers/auth-mock";
import type { CashflowReport } from "./route";

vi.mock("@/lib/auth", () => ({ auth: testAuth }));

/** /api/reports/cashflow is the heaviest reports endpoint and the
 *  source most of the YoY / yearly / expenses drill-down panels
 *  pull from. The contract we pin here:
 *  - `from`/`to` query-string validation (issue #51 — malformed
 *    dates fail loudly instead of silently lexicographically
 *    matching everything).
 *  - Range-cap guard (max 12 years).
 *  - Happy path returns months array + income/expense category
 *    breakdowns + opening/closing balance arithmetic. */

const ACCT = "11111111-1111-4111-8111-111111111111";
const CAT_SALARY = "22222222-2222-4222-8222-222222222221";
const CAT_GROCERIES = "22222222-2222-4222-8222-222222222222";

describe("/api/reports/cashflow", () => {
  let cashflowGET: (q: string) => Promise<Response>;

  beforeAll(async () => {
    const db: TestDb = createTestDb();
    installTestDb(db);
    db.drizzleDb
      .insert(accounts)
      .values({
        id: ACCT,
        name: "Checking",
        type: "checking",
        currency: "AUD",
        startingBalance: "1000",
        currentBalance: "1000",
      })
      .run();
    db.drizzleDb
      .insert(categories)
      .values([
        { id: CAT_SALARY, name: "Salary", type: "income", parentId: null },
        { id: CAT_GROCERIES, name: "Groceries", type: "expense", parentId: null },
      ])
      .run();
    // Two months of activity inside the range we'll query.
    db.drizzleDb
      .insert(transactions)
      .values([
        { id: "t1", accountId: ACCT, date: "2026-01-10", amount: "5000", categoryId: CAT_SALARY },
        { id: "t2", accountId: ACCT, date: "2026-01-15", amount: "-200", categoryId: CAT_GROCERIES },
        { id: "t3", accountId: ACCT, date: "2026-02-10", amount: "5000", categoryId: CAT_SALARY },
        { id: "t4", accountId: ACCT, date: "2026-02-20", amount: "-300", categoryId: CAT_GROCERIES },
      ])
      .run();

    const mod = await import("./route");
    cashflowGET = (q: string) =>
      mod.GET(
        new Request(`http://test/api/reports/cashflow?${q}`),
        undefined,
      );
  });

  it("returns months array + income + expense breakdowns over the range", async () => {
    const res = await cashflowGET("from=2026-01-01&to=2026-02-28");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CashflowReport;

    // Two months: Jan + Feb 2026.
    expect(body.months).toEqual(["2026-01", "2026-02"]);

    // Income side carries Salary, summed by month.
    const salary = body.income.find((c) => c.id === CAT_SALARY);
    expect(salary).toBeDefined();
    expect(salary!.byMonth["2026-01"]).toBeCloseTo(5000, 2);
    expect(salary!.byMonth["2026-02"]).toBeCloseTo(5000, 2);
    expect(salary!.total).toBeCloseTo(10000, 2);

    // Expense side carries Groceries (negative amounts in DB).
    const groc = body.expenses.find((c) => c.id === CAT_GROCERIES);
    expect(groc).toBeDefined();
    expect(groc!.byMonth["2026-01"]).toBeCloseTo(-200, 2);
    expect(groc!.byMonth["2026-02"]).toBeCloseTo(-300, 2);
    expect(groc!.total).toBeCloseTo(-500, 2);

    // Roll-up totals row.
    expect(body.totals.income["2026-01"]).toBeCloseTo(5000, 2);
    expect(body.totals.expenses["2026-01"]).toBeCloseTo(-200, 2);
    expect(body.totals.net["2026-01"]).toBeCloseTo(4800, 2);
  });

  it("opening balance reflects pre-range activity; closing rolls forward", async () => {
    // Same fixture, but query just February so January's net needs
    // to fold into the opening balance.
    const res = await cashflowGET("from=2026-02-01&to=2026-02-28");
    const body = (await res.json()) as CashflowReport;
    // Opening = startingBalance(1000) + Jan net(+5000 - 200) = 5800.
    expect(body.openingBalance).toBeCloseTo(5800, 2);
    // Closing for Feb = opening + Feb net(+5000 - 300) = 10500.
    expect(body.closingBalance["2026-02"]).toBeCloseTo(10500, 2);
  });

  it("400s on a malformed from date (issue #51 guard)", async () => {
    const res = await cashflowGET("from=banana&to=2026-12-31");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/YYYY-MM-DD/);
  });

  it("400s when to < from", async () => {
    const res = await cashflowGET("from=2026-06-01&to=2026-01-01");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/from must be <= to/);
  });

  it("400s when the requested range exceeds 12 years", async () => {
    const res = await cashflowGET("from=2010-01-01&to=2026-01-01");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/range too large/);
  });
});
