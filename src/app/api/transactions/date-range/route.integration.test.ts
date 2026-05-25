import { beforeAll, describe, expect, it, vi } from "vitest";
import { accounts, transactions } from "@/db/schema";
import {
  createTestDb,
  installTestDb,
  type TestDb,
} from "@/__tests__/golden/_helpers/test-db";
import { testAuth } from "@/__tests__/golden/_helpers/auth-mock";

vi.mock("@/lib/auth", () => ({ auth: testAuth }));

describe("/api/transactions/date-range", () => {
  let dateRangeGET: () => Promise<Response>;

  beforeAll(async () => {
    const db: TestDb = createTestDb();
    installTestDb(db);
    db.drizzleDb
      .insert(accounts)
      .values({
        id: "acct",
        name: "Checking",
        type: "checking",
        currency: "AUD",
      })
      .run();
    db.drizzleDb
      .insert(transactions)
      .values([
        { id: "t1", accountId: "acct", date: "2019-07-04", amount: "10" },
        { id: "t2", accountId: "acct", date: "2026-05-20", amount: "20" },
        { id: "t3", accountId: "acct", date: "2022-01-15", amount: "30" },
      ])
      .run();

    const mod = await import("./route");
    dateRangeGET = () =>
      mod.GET(
        new Request("http://test/api/transactions/date-range"),
        undefined,
      );
  });

  it("returns MIN and MAX of transactions.date", async () => {
    const res = await dateRangeGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      minDate: string | null;
      maxDate: string | null;
    };
    expect(body.minDate).toBe("2019-07-04");
    expect(body.maxDate).toBe("2026-05-20");
  });
});

