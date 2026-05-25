import { beforeAll, describe, expect, it, vi } from "vitest";
import { accounts, categories, transactions } from "@/db/schema";
import {
  createTestDb,
  installTestDb,
  type TestDb,
} from "@/__tests__/golden/_helpers/test-db";
import { testAuth } from "@/__tests__/golden/_helpers/auth-mock";

vi.mock("@/lib/auth", () => ({ auth: testAuth }));

/** /api/transactions/uncategorised-categorise must paginate via
 *  `limit`/`offset` and return `{ rows, total, hasMore, limit, offset }`.
 *  Server-side capping is the perf fix from 0.276.0 — without it
 *  the trigram pipeline scales O(uncategorised × candidates) and
 *  the JSON response grows to megabytes at N=5k. */

interface UncatEnvelope {
  rows: Array<{ id: string }>;
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}

describe("/api/transactions/uncategorised-categorise envelope", () => {
  let db: TestDb;
  let uncatGET: (req: Request) => Promise<Response>;
  const N = 7;

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

    // N=7 uncategorised rows so limit=2 returns 4 distinct pages
    // (2, 2, 2, 1) for ergonomic boundary coverage.
    const rows = Array.from({ length: N }, (_, i) => ({
      id: `u${i + 1}`,
      accountId: "acct",
      date: `2026-01-0${i + 1}`,
      amount: "-10",
      payee: `payee-${i + 1}`,
      categoryId: null,
    }));
    // Plus one categorised row to prove the WHERE filter holds.
    db.drizzleDb
      .insert(transactions)
      .values([
        ...rows,
        {
          id: "c1",
          accountId: "acct",
          date: "2026-02-01",
          amount: "-99",
          payee: "categorised",
          categoryId: "cat-food",
        },
      ])
      .run();

    const mod = await import("./route");
    uncatGET = (req: Request) => mod.GET(req, undefined);
  });

  it("returns the first page with total + hasMore=true", async () => {
    const res = await uncatGET(
      new Request(
        "http://test/api/transactions/uncategorised-categorise?limit=2&offset=0",
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as UncatEnvelope;
    expect(body.total).toBe(N);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
    expect(body.rows.length).toBe(2);
    expect(body.hasMore).toBe(true);
  });

  it("returns the final page with hasMore=false", async () => {
    const res = await uncatGET(
      new Request(
        "http://test/api/transactions/uncategorised-categorise?limit=2&offset=6",
      ),
    );
    const body = (await res.json()) as UncatEnvelope;
    expect(body.total).toBe(N);
    expect(body.rows.length).toBe(1);
    expect(body.offset).toBe(6);
    expect(body.hasMore).toBe(false);
  });

  it("default limit is applied when omitted", async () => {
    const res = await uncatGET(
      new Request("http://test/api/transactions/uncategorised-categorise"),
    );
    const body = (await res.json()) as UncatEnvelope;
    expect(body.limit).toBe(500);
    expect(body.offset).toBe(0);
    expect(body.rows.length).toBe(N);
    expect(body.hasMore).toBe(false);
  });

  it("clamps a requested limit above the LIMIT_MAX ceiling", async () => {
    const res = await uncatGET(
      new Request(
        "http://test/api/transactions/uncategorised-categorise?limit=99999",
      ),
    );
    const body = (await res.json()) as UncatEnvelope;
    expect(body.limit).toBe(2000);
  });
});
