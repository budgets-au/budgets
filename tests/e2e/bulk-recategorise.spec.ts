import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./_helpers";

/** Bulk recategorise on /transactions — multi-select + change category +
 * verify the move propagates everywhere it has to.
 *
 * Smart-monkey doesn't multi-select (the click crawl drives one control
 * at a time), so the bulk flow gets zero coverage from monkey-goals. A
 * regression in the toolbar's category picker, the optimistic SWR cache
 * patch, or the cashflow aggregation could ship silently — this spec
 * is the contract.
 *
 * Verification points:
 *   1. The bulk-toolbar appears with the right count after selection.
 *   2. PATCH /api/transactions/bulk fires with {ids, categoryId} and
 *      returns {updated: N}.
 *   3. GET /api/transactions confirms every seeded row's categoryId
 *      now matches the target.
 *   4. GET /api/reports/cashflow shows the move: the SOURCE category's
 *      monthly bucket decreased by the moved sum; the TARGET category's
 *      bucket increased by the same sum. (This is the "verify
 *      everywhere" leg from the TODO — the cashflow report is the
 *      truth source for downstream widgets like category-spend.) */

const RUN_TOKEN = `bulk-recat-${Date.now().toString(36)}`;
const SEED_COUNT = 5;
const TXN_AMOUNT = "-25.00"; // -$25 each, $125 total moved
const TXN_DATE = "2026-03-15";
const TXN_MONTH = "2026-03";

