import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bankBalances } from "@/db/schema";
import {
  createTestDb,
  installTestDb,
  type TestDb,
} from "@/__tests__/golden/_helpers/test-db";
import { testAuth } from "@/__tests__/golden/_helpers/auth-mock";
import { eq, asc } from "drizzle-orm";

// Mock auth BEFORE the route handlers are imported.
vi.mock("@/lib/auth", () => ({ auth: testAuth }));

/** Integration coverage for the accounts CSV import — earliest-date
 *  anchor + bank_balances persistence (Westpac-style multi-day
 *  exports).
 *
 *  Verifies:
 *   1. A 3-account × 14-day CSV collapses to 3 preview rows (not 42).
 *   2. Each preview's `startingBalance` matches the earliest-date
 *      row's "Closing Balance".
 *   3. Each preview carries the full daily series.
 *   4. Commit endpoint upserts the series into `bank_balances` with
 *      one row per (accountId, date) — re-committing the same
 *      payload doesn't duplicate; balances refresh in place. */

// Westpac CSV header verbatim (user-supplied).
const HEADER =
  "Account Type,Account Nickname/Name,BSB,Account Number/Portfolio Number,Closing Balance,As at date for closing balance,Market Value,Opening date,Closing date,Export Date and time";

interface AccountSpec {
  name: string;
  type: string;
  accNum: string;
  /** Day-by-day closing balance, indexed by day-of-month (1..14). */
  balanceByDay: number[];
}

function buildWestpacCsv(accounts: AccountSpec[]): string {
  const rows: string[] = [HEADER];
  // 14 days per account: 2026-05-01 .. 2026-05-14.
  for (const acct of accounts) {
    for (let day = 1; day <= 14; day++) {
      const dd = String(day).padStart(2, "0");
      const balance = acct.balanceByDay[day - 1].toFixed(2);
      // Field order matches the header above.
      rows.push(
        [
          acct.type,
          acct.name,
          "032-000",
          acct.accNum,
          balance,
          `2026-05-${dd}`,
          "0.00",
          "2020-01-01",
          "", // closing date — blank = active
          "2026-05-14 23:00:00",
        ].join(","),
      );
    }
  }
  return rows.join("\n");
}

interface PreviewAccount {
  name: string;
  accountNumberLast4?: string;
  startingBalance: string;
  startingDate?: string;
  duplicate: boolean;
  existingId: string | null;
  balanceSeries: Array<{ date: string; balance: string }>;
}

const ACCOUNTS: AccountSpec[] = [
  {
    name: "Everyday",
    type: "Transaction Account",
    accNum: "111111234",
    // Climbing balance over 14 days.
    balanceByDay: Array.from({ length: 14 }, (_, i) => 1000 + i * 10),
  },
  {
    name: "Savings",
    type: "Savings",
    accNum: "222225678",
    balanceByDay: Array.from({ length: 14 }, (_, i) => 10000 + i * 50),
  },
  {
    name: "Loan",
    type: "Mortgage Loan",
    accNum: "333339012",
    balanceByDay: Array.from({ length: 14 }, (_, i) => -200000 + i * 100),
  },
];

