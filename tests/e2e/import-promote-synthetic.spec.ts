import { test, expect } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import {
  signInAsAdmin,
  seedAccount,
  seedTransaction,
  captureErrors,
} from "./_helpers";

/** E2E coverage for the cross-account synthetic-counterparty
 *  promotion in commit-batched (#14).
 *
 *  When the user links a real transfer to an untracked
 *  counterparty via "Link as transfer (external)", the API
 *  mints a synthetic stub in the External account
 *  (`manualPairExternal` in transfer-match.ts). Later, when
 *  they import the real CSV from the counterparty bank, the
 *  commit-batched route should PROMOTE the synthetic in place
 *  — replacing the placeholder payee/date/import-metadata with
 *  the real CSV row's values while keeping the synthetic's id
 *  and `transfer_pair_id` intact. Source-leg's pair stays
 *  valid.
 *
 *  Contract pinned:
 *
 *   1. Seed account A with a real transaction T_A (-100).
 *   2. PATCH `/api/transactions/{T_A.id}/transfer-pair` with
 *      `{ external: "External" }` → mints a synthetic on the
 *      External account; response carries `syntheticId` and
 *      `externalAccountId`.
 *   3. POST `/api/import/commit-batched` against
 *      `externalAccountId` with a CSV-style row whose amount
 *      matches the synthetic (+100, within 3 days).
 *   4. After commit:
 *      - The row at `syntheticId` is now the promoted real row
 *        (payee = CSV's payee, importHash set, isSynthetic=false).
 *      - The id is unchanged (in-place update).
 *      - `transferPairId` still points at T_A.id (pair intact).
 *      - GET /api/transactions?accountId=externalAccountId
 *        returns ONLY the promoted row — no new row was inserted
 *        because the promotion replaced the synthetic in place.
 *
 *  Mismatched-amount control: a row whose amount differs from
 *  the synthetic by even a cent SHOULD NOT promote — instead it
 *  inserts as a fresh row. The spec adds a second account and
 *  exercises that path to prove the strict-amount-match guard. */

const RUN_TOKEN = randomBytes(3).toString("hex");