test.describe("bulk recategorise: /transactions toolbar → cashflow report", () => {
  test("multi-select + change category + verify rows and cashflow report", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInAsAdmin(page);
    const request = page.context().request;

    // 1. Pick two distinct expense categories from the seed: one is the
    // SOURCE (where seeded txns start), one is the TARGET (where bulk
    // moves them). Top-level expense categories only — child cats would
    // need a deeper picker drive that's not the point of THIS test.
    const catsRes = await request.get("/api/categories?type=expense");
    expect(catsRes.ok()).toBeTruthy();
    const allCats = (await catsRes.json()) as Array<{
      id: string;
      name: string;
      parentId: string | null;
    }>;
    const topLevel = allCats.filter((c) => c.parentId === null);
    expect(
      topLevel.length,
      "fixture should have at least 2 top-level expense cats",
    ).toBeGreaterThanOrEqual(2);
    const sourceCat = topLevel[0];
    const targetCat = topLevel[1];

    // 2. Need an account for the seed POST. Grab the first non-archived.
    const accountsRes = await request.get("/api/accounts");
    expect(accountsRes.ok()).toBeTruthy();
    const accounts = (await accountsRes.json()) as Array<{ id: string }>;
    expect(accounts.length).toBeGreaterThan(0);
    const accountId = accounts[0].id;

    // 3. Seed SEED_COUNT transactions in the SOURCE category. Each carries
    // an identifiable per-run token so we can filter the /transactions
    // view to just our rows.
    const seededIds: string[] = [];
    for (let i = 0; i < SEED_COUNT; i++) {
      const res = await request.post("/api/transactions", {
        data: {
          accountId,
          date: TXN_DATE,
          amount: TXN_AMOUNT,
          payee: `${RUN_TOKEN}-${i}`,
          categoryId: sourceCat.id,
        },
      });
      expect(res.ok()).toBeTruthy();
      const row = (await res.json()) as { id: string };
      seededIds.push(row.id);
    }
    expect(seededIds).toHaveLength(SEED_COUNT);

    // 4. Capture the BEFORE state of the cashflow report so the AFTER
    // diff is computable. Window the report tightly to the seed month
    // so totals are deterministic regardless of other fixture activity.
    const beforeReport = await fetchCashflow(request);
    const beforeSourceMar = monthlyTotal(beforeReport, sourceCat.id, TXN_MONTH);
    const beforeTargetMar = monthlyTotal(beforeReport, targetCat.id, TXN_MONTH);

    // 5. Navigate the UI with ?search= so only our seeded rows render.
    // This makes "select all visible" bounded to the SEED_COUNT rows
    // without any per-checkbox click choreography.
    await page.goto(`/transactions?search=${encodeURIComponent(RUN_TOKEN)}`);
    // Wait for the table to render the seeded rows. Each payee appears
    // once; check the count matches the seed.
    for (const id of seededIds) {
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
    // Wait for the first row's payee to appear (proxy for "table
    // hydrated with the filtered set"). The list renders the payee
    // twice — one inline span in the compact row, one detail row
    // below for the description-wrap layout — so `.first()` to
    // dodge strict-mode's "two matches" complaint.
    await expect(page.getByText(`${RUN_TOKEN}-0`).first()).toBeVisible({
      timeout: 10_000,
    });

    // 6. Select all visible rows via the header checkbox.
    await page
      .locator('input[aria-label="Select all visible transactions"]')
      .check();

    // 7. Bulk toolbar should now be visible with the right count.
    await expect(
      page.getByText(`${SEED_COUNT} selected`),
    ).toBeVisible({ timeout: 5_000 });

    // 8. Open the bulk-category combobox. The trigger reads
    // "Choose category…" until a value is set.
    await page.getByText("Choose category…").click();
    // 9. Type the target category name to narrow the list, then click
    // the matching `<li role="option">`.
    await page
      .getByPlaceholder("Search categories…")
      .fill(targetCat.name);
    await page
      .locator('li[role="option"]', { hasText: targetCat.name })
      .first()
      .click();

    // 10. Apply + wait for the PATCH to land. Listen for the response
    // explicitly so the assertion doesn't race the optimistic
    // cache update.
    const [patchRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/transactions/bulk") &&
          r.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "Apply" }).click(),
    ]);
    expect(patchRes.ok()).toBeTruthy();
    const patchBody = (await patchRes.json()) as { updated: number };
    expect(patchBody.updated).toBe(SEED_COUNT);

    // 11. Verify by API: every seeded row's categoryId now matches the
    // target. (Hitting the API rather than scraping the row text
    // gives an exact equality check without locale-formatting
    // brittleness.)
    const afterTxnsRes = await request.get(
      `/api/transactions?search=${encodeURIComponent(RUN_TOKEN)}&limit=100`,
    );
    expect(afterTxnsRes.ok()).toBeTruthy();
    const afterTxns = (await afterTxnsRes.json()) as Array<{
      id: string;
      categoryId: string | null;
    }>;
    const seededAfter = afterTxns.filter((t) => seededIds.includes(t.id));
    expect(seededAfter).toHaveLength(SEED_COUNT);
    for (const t of seededAfter) {
      expect(t.categoryId).toBe(targetCat.id);
    }

    // 12. Verify the cashflow report reflects the move. The expected
    // delta on each side is SEED_COUNT × |TXN_AMOUNT| = $125. The
    // report stores expense amounts as NEGATIVE in `byMonth`, so the
    // source's March bucket should be HIGHER (less negative) by 125
    // and the target's LOWER (more negative) by 125.
    const movedMagnitude = SEED_COUNT * Math.abs(parseFloat(TXN_AMOUNT));
    const afterReport = await fetchCashflow(request);
    const afterSourceMar = monthlyTotal(afterReport, sourceCat.id, TXN_MONTH);
    const afterTargetMar = monthlyTotal(afterReport, targetCat.id, TXN_MONTH);
    expect(afterSourceMar - beforeSourceMar).toBeCloseTo(movedMagnitude, 2);
    expect(beforeTargetMar - afterTargetMar).toBeCloseTo(movedMagnitude, 2);

    // 13. Toolbar should auto-clear after a successful Apply (the
    // handler calls clearSelection()). The toolbar's "N selected"
    // text disappears.
    await expect(page.getByText(`${SEED_COUNT} selected`)).toBeHidden();
  });
});

// ── Helpers ────────────────────────────────────────────────────────────

interface CashflowCategory {
  id: string;
  byMonth: Record<string, number>;
}
interface CashflowReport {
  income: CashflowCategory[];
  expenses: CashflowCategory[];
}

/** Fetch the cashflow report for a 1-month window centred on the seed
 * date. Wider windows would average out our 5-row move against the
 * fixture's noise; tight windows give a deterministic before-vs-after. */
async function fetchCashflow(
  request: import("@playwright/test").APIRequestContext,
): Promise<CashflowReport> {
  const res = await request.get(
    `/api/reports/cashflow?from=${TXN_MONTH}-01&to=${TXN_MONTH}-31`,
  );
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as CashflowReport;
}

/** Pull a category's `byMonth[month]` total from the report. Returns 0
 * if the category isn't in the report (e.g. zero transactions in the
 * window) or the month bucket is empty. */
function monthlyTotal(
  report: CashflowReport,
  categoryId: string,
  month: string,
): number {
  const allCats = [...report.income, ...report.expenses];
  const cat = allCats.find((c) => c.id === categoryId);
  return cat?.byMonth[month] ?? 0;
}
