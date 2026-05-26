import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  accounts,
  dismissedTransferPairs,
  transactions,
  transferSuggestions,
} from "@/db/schema";
import {
  createTestDb,
  installTestDb,
  type TestDb,
} from "@/__tests__/golden/_helpers/test-db";
import { testAuth } from "@/__tests__/golden/_helpers/auth-mock";

vi.mock("@/lib/auth", () => ({ auth: testAuth }));

/** /api/transfers/suggestions/[id] DELETE pins the sticky-dismiss
 *  contract (0.194 release): dismissing a suggested transfer pair
 *  must record the (transactionId, candidateId) tuple in
 *  `dismissed_transfer_pairs` so the matcher doesn't keep
 *  re-discovering and re-inserting the same suggestion every run.
 *  The unique-index guard on transfer_suggestions only fires once
 *  a row exists, which it doesn't after the DELETE. */

const ACCT_A = "11111111-1111-4111-8111-111111111111";
const ACCT_B = "11111111-1111-4111-8111-111111111112";
const TXN_A = "22222222-2222-4222-8222-222222222221";
const TXN_B = "22222222-2222-4222-8222-222222222222";
const SUG_ID = "33333333-3333-4333-8333-333333333331";
const SUG_404 = "33333333-3333-4333-8333-333333333339";

describe("/api/transfers/suggestions/[id] DELETE", () => {
  let db: TestDb;
  let dismissSuggestion: (id: string) => Promise<Response>;

  beforeAll(async () => {
    db = createTestDb();
    installTestDb(db);
    db.drizzleDb
      .insert(accounts)
      .values([
        { id: ACCT_A, name: "Checking", type: "checking", currency: "AUD" },
        { id: ACCT_B, name: "Savings", type: "savings", currency: "AUD" },
      ])
      .run();
    db.drizzleDb
      .insert(transactions)
      .values([
        // Outflow from Checking …
        { id: TXN_A, accountId: ACCT_A, date: "2026-05-01", amount: "-200" },
        // … and matching inflow on Savings — the canonical transfer pair.
        { id: TXN_B, accountId: ACCT_B, date: "2026-05-01", amount: "200" },
      ])
      .run();
    db.drizzleDb
      .insert(transferSuggestions)
      .values({
        id: SUG_ID,
        transactionId: TXN_A,
        candidateId: TXN_B,
        score: 100,
      })
      .run();

    const mod = await import("./route");
    dismissSuggestion = (id) =>
      mod.DELETE(
        new Request(`http://test/api/transfers/suggestions/${id}`, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ id }) },
      );
  });

  it("records the (transactionId, candidateId) pair in dismissed_transfer_pairs", async () => {
    const res = await dismissSuggestion(SUG_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const dismissed = db.drizzleDb
      .select()
      .from(dismissedTransferPairs)
      .all();
    const matching = dismissed.find(
      (d) => d.transactionId === TXN_A && d.candidateId === TXN_B,
    );
    expect(matching).toBeDefined();
  });

  it("returns ok even when the suggestion id doesn't match — DELETE is idempotent", async () => {
    // The route doesn't 404 on missing suggestions because the UI
    // can race with the matcher (suggestion may have already been
    // pruned by a refresh between render + click). It silently
    // succeeds; the sticky-dismiss table just doesn't grow.
    const res = await dismissSuggestion(SUG_404);
    expect(res.status).toBe(200);
  });
});
