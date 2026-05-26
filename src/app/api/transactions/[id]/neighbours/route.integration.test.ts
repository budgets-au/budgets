import { beforeAll, describe, expect, it, vi } from "vitest";
import { accounts, categories, transactions } from "@/db/schema";
import {
  createTestDb,
  installTestDb,
  type TestDb,
} from "@/__tests__/golden/_helpers/test-db";
import { testAuth } from "@/__tests__/golden/_helpers/auth-mock";

vi.mock("@/lib/auth", () => ({ auth: testAuth }));

/** /api/transactions/[id]/neighbours must:
 *  - Return the diagnostic shape for an existing transaction.
 *  - Exclude the queried transaction from its own neighbour pool
 *    (otherwise every row would self-match at similarity 1.0).
 *  - Return an empty envelope when the row has no normalisedPayee. */

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const SIBLING_ID = "22222222-2222-4222-8222-222222222222";
const NO_PAYEE_ID = "33333333-3333-4333-8333-333333333333";

describe("/api/transactions/[id]/neighbours", () => {
  let neighboursGET: (id: string) => Promise<Response>;

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
    // Parent → child hierarchy so the test pins that the
    //   endpoint returns "Food › Groceries" — the full path —
    //   for the category label, not just the leaf name.
    db.drizzleDb
      .insert(categories)
      .values([
        { id: "cat-food", name: "Food", type: "expense", parentId: null },
        {
          id: "cat-groceries",
          name: "Groceries",
          type: "expense",
          parentId: "cat-food",
        },
      ])
      .run();

    db.drizzleDb
      .insert(transactions)
      .values([
        // Target row — categorised so it shows up in the pool too,
        // but the endpoint must filter it out.
        {
          id: TARGET_ID,
          accountId: "acct",
          date: "2026-05-01",
          amount: "-45.00",
          payee: "Coles store Nunawading",
          normalizedPayee: "COLES STORE NUNAWADING",
          matchPayee: "COLES STORE NUNAWADING",
          categoryId: "cat-groceries",
        },
        // Sibling row sharing the merchant — should appear as the
        // top neighbour.
        {
          id: SIBLING_ID,
          accountId: "acct",
          date: "2026-04-20",
          amount: "-60.00",
          payee: "Coles store Nunawading",
          normalizedPayee: "COLES STORE NUNAWADING",
          matchPayee: "COLES STORE NUNAWADING",
          categoryId: "cat-groceries",
        },
        // Row with no payee — querying it returns the empty
        // envelope without hitting the trigram scorer.
        {
          id: NO_PAYEE_ID,
          accountId: "acct",
          date: "2026-04-25",
          amount: "-10.00",
          payee: null,
          normalizedPayee: null,
          matchPayee: null,
          categoryId: "cat-groceries",
        },
      ])
      .run();

    const mod = await import("./route");
    neighboursGET = (id: string) =>
      mod.GET(
        new Request(`http://test/api/transactions/${id}/neighbours`),
        { params: Promise.resolve({ id }) },
      );
  });

  it("returns neighbours for an existing row, excluding self", async () => {
    const res = await neighboursGET(TARGET_ID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      neighbours: Array<{
        normalizedPayee: string;
        similarity: number;
        categoryName: string | null;
      }>;
      categoryRanges: Array<{ categoryId: string; support: number; isPicked: boolean }>;
      suggestion: { categoryName: string | null } | null;
    };
    // The only other row in the pool is SIBLING_ID — and the
    // target must NOT appear as its own neighbour.
    expect(body.neighbours.length).toBe(1);
    expect(body.neighbours[0].normalizedPayee).toBe("COLES STORE NUNAWADING");
    expect(body.neighbours[0].categoryName).toBe("Food › Groceries");
    // Support count for the picked category is 1 — the sibling
    // row, not the target row.
    const picked = body.categoryRanges.find((r) => r.isPicked);
    expect(picked).toBeDefined();
    expect(picked!.support).toBe(1);
    expect(body.suggestion?.categoryName).toBe("Food › Groceries");
  });

  it("returns the empty envelope for a row with no normalisedPayee", async () => {
    const res = await neighboursGET(NO_PAYEE_ID);
    const body = (await res.json()) as {
      neighbours: unknown[];
      categoryRanges: unknown[];
      suggestion: unknown;
    };
    expect(body.neighbours).toEqual([]);
    expect(body.categoryRanges).toEqual([]);
    expect(body.suggestion).toBeNull();
  });

  it("404s for an id that doesn't match any row", async () => {
    const res = await neighboursGET("99999999-9999-4999-8999-999999999999");
    expect(res.status).toBe(404);
  });

  it("400s for a malformed UUID (withAuthAndId guard)", async () => {
    const res = await neighboursGET("not-a-uuid");
    expect(res.status).toBe(400);
  });
});