function importHashFor(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

interface PairExternalResponse {
  syntheticId: string;
  externalAccountId: string;
  pairId: string;
}

interface CommitResponse {
  imported: number;
  importLogIds: string[];
}

interface TxnRow {
  id: string;
  payee: string | null;
  amount: string;
  isSynthetic: boolean;
  transferPairId: string | null;
  importHash: string | null;
  date: string;
}

test.describe("import promotes synthetic counterparty (#14)", () => {
  test("matching CSV row promotes synthetic in place; mismatched amount inserts fresh", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ctx = page.context();
    const request = ctx.request;
    const { consoleErrors, pageErrors } = captureErrors(page);

    await signInAsAdmin(page);

    const date = "2026-04-10";

    // ── Seed: account A with a real outgoing txn.
    const account = await seedAccount(ctx, {
      name: `${RUN_TOKEN}-real`,
      type: "checking",
    });
    const txnA = await seedTransaction(ctx, {
      accountId: account.id,
      date,
      amount: "-100",
      payee: `${RUN_TOKEN}-source-leg`,
    });

    // ── Mint a synthetic counterpart on External via the
    //    transfer-pair endpoint.
    const pairRes = await request.patch(
      `/api/transactions/${txnA.id}/transfer-pair`,
      { data: { external: "External" } },
    );
    expect(pairRes.ok()).toBeTruthy();
    const pair = (await pairRes.json()) as PairExternalResponse;
    expect(pair.syntheticId).toBeTruthy();
    expect(pair.externalAccountId).toBeTruthy();

    // Capture pre-promotion state of the synthetic for the
    // post-promotion delta check.
    const synthBeforeRes = await request.get(
      `/api/transactions/${pair.syntheticId}`,
    );
    expect(synthBeforeRes.ok()).toBeTruthy();
    const synthBefore = (await synthBeforeRes.json()) as TxnRow;
    expect(synthBefore.isSynthetic).toBe(true);
    expect(synthBefore.transferPairId).toBe(txnA.id);

    // ── Pre-count txns on External — should be exactly 1 (the
    //    synthetic). Post-promotion this should also be 1 (in-place).
    const beforeCountRes = await request.get(
      `/api/transactions/count?accountId=${pair.externalAccountId}`,
    );
    const beforeCount = ((await beforeCountRes.json()) as { total: number })
      .total;
    expect(beforeCount).toBe(1);

    // ── POST commit-batched against External with a row that
    //    matches the synthetic on amount + date (within 3 days).
    const promotedPayee = `${RUN_TOKEN}-real-counterparty-row`;
    const commitRes = await request.post("/api/import/commit-batched", {
      data: {
        filename: `${RUN_TOKEN}-promote.csv`,
        format: "test",
        rows: [
          {
            accountId: pair.externalAccountId,
            date,
            amount: "100",
            payee: promotedPayee,
            importHash: importHashFor([pair.externalAccountId, date, "promote"]),
            rawId: `${RUN_TOKEN}-promote`,
          },
        ],
      },
    });
    expect(commitRes.ok()).toBeTruthy();
    const commit = (await commitRes.json()) as CommitResponse;
    expect(commit.imported).toBe(1);

    // ── In-place check: External's txn count is STILL 1 (no
    //    new insert; the synthetic was promoted in place).
    const afterCountRes = await request.get(
      `/api/transactions/count?accountId=${pair.externalAccountId}`,
    );
    expect(
      ((await afterCountRes.json()) as { total: number }).total,
    ).toBe(1);

    // ── GET the synthetic by ID — same id, real payee + import
    //    hash, isSynthetic flipped to false, pair preserved.
    const synthAfterRes = await request.get(
      `/api/transactions/${pair.syntheticId}`,
    );
    expect(synthAfterRes.ok()).toBeTruthy();
    const synthAfter = (await synthAfterRes.json()) as TxnRow;
    expect(synthAfter.id).toBe(pair.syntheticId);
    expect(synthAfter.payee).toBe(promotedPayee);
    expect(synthAfter.isSynthetic).toBe(false);
    expect(synthAfter.transferPairId).toBe(txnA.id);
    expect(synthAfter.importHash).toBeTruthy();
    expect(parseFloat(synthAfter.amount)).toBeCloseTo(100, 2);

    // ── Mismatch-amount control: seed a second pair, then try
    //    to promote with a wrong-by-1-cent row. The route's
    //    strict cents match should refuse to promote and insert
    //    a fresh row instead — proving the guard is tight.
    const txnB = await seedTransaction(ctx, {
      accountId: account.id,
      date,
      amount: "-50",
      payee: `${RUN_TOKEN}-source-leg-B`,
    });
    const pair2Res = await request.patch(
      `/api/transactions/${txnB.id}/transfer-pair`,
      { data: { external: "External" } },
    );
    const pair2 = (await pair2Res.json()) as PairExternalResponse;

    const mismatchRes = await request.post("/api/import/commit-batched", {
      data: {
        filename: `${RUN_TOKEN}-mismatch.csv`,
        format: "test",
        rows: [
          {
            accountId: pair.externalAccountId,
            date,
            amount: "50.01", // off by 1 cent
            payee: `${RUN_TOKEN}-mismatch-row`,
            importHash: importHashFor([pair.externalAccountId, date, "mismatch"]),
            rawId: `${RUN_TOKEN}-mismatch`,
          },
        ],
      },
    });
    expect(mismatchRes.ok()).toBeTruthy();
    expect(((await mismatchRes.json()) as CommitResponse).imported).toBe(1);

    // Synthetic for pair2 should still be synthetic — not promoted.
    const synth2Res = await request.get(
      `/api/transactions/${pair2.syntheticId}`,
    );
    const synth2 = (await synth2Res.json()) as TxnRow;
    expect(synth2.isSynthetic).toBe(true);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
