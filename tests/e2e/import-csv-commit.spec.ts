import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { captureErrors, signInAsAdmin } from "./_helpers";

/** End-to-end CSV import → categorise → commit → verify → re-import
 *  dedup. The full path is destructive-banned in the breadth-first
 *  monkey crawl (see `tests/e2e/monkey.spec.ts:CRAWL_PAGES`), so
 *  there's been no coverage of the wettest-path-on-the-app feature
 *  — drop a real bank file, commit it. A regression here corrupts
 *  the ledger; this spec catches that.
 *
 *  Steps:
 *   1. Wipe sample-data + create a fresh "Westpac Checking" account.
 *   2. Pre-seed an `account-alias` mapping the fixture's bank-id
 *      (`999999999999`) → the new account, so the upload skips the
 *      Unresolved Accounts UX (which is its own combobox-driven
 *      flow — covered separately if we want).
 *   3. Navigate `/import`, drop the fixture CSV, wait for parse.
 *   4. Click "Commit N rows" — capture N from the button label
 *      (the count is dynamic against the fixture size).
 *   5. Verify via `/api/transactions?accountId=<id>` that exactly
 *      N rows landed on the seeded account.
 *   6. Re-import the SAME file. Parse-side dedup via `importHash`
 *      should mark every row as `existing`, so the Commit button
 *      switches to "Nothing to commit" — the row count stays at
 *      N (no duplicates).
 *
 *  Fixture: [`tests/fixtures/csv-westpac-sample.csv`](../blob/main/tests/fixtures/csv-westpac-sample.csv)
 *  — 23 rows already wired through `parse-csv.test.ts`.
 */

const FIXTURE = resolve(process.cwd(), "tests/fixtures/csv-westpac-sample.csv");
const BANK_ID = "999999999999"; // First column in the fixture

test.describe("CSV import → commit end-to-end (#8)", () => {
  test("commit fixture; re-import dedups via importHash", async ({ page }) => {
    test.setTimeout(120_000);
    const request = page.context().request;
    const { consoleErrors, pageErrors } = captureErrors(page);

    await signInAsAdmin(page);

    // ── Setup ──────────────────────────────────────────────────────
    // Wipe sample-data so the post-commit count assertion is clean.
    const wipeRes = await request.post("/api/sample-data/remove");
    expect(wipeRes.ok()).toBeTruthy();

    // Fresh account to import into.
    const acctRes = await request.post("/api/accounts", {
      data: {
        name: "Westpac Checking",
        type: "checking",
        color: "#3b82f6",
        currentBalance: "0",
      },
    });
    expect(acctRes.ok()).toBeTruthy();
    const account = (await acctRes.json()) as { id: string };

    // Pre-seed the bank-id → account alias so the upload doesn't
    // hit the Unresolved Accounts combobox flow (that's a separate
    // UX surface and not the focus of this spec).
    const aliasRes = await request.post("/api/import/learn-aliases", {
      data: {
        aliases: [
          { kind: "bank-account", value: BANK_ID, accountId: account.id },
        ],
      },
    });
    expect(aliasRes.ok()).toBeTruthy();

    // ── Drop the CSV ──────────────────────────────────────────────
    await page.goto("/import");
    await page.waitForLoadState("networkidle");

    // react-dropzone renders a (visually-hidden) `<input type="file">`
    // — Playwright drives it via setInputFiles.
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(FIXTURE);

    // First-CSV-on-this-DB triggers a confirmation alertdialog
    // ("CSV hashes don't line up with other formats — re-importing
    // the same statement in a different format will create
    // duplicates"). The dialog opens after the format-check API
    // call returns, which can take a couple of seconds on cold
    // start — wait deterministically.
    const useCsvBtn = page.getByRole("button", { name: /^Use CSV$/i });
    await expect(useCsvBtn).toBeVisible({ timeout: 15_000 });
    await useCsvBtn.click();

    // Parse round-trip: `/api/import/format-check` then
    // `/api/import/categorise`. The Commit button appears with a
    // count once parsing settles.
    const commitBtn = page.getByRole("button", {
      name: /^Commit \d+ rows?/i,
    });
    await expect(commitBtn).toBeVisible({ timeout: 15_000 });

    // Read N from the button label.
    const label = (await commitBtn.textContent()) ?? "";
    const m = label.match(/Commit (\d+) row/);
    expect(m, `Commit button label didn't carry a count: "${label}"`).not.toBeNull();
    const N = parseInt(m![1], 10);
    expect(N).toBeGreaterThan(0);

    // ── Commit ────────────────────────────────────────────────────
    // The commit path has a per-account first-CSV confirm
    // ("First CSV import for this account" → button labelled
    // "Import CSV"). It opens AFTER an async /api/import/format-check
    // round-trip, so the dialog can take 2-3s to mount post-click
    // — wait deterministically.
    await commitBtn.click();
    const commitConfirmBtn = page.getByRole("button", {
      name: /^Import CSV$/i,
    });
    await expect(commitConfirmBtn).toBeVisible({ timeout: 15_000 });
    const commitResPromise = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/import/commit-batched") &&
        r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await commitConfirmBtn.click();
    const commitRes = await commitResPromise;
    expect(commitRes.ok()).toBeTruthy();
    const commitBody = (await commitRes.json()) as {
      imported?: number;
      importLogIds?: string[];
    };
    expect(commitBody.imported).toBe(N);
    expect(commitBody.importLogIds?.length).toBeGreaterThan(0);

    // ── Verify rows landed on the seeded account ──────────────────
    const txnsRes = await request.get(
      `/api/transactions?accountId=${account.id}&limit=500`,
    );
    expect(txnsRes.ok()).toBeTruthy();
    const txns = (await txnsRes.json()) as Array<{ id: string }>;
    expect(txns.length).toBe(N);

    // ── Re-import the same file → dedup ──────────────────────────
    await page.goto("/import");
    await page.waitForLoadState("networkidle");
    const fileInput2 = page.locator('input[type="file"]').first();
    await fileInput2.setInputFiles(FIXTURE);

    // After re-parse, the Commit button should NOT show
    // "Commit N rows" — every row is dedup'd via importHash so
    // newCount is 0. The button label switches to one of:
    //   "Nothing to commit"  — when chain hash also matches
    //   "Update N"           — non-key fields drifted (rare)
    //   "Fix N balance mismatches" — parser sees a chain delta
    // We don't care which; the invariant is "no new commit".
    const reimportBtn = page.getByRole("button", {
      name: /^(Nothing to commit|Update \d+|Fix \d+ balance mismatch)/i,
    });
    await expect(reimportBtn).toBeVisible({ timeout: 15_000 });

    // The hard assertion: no new rows landed on the account.
    const txnsRes2 = await request.get(
      `/api/transactions?accountId=${account.id}&limit=500`,
    );
    const txns2 = (await txnsRes2.json()) as Array<{ id: string }>;
    expect(txns2.length).toBe(N);

    // No console / page errors anywhere in the walk.
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
