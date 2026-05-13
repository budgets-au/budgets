import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { accounts, categories, transactions } from "@/db/schema";
import { createTestDb, installTestDb, type TestDb } from "./test-db";
import { testAuth } from "./auth-mock";

// Mock the auth module BEFORE the route handler is imported. vi.mock is
// hoisted so this fires before the dynamic import below regardless of
// where it sits in the file.
vi.mock("@/lib/auth", () => ({ auth: testAuth }));

describe("integration harness — route handler can hit the test DB", () => {
  let db: TestDb;
  let cashflowGET: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    db = createTestDb();
    installTestDb(db);
    // Dynamic import AFTER installTestDb so the @/db proxy's first
    // resolve hits our test handle, not the locked prod stub.
    const mod = await import("@/app/api/reports/cashflow/route");
    cashflowGET = mod.GET as unknown as (req: Request) => Promise<Response>;

    // Seed a single account so the SUM(starting_balance) path returns
    // something testable.
    db.drizzleDb
      .insert(accounts)
      .values({
        id: "acc-1",
        name: "Cheque",
        type: "checking",
        currentBalance: "1000",
        startingBalance: "1000",
      })
      .run();
    db.drizzleDb
      .insert(categories)
      .values({
        id: "cat-salary",
        name: "Salary",
        type: "income",
        transferKind: "none",
      })
      .run();
    db.drizzleDb
      .insert(transactions)
      .values({
        id: "txn-1",
        accountId: "acc-1",
        date: "2026-01-15",
        amount: "500",
        categoryId: "cat-salary",
      })
      .run();
  });
  afterAll(() => {
    db.close();
  });

  it("calls /api/reports/cashflow against the test DB", async () => {
    const url =
      "http://test/api/reports/cashflow?from=2026-01-01&to=2026-01-31";
    const res = await cashflowGET(new Request(url));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      months: string[];
      openingBalance: number;
      closingBalance: Record<string, number>;
    };
    expect(body.months).toEqual(["2026-01"]);
    expect(body.openingBalance).toBeCloseTo(1000, 2);
    expect(body.closingBalance["2026-01"]).toBeCloseTo(1500, 2);
  });
});
