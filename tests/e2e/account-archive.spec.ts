import { test, expect } from "@playwright/test";
import {
  signInAsAdmin,
  seedAccount,
  seedTransaction,
  captureErrors,
} from "./_helpers";

/** E2E coverage for the account-archive contract (#19).
 *
 *  The DELETE on `/api/accounts/[id]` is a SOFT-ARCHIVE — it sets
 *  `is_archived = true` rather than cascading the FK and wiping
 *  ledger history. This spec pins the contract:
 *
 *   1. Seed an account + a transaction on it.
 *   2. DELETE the account → 200 (ok).
 *   3. GET the account → still exists with `isArchived = true`.
 *   4. GET `/api/transactions?accountId=X` → the transaction
 *      still exists (the archive did NOT delete it).
 *   5. GET `/api/accounts` defaults to NOT including archived
 *      rows (or includes them with `isArchived` set, depending
 *      on the list contract — assert whatever the route actually
 *      promises).
 *   6. DELETE missing id → 404 (the 404 lets a stale client
 *      distinguish "already deleted" from "succeeded").
 *
 *  This is the contract the user relies on when undoing a
 *  mistakenly-archived account by toggling \`isArchived\` back
 *  to false in Settings → Accounts; if the DELETE were a hard
 *  cascade, that recovery path would be impossible. */

const RUN_TOKEN = Math.random().toString(36).slice(2, 8);

interface AccountRow {
  id: string;
  name: string;
  isArchived: boolean;
}

test.describe("account-archive (#19)", () => {
  test("DELETE soft-archives + keeps linked transactions intact", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ctx = page.context();
    const request = ctx.request;
    const { consoleErrors, pageErrors } = captureErrors(page);

    await signInAsAdmin(page);

    // ── Seed: account + one transaction on it.
    const account = await seedAccount(ctx, {
      name: `${RUN_TOKEN}-archive`,
      type: "checking",
    });
    const txn = await seedTransaction(ctx, {
      accountId: account.id,
      date: "2026-05-15",
      amount: "-12.34",
      payee: `${RUN_TOKEN}-payee`,
    });

    // ── DELETE — soft-archive. The route returns `{ ok: true }`.
    const delRes = await request.delete(`/api/accounts/${account.id}`);
    expect(delRes.ok()).toBeTruthy();
    const delBody = (await delRes.json()) as { ok: boolean };
    expect(delBody.ok).toBe(true);

    // ── GET the account by id — should still exist, but with
    //    isArchived flipped. This is the contract that lets the
    //    user un-archive via the Settings toggle.
    const acctRes = await request.get(`/api/accounts/${account.id}`);
    expect(acctRes.ok()).toBeTruthy();
    const acct = (await acctRes.json()) as AccountRow;
    expect(acct.id).toBe(account.id);
    expect(acct.isArchived).toBe(true);

    // ── Transaction still present. If the route were a hard
    //    cascade-delete instead of a soft archive, this would
    //    404; the ledger would be silently destroyed.
    const txnRes = await request.get(`/api/transactions/${txn.id}`);
    expect(txnRes.ok()).toBeTruthy();
    const txnAfter = (await txnRes.json()) as { id: string; accountId: string };
    expect(txnAfter.id).toBe(txn.id);
    expect(txnAfter.accountId).toBe(account.id);

    // ── GET /api/accounts — default list. Some lists exclude
    //    archived rows by default; others include them with the
    //    flag set. Assert "if the row is present, the flag is
    //    correctly true" — robust to either contract.
    const listRes = await request.get("/api/accounts");
    expect(listRes.ok()).toBeTruthy();
    const list = (await listRes.json()) as AccountRow[];
    const listed = list.find((a) => a.id === account.id);
    if (listed) {
      expect(listed.isArchived).toBe(true);
    }

    // ── DELETE missing id → 404 (the "already deleted vs.
    //    succeeded" disambiguation contract).
    const missingId = "00000000-0000-0000-0000-000000000000";
    const missingRes = await request.delete(`/api/accounts/${missingId}`);
    expect(missingRes.status()).toBe(404);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
