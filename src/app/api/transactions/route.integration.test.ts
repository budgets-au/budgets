import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { accounts, transactions } from "@/db/schema";
import {
  createTestDb,
  installTestDb,
  type TestDb,
} from "@/__tests__/golden/_helpers/test-db";
import { testAuth } from "@/__tests__/golden/_helpers/auth-mock";

// Mock auth BEFORE the route handler is imported below. Without this
// the route's `withAuth` wrapper transitively loads next-auth and
// vitest can't resolve `next/server` (path-extension mismatch).
vi.mock("@/lib/auth", () => ({ auth: testAuth }));

/** Integration coverage for `/api/transactions` running-balance contract
 *  (#92). The route's `balance` column is the post-transaction cumulative
 *  sum on a single-account view:
 *
 *      balance = starting_balance
 *              + Σ amount of every txn whose lineage tuple
 *                (date, posted_seq, posted_at|created_at, id)
 *                sorts ≤ this row's
 *
 *  Pre-0.264 this was a correlated subquery — O(N²) on big accounts.
 *  The fix is a single-pass window function inside a `ledger` CTE; the
 *  contract this test pins is the EXACT same per-row balance regardless
 *  of which implementation runs.
 *
 *  Why an integration test, not a unit one: the SQL is the surface that
 *  changed, and the only way to certify the window function and the
 *  old correlated subquery agree on every edge case is to run real
 *  rows through the real route handler against a real SQLite. We use
 *  the in-memory test DB harness (`createTestDb` + `installTestDb`)
 *  the rest of the golden-book tests use. */

interface TxnRow {
  id: string;
  date: string;
  amount: string;
  payee: string | null;
  balance: string | null;
}

const ACCT_ID = "acct-running-balance";
const STARTING = 1000;

const LEDGER: ReadonlyArray<{ id: string; date: string; amount: number; payee: string }> = [
  { id: "t01", date: "2026-01-05", amount: -100, payee: "rent" },
  { id: "t02", date: "2026-01-06", amount: -50, payee: "groceries" },
  { id: "t03", date: "2026-01-06", amount: 200, payee: "refund" },
  { id: "t04", date: "2026-01-10", amount: -75, payee: "fuel" },
  { id: "t05", date: "2026-01-15", amount: 25, payee: "interest" },
];

describe("/api/transactions running balance (#92)", () => {
  let db: TestDb;
  let txnsGET: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    db = createTestDb();
    installTestDb(db);

    db.drizzleDb
      .insert(accounts)
      .values({
        id: ACCT_ID,
        name: "Checking",
        type: "checking",
        currency: "AUD",
        startingBalance: String(STARTING),
        currentBalance: String(STARTING),
      })
      .run();

    // Insert in non-chronological order on purpose — the route's
    // ORDER BY tuple should still produce the correct cumulative sum
    // regardless of physical insert order. `postedSeq` is left null
    // so the COALESCE(...) fallback in the lineage tuple kicks in,
    // and `created_at` becomes the tiebreaker for same-date rows.
    const shuffled = [...LEDGER].reverse();
    for (const r of shuffled) {
      db.drizzleDb
        .insert(transactions)
        .values({
          id: r.id,
          accountId: ACCT_ID,
          date: r.date,
          amount: String(r.amount),
          payee: r.payee,
        })
        .run();
    }

    const mod = await import("@/app/api/transactions/route");
    txnsGET = mod.GET as unknown as (req: Request) => Promise<Response>;
  });

  afterAll(() => {
    db.close();
  });

  it("balance reflects cumulative sum in lineage order on single-account view", async () => {
    const res = await txnsGET(
      new Request(
        `http://test/api/transactions?accountId=${ACCT_ID}&sort=date&order=asc&limit=100`,
      ),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as TxnRow[];
    expect(rows).toHaveLength(LEDGER.length);

    // Expected balance after each row, in lineage order. The
    // 2026-01-06 rows (t02, t03) tie on `date` — created_at differs
    // by insert order which determines the lineage ordering.
    // Sort-asc returns oldest first; the balance after each row in
    // that order should reflect the cumulative sum up to and
    // including that row's amount.
    const byId = new Map(rows.map((r) => [r.id, r]));

    // Lineage tuple: (date, COALESCE(posted_seq, 0),
    // COALESCE(posted_at, created_at), id). With posted_seq and
    // posted_at null, the fallback is created_at — but the rapid
    // synchronous inserts land in the same millisecond, so
    // created_at ties between t02 and t03. The final `id`
    // tiebreaker resolves: lexicographic "t02" < "t03", so t02
    // sorts first within the 2026-01-06 day:
    //   t01 → 1000 - 100              =  900
    //   t02 → 900  - 50               =  850
    //   t03 → 850  + 200              = 1050
    //   t04 → 1050 - 75               =  975
    //   t05 → 975  + 25               = 1000
    const expected: Array<[string, number]> = [
      ["t01", STARTING - 100], //                       =  900
      ["t02", STARTING - 100 - 50], //                  =  850
      ["t03", STARTING - 100 - 50 + 200], //            = 1050
      ["t04", STARTING - 100 - 50 + 200 - 75], //       =  975
      ["t05", STARTING - 100 - 50 + 200 - 75 + 25], //  = 1000
    ];

    for (const [id, expectedBalance] of expected) {
      const row = byId.get(id);
      expect(row, `row ${id} present`).toBeTruthy();
      expect(
        Number(row!.balance),
        `running balance for ${id}`,
      ).toBeCloseTo(expectedBalance, 2);
    }
  });

  it("balance is null on multi-account view (no single-account scope)", async () => {
    // POST a second account so a query with accountIds=A,B is genuinely
    // multi-account.
    db.drizzleDb
      .insert(accounts)
      .values({
        id: "acct-other",
        name: "Other",
        type: "checking",
        currency: "AUD",
        startingBalance: "0",
        currentBalance: "0",
      })
      .run();

    const res = await txnsGET(
      new Request(
        `http://test/api/transactions?accountIds=${ACCT_ID},acct-other&limit=100`,
      ),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as TxnRow[];
    expect(rows.every((r) => r.balance === null)).toBe(true);
  });
});
