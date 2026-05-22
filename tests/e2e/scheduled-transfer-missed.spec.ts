import { test, expect } from "@playwright/test";
import { captureErrors, signInAsAdmin } from "./_helpers";

/** Regression guard for the 0.136 fix to scheduled-transfer
 *  false-missed warnings (#17).
 *
 *  Before 0.136, `expandRecurrence(transferDualLeg: true)` and the
 *  per-occurrence category filter in `matchSchedule` would project
 *  both legs of every transfer schedule occurrence — and the
 *  destination leg would then fail the matcher's category filter
 *  (auto-pairing only categorises the source), so even fully-paired
 *  past occurrences surfaced as "missed payment" warnings in the
 *  panel on `/transactions`.
 *
 *  0.136 fixed it by switching the panel + scheduled-list-view to
 *  `transferDualLeg: false` so only the source leg is projected;
 *  the destination's existence is inferred via the source's
 *  `transferPairId`. Pure unit coverage lives at
 *  `src/lib/scheduled-match.transfer.test.ts`; this is the UI walk
 *  that catches a regression at the panel render layer.
 *
 *  Setup:
 *   - Wipe sample-data so the missed-panel count is a clean
 *     reflection of THIS test's setup (the sample-data seed ships
 *     historical schedules whose past occurrences could otherwise
 *     contaminate the count).
 *   - Seed two accounts A (source) + B (destination).
 *   - Create a weekly transfer schedule (A → B, -500) starting 14
 *     days ago. Two past occurrences land in the panel's 30-day
 *     window AND outside the 4-day grace cutoff:
 *       - PAIRED_OCC_DATE = -14d (real paired legs seeded)
 *       - UNPAIRED_OCC_DATE = -7d (no real txn — the control)
 *
 *  Verification:
 *   - Panel header reports exactly "1 missed scheduled transaction"
 *     — only the unpaired occurrence, NOT the paired one (this is
 *     the regression assertion).
 *   - Panel body contains "<formatted unpaired date>" but NOT the
 *     paired-date string.
 *   - Zero console / page errors during the walk.
 *
 *  Placement note: a follow-up could fold this together with #16
 *  (dismiss-missed) into a shared `scheduled-missed-panel.spec.ts`
 *  since both exercise the same panel.
 */

const RUN_TOKEN = `e2e-transfer-${Date.now().toString(36)}`;

// Today (per AGENTS.md the e2e clock follows real time) is 2026-05-22.
// startDate -14d, occurrences every 7d:
//   2026-05-08  (-14d) → paired
//   2026-05-15  (-7d)  → control (unpaired)
//   2026-05-22  (today) → inside 4-day grace window, ignored
const SCHEDULE_START = "2026-05-08";
const PAIRED_OCC_DATE = "2026-05-08";
const PAIRED_OCC_DISPLAY = "8 May 2026";
const UNPAIRED_OCC_DATE = "2026-05-15";
const UNPAIRED_OCC_DISPLAY = "15 May 2026";

