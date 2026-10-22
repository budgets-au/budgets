import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ACC,
  CAT,
  GOLDEN_FROM,
  GOLDEN_TO,
  seedGoldenBook,
} from "@/lib/test-fixtures/golden-book";
import { createTestDb, installTestDb, type TestDb } from "./_helpers/test-db";
import { testAuth } from "./_helpers/auth-mock";

vi.mock("@/lib/auth", () => ({ auth: testAuth }));

/** Smoke coverage for the high-traffic GET routes that had no integration
 *  test. 0.355–0.357 shipped 500s on several of these (missing tables) that
 *  only a real request against a migrated, seeded DB would have caught. Each
 *  case asserts 200 + a JSON body; behaviour-level assertions live in the
 *  dedicated golden tests. */

// The dashboard routes validate ids as UUIDs; the golden book uses readable ids.
const UUID_ACCOUNT = "11111111-1111-4111-8111-111111111111";
const UUID_CATEGORY = "22222222-2222-4222-8222-222222222222";

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
const range = { from: GOLDEN_FROM, to: GOLDEN_TO };

const CASES: Array<{ route: string; query?: string }> = [
  { route: "cashflow", query: q({ ...range, accountIds: ACC.cheque }) },
  { route: "scheduled" },
  { route: "scheduled/budget-progress" },
  { route: "scheduled/suggestions" },
  { route: "reports", query: q({ ...range, groupBy: "month" }) },
  { route: "reports/cashflow", query: q(range) },
  { route: "reports/accounts-cashflow", query: q(range) },
  { route: "reports/category-trend", query: q({ ...range, categoryId: CAT.food, groupBy: "month" }) },
  { route: "reports/payee-totals", query: q({ ...range, kind: "expense" }) },
  { route: "reports/tax", query: q({ fyEndYear: "2026" }) },
  { route: "reports/transactions-points", query: q({ ...range, kind: "expense" }) },
  { route: "dashboard/account-balance-trend", query: q({ accountId: UUID_ACCOUNT, days: "30" }) },
  { route: "dashboard/category-spend", query: q({ categoryId: UUID_CATEGORY, days: "30" }) },
  { route: "dashboard/net-worth-trend" },
  { route: "dashboard/recent-transactions" },
  { route: "dashboard/upcoming" },
  { route: "accounts" },
  { route: "transactions", query: q({ limit: "50" }) },
];

describe("hot API routes respond on a migrated, seeded DB", () => {
  let db: TestDb;

  beforeAll(() => {
    db = createTestDb();
    installTestDb(db);
    seedGoldenBook(db.drizzleDb);
    db.client
      .prepare("INSERT INTO accounts (id, name, type, created_at, updated_at) VALUES (?, 'UUID acct', 'checking', 0, 0)")
      .run(UUID_ACCOUNT);
    db.client
      .prepare("INSERT INTO categories (id, name, type, color, is_system, transfer_kind, created_at) VALUES (?, 'UUID cat', 'expense', '#888', 0, 'none', 0)")
      .run(UUID_CATEGORY);
  });
  afterAll(() => db.close());

  it.each(CASES)("GET /api/$route", async ({ route, query }) => {
    const mod = (await import(`@/app/api/${route}/route`)) as {
      GET: (req: Request, ctx?: unknown) => Promise<Response>;
    };
    const res = await mod.GET(
      new Request(`http://test/api/${route}${query ? `?${query}` : ""}`),
      { params: Promise.resolve({}) },
    );
    const body = await res.text();
    expect(res.status, body.slice(0, 300)).toBe(200);
    expect(() => JSON.parse(body)).not.toThrow();
  });
});
