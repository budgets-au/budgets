import { beforeAll, describe, expect, it, vi } from "vitest";
import { accounts, categories, transactions } from "@/db/schema";
import {
  createTestDb,
  installTestDb,
  type TestDb,
} from "@/__tests__/golden/_helpers/test-db";
import { testAuth } from "@/__tests__/golden/_helpers/auth-mock";

vi.mock("@/lib/auth", () => ({ auth: testAuth }));

/** /api/transactions/uncategorised-count must return a cheap COUNT
 *  of rows where category_id IS NULL. The /transactions topbar
 *  badge fetches this on every first-load, so the contract is:
 *  fast, no joins, no payload growth with N — just {count}. */

describe("/api/transactions/uncategorised-count", () => {
  let db: TestDb;
  let countGET: () => Promise<Response>;

  beforeAll(async () => {
    db = createTestDb();
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
      .insert(categories)
      .values({ id: "cat-food", name: "Food", type: "expense", parentId: null })
      .run();

    // 3 uncategorised + 2 categorised = expect count of 3.
    db.drizzleDb
      .insert(transactions)
      .values([
        { id: "u1", accountId: "acct", date: "2026-01-01", amount: "-10", payee: "a", categoryId: null },
        { id: "u2", accountId: "acct", date: "2026-01-02", amount: "-20", payee: "b", categoryId: null },
        { id: "u3", accountId: "acct", date: "2026-01-03", amount: "-30", payee: "c", categoryId: null },
        { id: "c1", accountId: "acct", date: "2026-01-04", amount: "-40", payee: "d", categoryId: "cat-food" },
        { id: "c2", accountId: "acct", date: "2026-01-05", amount: "-50", payee: "e", categoryId: "cat-food" },
      ])
      .run();

    const mod = await import("./route");
    countGET = () =>
      mod.GET(
        new Request("http://test/api/transactions/uncategorised-count"),
        undefined,
      );
  });

  it("returns the count of rows with category_id IS NULL", async () => {
    const res = await countGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body).toEqual({ count: 3 });
  });
});