describe("accounts CSV import — earliest-date anchor + bank_balances", () => {
  let db: TestDb;
  let parsePOST: (req: Request) => Promise<Response>;
  let commitPOST: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    db = createTestDb();
    installTestDb(db);

    const parseMod = await import("@/app/api/accounts/import/route");
    parsePOST = parseMod.POST as unknown as (req: Request) => Promise<Response>;
    const commitMod = await import("@/app/api/accounts/import/commit/route");
    commitPOST = commitMod.POST as unknown as (req: Request) => Promise<Response>;
  });

  afterAll(() => {
    db.close();
  });

  it("preview collapses 42 rows into 3 accounts with earliest-date anchors", async () => {
    const csv = buildWestpacCsv(ACCOUNTS);
    const fd = new FormData();
    fd.append(
      "file",
      new File([csv], "westpac-accounts.csv", { type: "text/csv" }),
    );
    const res = await parsePOST(
      new Request("http://test/api/accounts/import", {
        method: "POST",
        body: fd,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: PreviewAccount[] };
    expect(body.rows).toHaveLength(3);

    for (const row of body.rows) {
      const spec = ACCOUNTS.find((a) => a.name === row.name)!;
      expect(spec).toBeTruthy();
      // Earliest-date anchor: day 1 = 2026-05-01.
      expect(row.startingDate).toBe("2026-05-01");
      // Anchor balance = day-1 closing balance, normalised to .00.
      expect(row.startingBalance).toBe(spec.balanceByDay[0].toFixed(2));
      // Full series captured for every day in the CSV.
      expect(row.balanceSeries).toHaveLength(14);
      expect(row.balanceSeries[0]).toEqual({
        date: "2026-05-01",
        balance: spec.balanceByDay[0].toFixed(2),
      });
      expect(row.balanceSeries[13]).toEqual({
        date: "2026-05-14",
        balance: spec.balanceByDay[13].toFixed(2),
      });
      // Brand-new install: no duplicates yet.
      expect(row.duplicate).toBe(false);
      expect(row.existingId).toBeNull();
    }
  });

  it("commit upserts the series into bank_balances", async () => {
    const csv = buildWestpacCsv(ACCOUNTS);
    const fd = new FormData();
    fd.append(
      "file",
      new File([csv], "westpac-accounts.csv", { type: "text/csv" }),
    );
    const parseRes = await parsePOST(
      new Request("http://test/api/accounts/import", {
        method: "POST",
        body: fd,
      }),
    );
    const { rows } = (await parseRes.json()) as { rows: PreviewAccount[] };

    const commitRes = await commitPOST(
      new Request("http://test/api/accounts/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      }),
    );
    expect(commitRes.status).toBe(200);
    const commit = (await commitRes.json()) as {
      created: number;
      updated: number;
      balancesUpserted: number;
    };
    expect(commit.created).toBe(3);
    expect(commit.updated).toBe(0);
    // 3 accounts × 14 days = 42 balance rows.
    expect(commit.balancesUpserted).toBe(42);

    // Verify by direct read.
    const allBalances = db.drizzleDb
      .select()
      .from(bankBalances)
      .orderBy(asc(bankBalances.date))
      .all();
    expect(allBalances).toHaveLength(42);
    // Spot-check one account's series came through complete.
    const everydayBalances = allBalances.filter(
      (b) => b.source === "csv-import",
    );
    expect(everydayBalances.length).toBe(42);
  });

  it("re-commit overwrites existing balance rows (UNIQUE(accountId, date))", async () => {
    // Same CSV, BUT bump every day's balance by 1.
    const bumpedAccounts: AccountSpec[] = ACCOUNTS.map((a) => ({
      ...a,
      balanceByDay: a.balanceByDay.map((b) => b + 1),
    }));
    const csv = buildWestpacCsv(bumpedAccounts);
    const fd = new FormData();
    fd.append(
      "file",
      new File([csv], "westpac-accounts.csv", { type: "text/csv" }),
    );
    const parseRes = await parsePOST(
      new Request("http://test/api/accounts/import", {
        method: "POST",
        body: fd,
      }),
    );
    const { rows } = (await parseRes.json()) as { rows: PreviewAccount[] };
    // Names match existing accounts — should be duplicates with existingId set.
    for (const row of rows) {
      expect(row.duplicate).toBe(true);
      expect(row.existingId).toBeTruthy();
    }

    const commitRes = await commitPOST(
      new Request("http://test/api/accounts/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      }),
    );
    expect(commitRes.status).toBe(200);
    const commit = (await commitRes.json()) as {
      created: number;
      updated: number;
      balancesUpserted: number;
    };
    expect(commit.created).toBe(0);
    expect(commit.updated).toBe(3);

    // Still exactly 42 rows in bank_balances (no duplicates).
    const allBalances = db.drizzleDb.select().from(bankBalances).all();
    expect(allBalances).toHaveLength(42);
    // And the May-01 row for "Everyday" reflects the BUMPED value
    // (1001.00 instead of 1000.00) — proves the upsert refreshed.
    const everydayId = rows.find((r) => r.name === "Everyday")!.existingId!;
    const may01 = db.drizzleDb
      .select()
      .from(bankBalances)
      .where(eq(bankBalances.accountId, everydayId))
      .all()
      .find((b) => b.date === "2026-05-01");
    expect(may01?.balance).toBe("1001.00");
  });
});
