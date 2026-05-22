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

// Issue #83: dates derived from `new Date()` so the spec doesn't flip
// red on real-clock drift (running this on the wrong day used to make
// the panel window slide past the "control" occurrence and the
// assertion silently switched to "0 missed" or "2 missed"). Display
// strings derived from the same format the panel uses
// (`src/lib/utils.ts:formatDate` — `d MMM yyyy`).
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function displayDate(iso: string): string {
  const [yyyy, mm, dd] = iso.split("-");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${parseInt(dd, 10)} ${months[parseInt(mm, 10) - 1]} ${yyyy}`;
}
// startDate -14d, occurrences every 7d:
//   -14d → paired
//   -7d  → control (unpaired)
//   today → inside 4-day grace window, ignored
const SCHEDULE_START = isoDaysAgo(14);
const PAIRED_OCC_DATE = SCHEDULE_START;
const PAIRED_OCC_DISPLAY = displayDate(PAIRED_OCC_DATE);
const UNPAIRED_OCC_DATE = isoDaysAgo(7);
const UNPAIRED_OCC_DISPLAY = displayDate(UNPAIRED_OCC_DATE);

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
    // Issue #87 (0.249.0): POST /api/transactions now returns the
    // source row directly with `transferPairId` populated (was
    // previously a `{ source, dest }` wrapper with the pair id
    // unset because the source object was captured pre-UPDATE).
    // Verify the pair id landed on the source row before we drive
    // the panel; the panel matches the dest via this link.
    const sourceRow = (await txnRes.json()) as {
      id: string;
      transferPairId: string | null;
    };
    expect(sourceRow.id).toBeTruthy();
    expect(sourceRow.transferPairId).toBeTruthy();

    // Navigate to /transactions and wait for the panel's data deps to
    // resolve. Issue #62: replaced `waitForTimeout(800)` with a
    // deterministic wait on the GETs the panel SWR-subscribes to
    // having returned (`/api/scheduled` + the txn page). Without a
    // deterministic signal, busy CI machines hit the 800ms timer
    // before the matcher walk finishes.
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/scheduled") && r.request().method() === "GET",
        { timeout: 10_000 },
      ),
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/transactions") &&
          r.request().method() === "GET",
        { timeout: 10_000 },
      ),
      page.goto("/transactions"),
    ]);

    // Scope all assertions to the panel container — the main
    // /transactions table renders the real paired-date txn as a
    // row, so a body-wide negative-check would always fail.
    const panel = page.getByTestId("missed-scheduled-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Regression assertion: exactly 1 missed transaction in the
    // panel header. Pre-fix would have surfaced 2 (both legs of the
    // paired occurrence flagged) PLUS the unpaired one = 3-ish.
    await expect(
      panel.getByText(/^1 missed scheduled transaction\b/i),
    ).toBeVisible({ timeout: 10_000 });

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
