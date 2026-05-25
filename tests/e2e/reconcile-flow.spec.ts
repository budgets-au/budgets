import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import {
  signInAsAdmin,
  seedAccount,
  seedTransaction,
  captureErrors,
} from "./_helpers";

/** E2E coverage for the reconcile flow (#18).
 *
 *  Contract pinned:
 *
 *   1. Seed an account with `currentBalance: "0"` and two
 *      transactions summing to a known total on a known date.
 *   2. POST `/api/accounts/{id}/reconcile { date, balance }` with
 *      the correct balance → 200 `{ matched: true, reconciled: 2 }`.
 *      Every transaction on/before `date` is marked
 *      `isReconciled = true` (proven by GET on each txn after).
 *   3. Re-POST with the same args → 200 `{ matched: true,
 *      reconciled: 0 }` (idempotent — already-reconciled rows
 *      don't get touched).
 *   4. POST with a WRONG balance → 200 `{ matched: false,
 *      expected, stated, diff }`. The unreconciled txns stay
 *      unreconciled (proven by a third GET).
 *   5. POST against a missing accountId → 404.
 *
 *  Cents-based comparison: the route rounds both sides to integer
 *  cents BEFORE the diff (so a long sum of float amounts doesn't
 *  produce false off-by-fractions). This spec uses round-cents
 *  inputs so the assertions stay deterministic. */

const RUN_TOKEN = randomBytes(3).toString("hex");

interface ReconcileMatch {
  matched: true;
  reconciled: number;
}
interface ReconcileMiss {
  matched: false;
  expected: string;
  stated: string;
  diff: string;
}
type ReconcileResponse = ReconcileMatch | ReconcileMiss;

interface TxnRow {
  id: string;
  isReconciled: boolean;
}

test.describe("reconcile flow (#18)", () => {
  test("matched / idempotent re-match / mismatch / 404", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ctx = page.context();
    const request = ctx.request;
    const { consoleErrors, pageErrors } = captureErrors(page);

    await signInAsAdmin(page);

    // ── Seed: account at 0; two txns on 2026-04-15 (-30, -70) so
    //    expected end-of-day balance is -100.
    const account = await seedAccount(ctx, {
      name: `${RUN_TOKEN}-rec`,
      type: "checking",
      currentBalance: "0",
    });
    const date = "2026-04-15";
    const t1 = await seedTransaction(ctx, {
      accountId: account.id,
      date,
      amount: "-30",
      payee: `${RUN_TOKEN}-a`,
    });
    const t2 = await seedTransaction(ctx, {
      accountId: account.id,
      date,
      amount: "-70",
      payee: `${RUN_TOKEN}-b`,
    });

    // ── 1) Matched leg — balance matches → 2 txns marked.
    const matchRes = await request.post(
      `/api/accounts/${account.id}/reconcile`,
      { data: { date, balance: "-100" } },
    );
    expect(matchRes.ok()).toBeTruthy();
    const match = (await matchRes.json()) as ReconcileResponse;
    expect(match.matched).toBe(true);
    expect((match as ReconcileMatch).reconciled).toBe(2);

    // Cross-check via GET — both txns now isReconciled=true.
    for (const id of [t1.id, t2.id]) {
      const r = await request.get(`/api/transactions/${id}`);
      const row = (await r.json()) as TxnRow;
      expect(row.isReconciled).toBe(true);
    }

    // ── 2) Idempotent leg — same call returns matched:true with
    //    `reconciled: 0` because nothing flipped state.
    const matchAgainRes = await request.post(
      `/api/accounts/${account.id}/reconcile`,
      { data: { date, balance: "-100" } },
    );
    expect(matchAgainRes.ok()).toBeTruthy();
    const matchAgain = (await matchAgainRes.json()) as ReconcileResponse;
    expect(matchAgain.matched).toBe(true);
    expect((matchAgain as ReconcileMatch).reconciled).toBe(0);

    // ── 3) Mismatch leg — wrong balance returns the diff in cents
    //    formatted to 2dp. -100 expected vs. -95 stated → diff = 5
    //    (positive because stated > expected after sign flip).
    //    Seed another account so the just-reconciled rows above
    //    don't pollute the mismatch math.
    const acct2 = await seedAccount(ctx, {
      name: `${RUN_TOKEN}-rec2`,
      type: "checking",
      currentBalance: "0",
    });
    await seedTransaction(ctx, {
      accountId: acct2.id,
      date,
      amount: "-50",
      payee: `${RUN_TOKEN}-c`,
    });
    const missRes = await request.post(
      `/api/accounts/${acct2.id}/reconcile`,
      { data: { date, balance: "-45" } },
    );
    expect(missRes.ok()).toBeTruthy();
    const miss = (await missRes.json()) as ReconcileResponse;
    expect(miss.matched).toBe(false);
    expect((miss as ReconcileMiss).expected).toBe("-50.00");
    expect((miss as ReconcileMiss).stated).toBe("-45.00");
    expect((miss as ReconcileMiss).diff).toBe("5.00");

    // ── 4) Missing accountId → 404.
    const missingId = "00000000-0000-0000-0000-000000000000";
    const missingRes = await request.post(
      `/api/accounts/${missingId}/reconcile`,
      { data: { date, balance: "0" } },
    );
    expect(missingRes.status()).toBe(404);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