test.describe("scheduled-transfer false-missed (#17)", () => {
  test("paired transfer-leg occurrences don't surface in the missed panel; unpaired ones still do", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const request = page.context().request;
    const { consoleErrors, pageErrors } = captureErrors(page);

    await signInAsAdmin(page);

    // Reset to a known starting state. Sample-data ships historical
    // schedules whose missed-occurrences would otherwise be counted
    // alongside ours and break the "exactly 1 missed" assertion.
    // /api/sample-data/remove is admin-gated and covered by the
    // clearSampleData monkey-goal; safe to call here.
    const wipeRes = await request.post("/api/sample-data/remove");
    expect(wipeRes.ok()).toBeTruthy();

    // Two fresh accounts. Names carry the run token so a re-run on
    // a non-wiped DB still finds an unambiguous fixture.
    const accountARes = await request.post("/api/accounts", {
      data: {
        name: `${RUN_TOKEN}-checking`,
        type: "checking",
        color: "#3b82f6",
        currentBalance: "1000.00",
      },
    });
    expect(accountARes.ok()).toBeTruthy();
    const accountA = (await accountARes.json()) as { id: string };

    const accountBRes = await request.post("/api/accounts", {
      data: {
        name: `${RUN_TOKEN}-savings`,
        type: "savings",
        color: "#22c55e",
        currentBalance: "0.00",
      },
    });
    expect(accountBRes.ok()).toBeTruthy();
    const accountB = (await accountBRes.json()) as { id: string };

    // Weekly transfer schedule, A → B, -500. Two past occurrences in
    // the 30-day panel window: -14d (paired) + -7d (control).
    const scheduleRes = await request.post("/api/scheduled", {
      data: {
        kind: "schedule",
        type: "transfer",
        accountId: accountA.id,
        transferToAccountId: accountB.id,
        payee: `${RUN_TOKEN}-rent`,
        amount: "-500.00",
        frequency: "weekly",
        interval: 1,
        startDate: SCHEDULE_START,
      },
    });
    expect(scheduleRes.ok()).toBeTruthy();

    // Seed the PAIRED occurrence. The POST handler creates both legs
    // and cross-links them via `transferPairId` when
    // `transferToAccountId` is set — no manual PATCH needed.
    const txnRes = await request.post("/api/transactions", {
      data: {
        accountId: accountA.id,
        date: PAIRED_OCC_DATE,
        amount: "-500",
        payee: `${RUN_TOKEN}-rent`,
        transferToAccountId: accountB.id,
      },
    });
    expect(txnRes.ok()).toBeTruthy();
    // When `transferToAccountId` is supplied, the POST handler
    // returns `{ source, dest }` and cross-links them via
    // `transferPairId` in a transaction after the inserts. The
    // in-memory `source` object captured before the UPDATE doesn't
    // carry the pair id, so re-read both rows to verify the link
    // landed in the DB (this is the assertion the panel relies on).
    const txnBody = (await txnRes.json()) as {
      source: { id: string };
      dest: { id: string };
    };
    expect(txnBody.source.id).toBeTruthy();
    expect(txnBody.dest.id).toBeTruthy();
    const srcCheck = (await (
      await request.get(`/api/transactions/${txnBody.source.id}`)
    ).json()) as { transferPairId: string | null };
    expect(srcCheck.transferPairId).toBe(txnBody.dest.id);

    // Navigate to /transactions and wait for the panel.
    await page.goto("/transactions");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800); // SWR + panel render + matcher walk

    // Scope all assertions to the panel container — the main
    // /transactions table renders the real paired-date txn (8 May)
    // as a row, so a body-wide negative-check would always fail.
    const panel = page.getByTestId("missed-scheduled-panel");

    // Regression assertion: exactly 1 missed transaction in the
    // panel header. Pre-fix would have surfaced 2 (both legs of the
    // paired occurrence flagged) PLUS the unpaired one = 3-ish.
    await expect(
      panel.getByText(/^1 missed scheduled transaction\b/i),
    ).toBeVisible({ timeout: 5_000 });

    // Expand the panel to inspect the row dates.
    await panel
      .getByText(/^1 missed scheduled transaction\b/i)
      .click();
    await page.waitForTimeout(300);

    // The unpaired date must be in the active list of the panel.
    await expect(panel.getByText(UNPAIRED_OCC_DISPLAY).first()).toBeVisible();

    // The paired date must NOT appear inside the panel. The
    // matcher's job is to recognise the source-leg's real txn as
    // the fulfilment of that occurrence's projection — so the
    // missed-panel must not flag it. We assert against the panel
    // container's text, not page body (the real txn legitimately
    // appears in the main /transactions table).
    const panelText = await panel.innerText();
    expect(panelText).not.toContain(PAIRED_OCC_DISPLAY);

    // No console / page errors during the walk — a runtime React
    // error in the panel (e.g. infinite re-render from a missing
    // useMemo dep) would silently flake an assertion above without
    // failing the test otherwise.
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
