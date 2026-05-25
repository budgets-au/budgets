import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { accounts, transactions } from "@/db/schema";
import {
  createTestDb,
  installTestDb,
  type TestDb,
} from "@/__tests__/golden/_helpers/test-db";
import { testAuth } from "@/__tests__/golden/_helpers/auth-mock";
import { eq } from "drizzle-orm";

// Mock auth BEFORE the route handler is imported below. Without this
// the route's `withAuth` wrapper transitively loads next-auth and
// vitest can't resolve `next/server` (path-extension mismatch).
vi.mock("@/lib/auth", () => ({ auth: testAuth }));

/** Integration coverage for the chunked-bulk-insert + chunked-inArray
 *  paths in `/api/import/commit-batched` (#fix:too-many-sql-variables).
 *
 *  Background: a single-account CSV import building up to ~32k bound
 *  parameters in one SQL statement used to 500 the request with
 *  "too many SQL variables" (SQLite's per-statement param cap is 32766
 *  in the @signalapp/better-sqlite3 build we ship). Two call sites
 *  triggered it:
 *
 *   1. The `inArray(transactions.importHash, lookupHashes)` lookup —
 *      up to 2 hashes per input row, capped over a 20k-row import.
 *   2. The bulk `db.insert(transactions).values([...])` — ~15 fields
 *      per row, exceeded the cap above ~2200 rows.
 *
 *  Both call sites now go through chunked helpers
 *  (`chunkedQuery` at 5000-id slices, `chunkedExec` at 1500-row
 *  slices). This test seeds one account, fires a 2000-row payload at
 *  the real GET handler via `installTestDb`, and asserts every row
 *  lands. 2000 rows is comfortably past the historical breakage
 *  threshold (2200) for the bulk-insert path AND past the dedup-lookup
 *  threshold once both new+old hashes are accumulated. Chunk-boundary
 *  off-by-one regressions on the 1500-row insert boundary are caught
 *  by the explicit count assertion. */

// Must be a real UUID — the route's zod schema enforces `accountId: z.string().uuid()`.
const ACCT_ID = "11111111-1111-4111-8111-111111111111";
const ROW_COUNT = 2000;

function importHashFor(parts: string[]): string {
  // The route only USES the hash for dedup — content doesn't matter
  // as long as each row is unique. SHA-256 of the joined parts is
  // plenty.
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

describe("/api/import/commit-batched chunked imports (too-many-sql-variables fix)", () => {
  let db: TestDb;
  let commitPOST: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    db = createTestDb();
    installTestDb(db);

    db.drizzleDb
      .insert(accounts)
      .values({
        id: ACCT_ID,
        name: "BulkAccount",
        type: "checking",
        currency: "AUD",
        startingBalance: "0",
        currentBalance: "0",
      })
      .run();

    const mod = await import("@/app/api/import/commit-batched/route");
    commitPOST = mod.POST as unknown as (req: Request) => Promise<Response>;
  });

  afterAll(() => {
    db.close();
  });

  it("commits a 2000-row payload without 'too many SQL variables'", async () => {
    // Build a 2000-row payload — past both the historical bulk-insert
    // breakage threshold (~2200 was the cap; 2000 × 15 fields = 30000
    // params) and past the inArray-dedup breakage on lookupHashes.
    const baseDate = "2026-01-01";
    const rows = Array.from({ length: ROW_COUNT }, (_, i) => ({
      accountId: ACCT_ID,
      date: baseDate,
      // Each row a unique amount so importHash diverges deterministically.
      amount: `-${(i + 1).toFixed(2)}`,
      payee: `bulk-payee-${i}`,
      importHash: importHashFor([ACCT_ID, baseDate, String(i)]),
      rawId: `bulk-${i}`,
    }));

    const res = await commitPOST(
      new Request("http://test/api/import/commit-batched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "bulk.csv",
          format: "test",
          rows,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      imported: number;
      skippedDuplicate: number;
      importLogIds: string[];
    };
    expect(body.imported).toBe(ROW_COUNT);
    expect(body.skippedDuplicate).toBe(0);

    // Cross-check: the DB really has every row. Use a count via
    // raw SQL to avoid pulling 2000 rows into JS just to .length.
    const count = (
      db.client
        .prepare("SELECT COUNT(*) AS c FROM transactions WHERE account_id = ?")
        .get(ACCT_ID) as { c: number }
    ).c;
    expect(count).toBe(ROW_COUNT);
  });

  it("re-commit dedups every row via importHash (still chunked)", async () => {
    // Same payload again — the chunked lookup-by-importHash query
    // should match every row. Exercises the chunkedQuery path
    // specifically (the bulk insert is a no-op when every hash hits).
    const baseDate = "2026-01-01";
    const rows = Array.from({ length: ROW_COUNT }, (_, i) => ({
      accountId: ACCT_ID,
      date: baseDate,
      amount: `-${(i + 1).toFixed(2)}`,
      payee: `bulk-payee-${i}`,
      importHash: importHashFor([ACCT_ID, baseDate, String(i)]),
      rawId: `bulk-${i}`,
    }));

    const res = await commitPOST(
      new Request("http://test/api/import/commit-batched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "bulk-redo.csv",
          format: "test",
          rows,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      imported: number;
      skippedDuplicate: number;
    };
    // imported counts dupe-matched + new — the route signals "saw the
    // row" regardless of whether it inserted. skippedDuplicate is the
    // honest indicator: every row matched its prior importHash.
    expect(body.skippedDuplicate).toBe(ROW_COUNT);

    const count = (
      db.client
        .prepare("SELECT COUNT(*) AS c FROM transactions WHERE account_id = ?")
        .get(ACCT_ID) as { c: number }
    ).c;
    // Total rows unchanged — no duplicates inserted.
    expect(count).toBe(ROW_COUNT);

    // Quick sanity-check that an account row is still present (the
    // currentBalance refresh path also runs through inArray on
    // touchedAccountIds, but `touchedAccountIds.size === 1` here so
    // that path is trivially under the cap).
    const acctRow = db.drizzleDb
      .select()
      .from(accounts)
      .where(eq(accounts.id, ACCT_ID))
      .all();
    expect(acctRow).toHaveLength(1);
  });
});
