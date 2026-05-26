import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  accounts,
  categories,
  scheduledTransactions,
  scheduleSuggestionDismissals,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  installTestDb,
  type TestDb,
} from "@/__tests__/golden/_helpers/test-db";
import { testAuth } from "@/__tests__/golden/_helpers/auth-mock";

vi.mock("@/lib/auth", () => ({ auth: testAuth }));

/** /api/scheduled/[id] PATCH + DELETE pin two non-trivial bits of
 *  business logic that no integration test covered before today:
 *  - Saving with `kind=budget` strips matcher-only fields
 *    (`amountMin`, `transferToAccountId`, `dayOfMonth`,
 *    `interval`) so a row converted from schedule → budget can't
 *    carry stale values into the budget semantics.
 *  - DELETE plants a `scheduleSuggestionDismissals` row keyed on
 *    `(accountId, normalizedPayee)` so the suggestion engine
 *    doesn't immediately re-detect the same pattern from the
 *    surviving historical transactions and resurface it. */

const ACCT = "11111111-1111-4111-8111-111111111111";
const CAT = "22222222-2222-4222-8222-222222222221";
const SCH_ID = "33333333-3333-4333-8333-333333333331";
const SCH_BUDGET = "33333333-3333-4333-8333-333333333332";
const SCH_404 = "33333333-3333-4333-8333-333333333339";

function makeScheduled(over: Partial<typeof scheduledTransactions.$inferInsert> = {}) {
  return {
    kind: "schedule",
    accountId: ACCT,
    payee: "Netflix",
    amount: "20.00",
    type: "expense" as const,
    frequency: "monthly",
    interval: 1,
    startDate: "2026-01-15",
    ...over,
  };
}

const SCH_TO_DELETE = "44444444-4444-4444-8444-444444444441";

describe("/api/scheduled/[id]", () => {
  let db: TestDb;
  let patchScheduled: (id: string, body: unknown) => Promise<Response>;
  let deleteScheduled: (id: string) => Promise<Response>;

  beforeAll(async () => {
    db = createTestDb();
    installTestDb(db);
    db.drizzleDb
      .insert(accounts)
      .values({
        id: ACCT,
        name: "Checking",
        type: "checking",
        currency: "AUD",
      })
      .run();
    db.drizzleDb
      .insert(categories)
      .values({ id: CAT, name: "Streaming", type: "expense", parentId: null })
      .run();
    db.drizzleDb
      .insert(scheduledTransactions)
      .values([
        makeScheduled({ id: SCH_ID, payee: "Netflix" }),
        // Pre-seeded as a schedule with matcher-only fields populated so
        // the kind=budget test can verify they get nulled.
        makeScheduled({
          id: SCH_BUDGET,
          payee: "Groceries pool",
          kind: "schedule",
          amountMin: "150.00",
          transferToAccountId: ACCT,
          dayOfMonth: 15,
          interval: 2,
        }),
        makeScheduled({ id: SCH_TO_DELETE, payee: "Spotify" }),
      ])
      .run();

    const mod = await import("./route");
    patchScheduled = (id, body) =>
      mod.PATCH(
        new Request(`http://test/api/scheduled/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id }) },
      );
    deleteScheduled = (id) =>
      mod.DELETE(
        new Request(`http://test/api/scheduled/${id}`, { method: "DELETE" }),
        { params: Promise.resolve({ id }) },
      );
  });

  it("PATCH updates allowed fields and returns the patched row", async () => {
    const res = await patchScheduled(SCH_ID, {
      payee: "Netflix AU",
      amount: "22.99",
      categoryId: CAT,
    });
    expect(res.status).toBe(200);
    const row = (await res.json()) as { payee: string; amount: string; categoryId: string };
    expect(row.payee).toBe("Netflix AU");
    expect(row.amount).toBe("22.99");
    expect(row.categoryId).toBe(CAT);
  });

  it("PATCH kind=budget strips matcher-only fields (amountMin, dayOfMonth, transferToAccountId, interval)", async () => {
    const res = await patchScheduled(SCH_BUDGET, { kind: "budget" });
    expect(res.status).toBe(200);
    const persisted = db.drizzleDb
      .select()
      .from(scheduledTransactions)
      .where(eq(scheduledTransactions.id, SCH_BUDGET))
      .all()[0];
    expect(persisted.kind).toBe("budget");
    expect(persisted.type).toBe("expense"); // forced regardless of input
    expect(persisted.amountMin).toBeNull();
    expect(persisted.transferToAccountId).toBeNull();
    expect(persisted.dayOfMonth).toBeNull();
    expect(persisted.interval).toBe(1);
  });

  it("PATCH 404s on an unknown id", async () => {
    const res = await patchScheduled(SCH_404, { payee: "ghost" });
    expect(res.status).toBe(404);
  });

  it("PATCH 400s on malformed body (zod guard)", async () => {
    const res = await patchScheduled(SCH_ID, { amount: 12345 }); // amount must be string
    expect(res.status).toBe(400);
  });

  it("DELETE removes the row and plants a suggestion-dismissal for (accountId, normalizedPayee)", async () => {
    const res = await deleteScheduled(SCH_TO_DELETE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const dismissals = db.drizzleDb
      .select()
      .from(scheduleSuggestionDismissals)
      .all();
    const matching = dismissals.find(
      (d) =>
        d.accountId === ACCT && d.normalizedPayee === "SPOTIFY",
    );
    expect(matching).toBeDefined();
  });

  it("DELETE 404s when the id doesn't match any row (#67)", async () => {
    const res = await deleteScheduled(SCH_404);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not found/i);
  });
});
