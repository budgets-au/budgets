import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import {
  signInAsAdmin,
  seedAccount,
  captureErrors,
} from "./_helpers";

/** E2E coverage for the import undo-commit round-trip (#9).
 *
 *  The commit-batched endpoint is the only commit surface for the
 *  import view; the undo-commit endpoint is its companion rollback
 *  — given the `importLogIds` returned by commit, delete every
 *  transaction tagged with those logs and recompute the affected
 *  accounts' currentBalance.
 *
 *  The contract this spec pins:
 *    1. Commit two pre-resolved rows → 200 with
 *       `{ imported: 2, importLogIds: [<one id>] }`.
 *    2. GET `/api/transactions/count?accountId=X` → 2.
 *    3. GET `/api/accounts/{id}` → currentBalance reflects the
 *       committed amounts (+ startingBalance).
 *    4. POST `/api/import/undo-commit` with the importLogIds →
 *       200 with `{ deleted: 2 }`.
 *    5. GET count again → back to 0.
 *    6. GET account → currentBalance back to startingBalance.
 *    7. Re-POST the same undo body → 200 with `{ deleted: 0 }`
 *       (idempotent; doesn't 404 on already-undone logs).
 *
 *  No tx-level race assertions — that's a separate concern and
 *  has its own coverage. */

const RUN_TOKEN = Math.random().toString(36).slice(2, 8);

function importHashFor(parts: string[]): string {
  // The route uses `crypto.createHash("sha256").update(...).digest("hex")`
  // on a stable concatenation. We don't need to MATCH the production
  // hash here — only emit a unique string per row so the dedup gate
  // doesn't fold our two rows into one. SHA-256 of the joined parts
  // is good enough for that uniqueness invariant.
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

interface CommitResponse {
  imported: number;
  skippedDuplicate: number;
  importLogIds: string[];
  accountsTouched: number;
}

interface UndoResponse {
  deletedTransactions: number;
  deletedImportLogs: number;
  accountsRefreshed: number;
}

test.describe("import undo-commit round-trip (#9)", () => {
  test("commit two rows → count + balance reflect → undo → both reset", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ctx = page.context();
    const request = ctx.request;
    const { consoleErrors, pageErrors } = captureErrors(page);

    await signInAsAdmin(page);

    // ── Fresh account so the test's totals don't tangle with
    //    seeded sample-data rows on shared accounts.
    const account = await seedAccount(ctx, {
      name: `${RUN_TOKEN}-undo`,
      type: "checking",
      currentBalance: "0",
    });

    // ── Commit two pre-resolved rows. The shape mirrors what the
    //    import view POSTs after its categorise pass.
    const date = "2026-05-01";
    const rows = [
      {
        accountId: account.id,
        date,
        amount: "-25.50",
        payee: `${RUN_TOKEN}-payee-A`,
        importHash: importHashFor([account.id, date, "-25.50", "A"]),
        rawId: `${RUN_TOKEN}-A`,
      },
      {
        accountId: account.id,
        date,
        amount: "-14.75",
        payee: `${RUN_TOKEN}-payee-B`,
        importHash: importHashFor([account.id, date, "-14.75", "B"]),
        rawId: `${RUN_TOKEN}-B`,
      },
    ];

    const commitRes = await request.post("/api/import/commit-batched", {
      data: {
        filename: `${RUN_TOKEN}.csv`,
        format: "test",
        rows,
      },
    });
    expect(commitRes.ok()).toBeTruthy();
    const commit = (await commitRes.json()) as CommitResponse;
    expect(commit.imported).toBe(2);
    expect(commit.skippedDuplicate).toBe(0);
    expect(commit.accountsTouched).toBe(1);
    expect(commit.importLogIds.length).toBe(1);
    const importLogId = commit.importLogIds[0];
    expect(importLogId).toBeTruthy();

    // ── COUNT route shows the freshly-committed pair.
    const countAfter = await request.get(
      `/api/transactions/count?accountId=${account.id}`,
    );
    expect(countAfter.ok()).toBeTruthy();
    const countAfterBody = (await countAfter.json()) as { total: number };
    expect(countAfterBody.total).toBe(2);

    // ── currentBalance reflects the committed amounts. -25.50 +
    //    -14.75 = -40.25 against a starting balance of 0.
    const acctAfter = await request.get(`/api/accounts/${account.id}`);
    expect(acctAfter.ok()).toBeTruthy();
    const acctAfterBody = (await acctAfter.json()) as { currentBalance: string };
    expect(Number(acctAfterBody.currentBalance)).toBeCloseTo(-40.25, 2);

    // ── Undo. The route returns
    //    `{ deletedTransactions, deletedImportLogs, accountsRefreshed }`.
    const undoRes = await request.post("/api/import/undo-commit", {
      data: { importLogIds: [importLogId] },
    });
    expect(undoRes.ok()).toBeTruthy();
    const undo = (await undoRes.json()) as UndoResponse;
    expect(undo.deletedTransactions).toBe(2);
    expect(undo.deletedImportLogs).toBe(1);
    expect(undo.accountsRefreshed).toBe(1);

    // ── Counts AND balance must both reset; if only one resets,
    //    the undo path is buggy (e.g. txns deleted but
    //    currentBalance recompute skipped — the historical
    //    failure mode this spec guards against).
    const countAfterUndo = await request.get(
      `/api/transactions/count?accountId=${account.id}`,
    );
    expect(((await countAfterUndo.json()) as { total: number }).total).toBe(0);

    const acctAfterUndo = await request.get(`/api/accounts/${account.id}`);
    const acctAfterUndoBody = (await acctAfterUndo.json()) as {
      currentBalance: string;
    };
    expect(Number(acctAfterUndoBody.currentBalance)).toBeCloseTo(0, 2);

    // ── Idempotency: re-undoing the same (now empty) log should
    //    return 0-deleted, not 404 — the route deletes log rows
    //    along with the txns, so the second call is a no-op on
    //    an empty WHERE clause.
    const undoAgainRes = await request.post("/api/import/undo-commit", {
      data: { importLogIds: [importLogId] },
    });
    expect(undoAgainRes.ok()).toBeTruthy();
    const undoAgain = (await undoAgainRes.json()) as UndoResponse;
    expect(undoAgain.deletedTransactions).toBe(0);
    expect(undoAgain.deletedImportLogs).toBe(0);
    expect(undoAgain.accountsRefreshed).toBe(0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
