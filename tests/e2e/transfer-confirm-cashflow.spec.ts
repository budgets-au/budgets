import { test, expect } from "@playwright/test";
import {
  signInAsAdmin,
  seedAccount,
  seedTransaction,
  captureErrors,
} from "./_helpers";

/** E2E coverage for the transfer-pair confirmation → cashflow flow
 *  (#13). The contract: after two opposing-sign transactions on
 *  different accounts get linked as a transfer pair, BOTH legs
 *  disappear from `/api/reports/cashflow?hideTransfers=true`'s
 *  uncategorised income/expense totals — the user perceives them as
 *  an asset move, not real money in / out.
 *
 *  This spec drives the contract via
 *  `PATCH /api/transactions/[id]/transfer-pair { pairId }`, which
 *  internally calls `manualPair` — the same function that
 *  `POST /api/transfers/suggestions/[id]/confirm` calls after
 *  looking up the suggestion. Confirms the data invariant without
 *  needing to manufacture a transfer-suggestion row first.
 *
 *  Layered control: re-runs the cashflow read with
 *  `hideTransfers=false` to verify both legs DO appear when
 *  unfiltered — proves it's the filter (not the pair itself)
 *  doing the work. */

const RUN_TOKEN = `e2e-confirm-${Date.now().toString(36)}`;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

interface CashflowResponse {
  totals: {
    income: Record<string, number>;
    expenses: Record<string, number>;
    net: Record<string, number>;
  };
}

/** Sum a per-month record (cashflow totals are keyed by `yyyy-MM`). */
function sumMonths(rec: Record<string, number> | undefined): number {
  if (!rec) return 0;
  return Object.values(rec).reduce((a, b) => a + Number(b ?? 0), 0);
}

test.describe("transfer-pair confirmation drops both legs from cashflow (#13)", () => {
  test("hideTransfers excludes paired legs from uncategorised totals", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ctx = page.context();
    const request = ctx.request;
    const { consoleErrors, pageErrors } = captureErrors(page);

    await signInAsAdmin(page);

    // ── Two fresh accounts so the test's totals don't tangle with
    //    seeded sample data on shared accounts.
    const accountA = await seedAccount(ctx, {
      name: `${RUN_TOKEN}-A`,
      type: "checking",
    });
    const accountB = await seedAccount(ctx, {
      name: `${RUN_TOKEN}-B`,
      type: "savings",
    });

    // ── Two opposing-sign txns on the same date, uncategorised,
    //    same magnitude. The matcher would auto-pair them on a
    //    next-batch run, but we'll do it manually so the test
    //    drives the actual contract.
    const date = isoDaysAgo(5);
    const month = date.slice(0, 7); // for the cashflow window
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-31`;
    const txnA = await seedTransaction(ctx, {
      accountId: accountA.id,
      date,
      amount: "-100",
      payee: `${RUN_TOKEN}-out`,
    });
    const txnB = await seedTransaction(ctx, {
      accountId: accountB.id,
      date,
      amount: "100",
      payee: `${RUN_TOKEN}-in`,
    });

    // ── Baseline: BEFORE pairing, both legs should sit in the
    //    uncategorised income / expense totals when
    //    hideTransfers=true is applied. The cashflow report uses
    //    `transfer_pair_id IS NULL` as the uncategorised-transfer
    //    filter; unpaired rows pass that gate and contribute.
    const url = `/api/reports/cashflow?from=${monthStart}&to=${monthEnd}&hideTransfers=true&accountIds=${accountA.id},${accountB.id}`;
    const beforeRes = await request.get(url);
    expect(beforeRes.ok()).toBeTruthy();
    const before = (await beforeRes.json()) as CashflowResponse;

    // Snapshot the totals so we can prove the deltas land where
    // expected. We don't pin absolute values because the seeded
    // dataset on these accounts may carry other rows; the deltas
    // are what we care about.
    const beforeIncome = sumMonths(before.totals.income);
    const beforeExpenses = sumMonths(before.totals.expenses);

    // ── Pair the legs via the manual-link route. (The
    //    suggestion-confirm endpoint internally calls the same
    //    manualPair function; we test the contract once via the
    //    surface that doesn't need a synthesized suggestion row.)
    const pairRes = await request.patch(
      `/api/transactions/${txnA.id}/transfer-pair`,
      { data: { pairId: txnB.id } },
    );
    expect(pairRes.ok()).toBeTruthy();

    // ── After pairing, re-fetch the same cashflow window with
    //    hideTransfers=true. Both legs should now be EXCLUDED from
    //    the uncategorised income / expense buckets.
    const afterRes = await request.get(url);
    expect(afterRes.ok()).toBeTruthy();
    const after = (await afterRes.json()) as CashflowResponse;
    const afterIncome = sumMonths(after.totals.income);
    const afterExpenses = sumMonths(after.totals.expenses);

    // The hardest-edge assertion: each total dropped by the
    // seeded leg's contribution. Income loses the +100 leg
    // (incomeTotalByMonth includes positive raw amounts → delta is
    // +100). Expenses loses the -100 leg (the route's
    // expensesTotalByMonth sums the raw negative SUM(amount), so
    // the bucket goes from −100 → 0; delta is −(−100) = +100).
    // Using the magnitude keeps the assertion robust to the
    // sign convention.
    expect(Math.abs(beforeIncome - afterIncome)).toBeCloseTo(100, 2);
    expect(Math.abs(beforeExpenses - afterExpenses)).toBeCloseTo(100, 2);

    // ── Control: with hideTransfers=false, both legs still
    //    appear. Proves it's the filter, not the pair, that
    //    excluded them above.
    const unfilteredUrl = `/api/reports/cashflow?from=${monthStart}&to=${monthEnd}&hideTransfers=false&accountIds=${accountA.id},${accountB.id}`;
    const unfilteredRes = await request.get(unfilteredUrl);
    expect(unfilteredRes.ok()).toBeTruthy();
    const unfiltered = (await unfilteredRes.json()) as CashflowResponse;
    const unfilteredIncome = sumMonths(unfiltered.totals.income);
    const unfilteredExpenses = sumMonths(unfiltered.totals.expenses);
    // The unfiltered view should match the BEFORE-pair filtered
    // view, since the only difference the pair makes is via the
    // `transfer_pair_id IS NULL` exclusion gate that hideTransfers
    // applies.
    expect(unfilteredIncome).toBeCloseTo(beforeIncome, 2);
    expect(unfilteredExpenses).toBeCloseTo(beforeExpenses, 2);

    // No console / page errors during the walk.
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
