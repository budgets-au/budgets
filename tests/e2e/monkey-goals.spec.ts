import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  type AppMap,
  type GoalKey,
  type SuccessfulRun,
  appendRun,
  emptyRunCounters,
  loadAppMap,
  recordGoalAttempt,
  saveAppMap,
} from "./_app-map";
import {
  describeOutcome,
  findSubmitButton,
  isDestructiveLabel,
  observeSubmitOutcome,
  recordFinding,
} from "./_monkey-helpers";
import { signInAsAdmin } from "./_helpers";

/** Goal-driven companion to the breadth-first monkey crawl. Each
 * test targets one high-level user task (create a transaction,
 * create a budget, create a schedule) and tries to complete it
 * end-to-end through the UI:
 *
 *   1. Replay phase — if the AppMap has a `successfulRun` recipe
 *      for this goal from a prior crawl, walk through it
 *      verbatim. A working replay means the goal is "locked in"
 *      for this run and we spend zero extra exploration budget.
 *   2. Exploration phase — visit a small list of candidate
 *      routes per goal, hunt for an "Add" / "New" / "Create"
 *      trigger, open the resulting dialog, fill it with
 *      identifiable test data, submit, and verify the outcome.
 *
 * Verification is DOM-first: after submit, the page should show
 * the unique token we filled in (e.g. our description string).
 * If the DOM check fails, we fall back to hitting the matching
 * list API and looking for a row containing the token. The DOM
 * check is what a user would notice; the API check is the
 * truth-source. Disagreements between them are themselves a
 * finding (the row exists but isn't being rendered).
 *
 * The spec is best-effort — a goal we can't complete records a
 * failed attempt (which is signal in itself: the form may have
 * regressed) but does not fail the test. Goals are achieved over
 * time as the expert system fills in. */

let appMap: AppMap;
let runStartedAt = 0;
let runCounters = emptyRunCounters();
const RUN_TOKEN = `monkey-goal-${Date.now().toString(36)}`;

interface GoalDef {
  key: GoalKey;
  label: string;
  /** Routes to try, in order. First success wins. */
  candidateRoutes: string[];
  /** Regex of acceptable trigger-button labels. */
  triggerPatterns: RegExp[];
  /** Optional pre-fill step run inside the open dialog (e.g.
   * setting a kind=budget toggle). Returns true if the setup
   * succeeded — return false to abort this attempt. */
  setupDialog?: (dialog: Locator) => Promise<boolean>;
  /** Per-input value override keyed by input name/id/placeholder
   * (lowercased). Anything not in the map gets a sensible
   * default from the generic filler. */
  overrides: Record<string, string>;
  /** Token expected to appear in the post-submit DOM. */
  domToken: string;
  /** API path used for the fallback verification check. */
  verifyApi: string;
}

const GOALS: GoalDef[] = [
  {
    key: "createTransaction",
    label: "create a transaction",
    candidateRoutes: ["/transactions"],
    triggerPatterns: [/^\s*(add|new)\b.*transaction/i, /^\s*\+\s*$/],
    // Keys match the <Field label="..."> text on the dialog —
    // see add-transaction-dialog.tsx. The token lands in BOTH
    // Payee and Notes so the DOM check (row.payee) or the API
    // check (notes column) can both succeed.
    overrides: {
      date: "2026-01-15",
      payee: `${RUN_TOKEN}-tx`,
      amount: "42.00",
      notes: `${RUN_TOKEN}-tx`,
    },
    domToken: `${RUN_TOKEN}-tx`,
    verifyApi: "/api/transactions?limit=100",
  },
  {
    key: "createSchedule",
    label: "create a schedule",
    candidateRoutes: ["/scheduled"],
    triggerPatterns: [/^\s*(add|new)\b.*(schedule|scheduled)/i, /^\s*\+\s*$/],
    setupDialog: async (dialog) => {
      // Defensive kind toggle — form opens defaulting to
      // schedule, but clicking the "Schedule" button is a no-op
      // when already selected. Belt + braces.
      const kindSchedule = dialog
        .getByRole("button", { name: "Schedule", exact: true })
        .first();
      if (await kindSchedule.isVisible().catch(() => false)) {
        await kindSchedule.click().catch(() => {});
      }
      // Type and Frequency default to "expense" and "monthly"
      // respectively, both of which submit cleanly. drivePickers
      // used to overwrite them to the first <SelectItem> in
      // DOM order ("expense" by chance for Type, "Once" for
      // Frequency) — and `once` happens to trip a server-side
      // path the goal-flow can't satisfy. The fix is in
      // drivePickers (only drive triggers that still show their
      // `data-placeholder`), not here — confirmed manually
      // (user screenshot 2026-05-20): setting Account alone
      // submits successfully.
      return true;
    },
    overrides: {
      payee: `${RUN_TOKEN}-sched`,
      amount: "25.00",
      // Use the label words present on the scheduled form
      // ("Dates *" for the start-date input).
      dates: "2026-02-01",
      // Day-of-month must be 1..31 per the zod schema on
      // /api/scheduled — but the generic number filler defaults
      // to "42", which 500's the route silently (zod throws,
      // Next renders an empty-body error page, no client toast).
      // Found via the smart-monkey crawl 2026-05-20 — recorded as
      // a known-bad combination so it can be turned into a UI
      // guardrail later (clamp the input, or show an inline
      // error on >31 instead of letting the submit fail).
      day: "1",
      // Same family of trap: "Every <N>" (interval). Defaults to
      // 1 in the form's blankScheduledRow but the generic filler
      // would still overwrite it. Cap at a sane value so the
      // recipe replays cleanly.
      every: "1",
    },
    domToken: `${RUN_TOKEN}-sched`,
    verifyApi: "/api/scheduled",
  },
  {
    key: "createBudget",
    label: "create a budget",
    candidateRoutes: ["/scheduled"],
    triggerPatterns: [/^\s*(add|new)\b.*(budget|schedule|scheduled)/i, /^\s*\+\s*$/],
    setupDialog: async (dialog) => {
      // Budget is the "other" kind on the same form. Buttons
      // are icon-only with aria-label="Budget" — getByRole picks
      // up accessible names so it finds the toggle that
      // :has-text("Budget") missed in 0.196.0.
      const kindBudget = dialog
        .getByRole("button", { name: "Budget", exact: true })
        .first();
      if (!(await kindBudget.isVisible().catch(() => false))) return false;
      await kindBudget.click().catch(() => {});
      return true;
    },
    // The scheduled form uses "Payee" as the searchable
    // identifier field for both `kind=schedule` and
    // `kind=budget`. 0.198.0 used `name`/`description` keys
    // which never matched a label, so the token landed nowhere
    // and the verification failed even after the API returned
    // 201 Created.
    overrides: {
      payee: `${RUN_TOKEN}-budget`,
      amount: "300.00",
      dates: "2026-02-01",
    },
    domToken: `${RUN_TOKEN}-budget`,
    verifyApi: "/api/scheduled",
  },
];

test.describe("smart monkey: goal-driven crawl", () => {
  test.beforeAll(async () => {
    appMap = await loadAppMap();
    runStartedAt = Date.now();
    runCounters = emptyRunCounters();
  });

  test.afterAll(async () => {
    appendRun(appMap, {
      ts: new Date().toISOString(),
      durationMs: Date.now() - runStartedAt,
      ...runCounters,
    });
    await saveAppMap(appMap);
  });

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  for (const goal of GOALS) {
    test(`goal: ${goal.label}`, async ({ page }) => {
      test.setTimeout(120_000);
      // Re-use the page's request context — it carries the
      // authenticated NextAuth session cookies set during the
      // beforeEach signInAsAdmin. The fresh `request` fixture
      // doesn't share cookies and would 401 against authed APIs.
      const request = page.context().request;

      // Combinatorial guardrail probes — for createSchedule
      // only, ON TOP OF the regular goal flow. The smart monkey's
      // job isn't just "complete the task"; it's "discover which
      // input combinations the server rejects so we can wire
      // those rejections into UI guardrails before a real user
      // hits them". The user's screenshot 2026-05-20 confirmed a
      // minimum-viable submit (Account only) works, but the
      // bare 500 on `dayOfMonth=42` is a silent failure mode
      // worth pinning. Both the known-good baseline AND the
      // known-bad permutation get logged as findings; the
      // operator can convert these into client-side validation
      // or zod-error toasts on a later release.
      if (
        goal.key === "createSchedule" &&
        !appMap.goals.createSchedule.successfulRun
      ) {
        await runScheduleGuardrailProbes(request, RUN_TOKEN);
      }

      // 1. Replay if we have a recipe.
      const prior = appMap.goals[goal.key].successfulRun;
      if (prior) {
        const replayed = await attemptReplay(page, prior);
        if (replayed.success) {
          const verified = await verifyOutcome(
            page,
            request,
            prior.fillSpec[Object.keys(prior.fillSpec)[0]] ?? goal.domToken,
            goal.verifyApi,
          );
          if (verified) {
            recordGoalAttempt(appMap, goal.key, {
              ...prior,
              timestamp: new Date().toISOString(),
              verified,
            });
            return;
          }
        }
        // Replay drifted from reality; fall through to a fresh
        // exploration so the recipe can be re-learned.
      }

      // 2. Exploration.
      runCounters.goalsAttempted += 1;
      let achieved: SuccessfulRun | null = null;
      for (const route of goal.candidateRoutes) {
        await page.goto(route);
        // `domcontentloaded` instead of `networkidle` — NextAuth's
        // session-fetch retries (especially around the orphan-backfill
        // TDZ error logged on /api/auth/session) can keep the network
        // active indefinitely, so `networkidle` would block until the
        // 30s Playwright default fires + cascade into the 120s
        // test-timeout. `domcontentloaded` settles deterministically
        // once the SPA shell is hydrated; SWR's data fetch runs after
        // that and is what the per-test `waitForTimeout`/explicit
        // queries cover.
        await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(400);

        const trigger = await findTrigger(page, goal.triggerPatterns);
        if (!trigger) continue;
        // Prefer aria-label — the "+" icon-only triggers used on
        // /transactions and /scheduled have no text content, so
        // textContent() returns "" and the recipe ends up
        // unreadable. aria-label always carries the accessible
        // name in those cases.
        const triggerLabel =
          (await trigger.getAttribute("aria-label").catch(() => null)) ||
          (await trigger.textContent().catch(() => null))?.trim() ||
          "(unnamed)";
        await trigger.click().catch(() => {});
        runCounters.buttonClicks += 1;
        await page.waitForTimeout(500);

        // `getByRole("dialog")` is the ARIA-correct entry. BaseUI's
        // DialogPrimitive.Popup sets role="dialog" and our
        // shadcn wrapper adds data-slot="dialog-content" on the
        // same node. `.last()` favours the deepest stack frame
        // when a nested Dialog (e.g. the Replace dialog inside
        // scheduled-edit-form) leaves a wrapper around.
        const dialog = page.getByRole("dialog").last();
        if (!(await dialog.isVisible().catch(() => false))) {
          // Trigger didn't open a dialog — this candidate route
          // doesn't host the goal's form. Move on.
          continue;
        }
        runCounters.dialogsOpened += 1;

        // Step-by-step dialog presence trace — surfaces in the
        // finding when no submit is ultimately found, so we
        // know which operation closed the dialog.
        const trace: Array<{ step: string; dialogs: number }> = [];
        const checkpoint = async (step: string) => {
          const n = await page
            .locator('[data-slot="dialog-content"]:visible')
            .count()
            .catch(() => 0);
          trace.push({ step, dialogs: n });
        };
        await checkpoint("opened");

        if (goal.setupDialog) {
          const ok = await goal.setupDialog(dialog);
          if (!ok) {
            await dismissDialog(page);
            continue;
          }
        }
        await checkpoint("after-setupDialog");

        const fillSpec = await fillGoalDialog(dialog, goal.overrides);
        await checkpoint("after-fill");
        // Drive every picker. First pass selects values; some
        // forms re-render based on those selections (e.g.
        // type="transfer" reveals a "To account" picker). A short
        // wait + second pass picks up the newly-revealed
        // triggers without a full retry of the slow input pass.
        let pickerCount = await drivePickers(dialog);
        await checkpoint("after-pickers-1");
        await page.waitForTimeout(250);
        pickerCount += await drivePickers(dialog);
        await checkpoint("after-pickers-2");
        runCounters.buttonClicks += pickerCount;
        if (Object.keys(fillSpec).length === 0 && pickerCount === 0) {
          // Dialog had nothing the crawler could drive — probably
          // not the right form (or it's already in a confirm state).
          await dismissDialog(page);
          continue;
        }
        runCounters.textInputsFilled += Object.keys(fillSpec).length;

        // The dialog locator can drift between fillGoalDialog and
        // findSubmitButton when the form re-renders (a kind toggle
        // click on /scheduled re-mounts the FieldGroup). Fall back
        // to a page-scoped search for the submit so we don't miss
        // it if `dialog` ended up scoped to a stale wrapper. Prefer
        // findSubmitButton first to keep behaviour stable when
        // dialog scoping works.
        let submit = await findSubmitButton(dialog);
        if (!submit) {
          const visibleSubmit = page
            .locator('button[type="submit"]:visible')
            .last();
          if (await visibleSubmit.isVisible().catch(() => false)) {
            submit = visibleSubmit;
          }
        }
        if (!submit) {
          // True dead-end: dump every button visible on the page
          // PLUS the count of visible dialogs / form elements at
          // this exact moment so the operator can tell whether
          // the dialog vanished out from under us.
          const visibleDialogs = await page
            .locator('[data-slot="dialog-content"]:visible')
            .count()
            .catch(() => 0);
          const visibleForms = await page
            .locator("form:visible")
            .count()
            .catch(() => 0);
          const allButtons = await page
            .locator("button:visible")
            .evaluateAll((els) =>
              els.map((el) => ({
                text: (el.textContent ?? "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 40),
                type: (el as HTMLButtonElement).type,
                disabled: (el as HTMLButtonElement).disabled,
              })),
            )
            .catch(
              () =>
                [] as Array<{
                  text: string;
                  type: string;
                  disabled: boolean;
                }>,
            );
          const summary = allButtons
            .slice(0, 10)
            .map(
              (b) => `"${b.text}"[${b.type}${b.disabled ? "/disabled" : ""}]`,
            )
            .join(", ");
          const traceStr = trace
            .map((t) => `${t.step}=${t.dialogs}`)
            .join(" → ");
          await recordFinding({
            page: route,
            action: `goal "${goal.label}"`,
            severity: "warn",
            kind: "issue",
            message: `Filled ${Object.keys(fillSpec).length} fields + ${pickerCount} pickers but could not find a submit button. State: ${visibleDialogs} dialog(s), ${visibleForms} form(s) visible. Trace: ${traceStr}. Buttons (${allButtons.length}): ${summary || "(none)"}.`,
          });
          runCounters.findingsCount += 1;
          await dismissDialog(page);
          continue;
        }
        const submitLabel =
          (await submit.textContent().catch(() => null))?.trim() ?? "Submit";

        // Submit may be disabled until the form validates — log
        // a finding listing the remaining required fields so we
        // know WHAT to fill on the next iteration. Don't bail —
        // we still click in case the disabled state is stale.
        const submitEnabled = await submit
          .isEnabled()
          .catch(() => true);
        if (!submitEnabled) {
          const validationHints = await scrapeValidationErrors(dialog);
          const labels = await snapshotDialogLabels(dialog);
          await recordFinding({
            page: route,
            action: `goal "${goal.label}" — submit "${submitLabel}" disabled`,
            severity: "warn",
            kind: "issue",
            message:
              `Form submit was disabled after filling ${Object.keys(fillSpec).length} fields + ${pickerCount} pickers. ` +
              (validationHints
                ? `Validation hints: ${validationHints}. `
                : "") +
              `Visible labels: ${labels.slice(0, 12).join(", ")}.`,
          });
          runCounters.findingsCount += 1;
          await dismissDialog(page);
          continue;
        }

        const outcome = await observeSubmitOutcome(page, async () => {
          await submit.click({ timeout: 3_000 }).catch(() => {});
        });
        runCounters.formSubmits += 1;

        const verified = await verifyOutcome(
          page,
          request,
          goal.domToken,
          goal.verifyApi,
        );
        if (verified) {
          achieved = {
            timestamp: new Date().toISOString(),
            route,
            triggerLabel,
            dialogLabel: await dialogHeader(dialog),
            fillSpec,
            submitLabel,
            verified,
          };
          // The form often auto-closes the dialog on a successful
          // submit, but the failure path of dialogHeader (or a
          // form that leaves a confirmation dialog open) can
          // leave the page in a non-clean state. Dismiss anyway —
          // it's idempotent.
          await dismissDialog(page);
          break;
        }

        // Submit produced nothing observable. Scrape the dialog
        // for visible validation messages so the finding tells
        // the operator WHICH required field tripped — far more
        // useful than the bare "no network call fired".
        const validationHints = await scrapeValidationErrors(dialog);
        await recordFinding({
          page: route,
          action: `goal "${goal.label}" — submit "${submitLabel}"`,
          severity: outcome.kind === "error" ? "error" : "info",
          kind: outcome.kind === "error" ? "issue" : "question",
          message: `Filled ${Object.keys(fillSpec).length} fields${pickerCount > 0 ? ` + ${pickerCount} picker${pickerCount === 1 ? "" : "s"}` : ""}, submit fired ${describeOutcome(outcome)}, but neither DOM nor API showed a row matching "${goal.domToken}".${validationHints ? ` Validation hints: ${validationHints}` : ""}`,
        });
        runCounters.findingsCount += 1;
        await dismissDialog(page);
      }

      recordGoalAttempt(appMap, goal.key, achieved);

      if (!achieved) {
        // Soft-fail: log it as a finding rather than failing the
        // suite. The map will retry next run.
        await recordFinding({
          page: goal.candidateRoutes[0],
          action: `goal "${goal.label}"`,
          severity: "warn",
          kind: "issue",
          message: `Could not complete the "${goal.label}" goal across ${goal.candidateRoutes.length} candidate route(s). Smart monkey will retry next run.`,
        });
        runCounters.findingsCount += 1;
      } else {
        runCounters.goalsAchieved += 1;
        // Sanity: assert we picked up a verification signal.
        expect(["dom", "api"]).toContain(achieved.verified);
      }
    });
  }

  /** Compound goal: create 10 transactions all tagged with one
   * category, then verify the **list** + **report total**. Tests
   * the end-to-end accounting flow the previous single-action
   * goals don't exercise — a bug between the POST endpoint and
   * the cashflow aggregation would slip past the three create-*
   * goals because each only writes one row.
   *
   * Verification has three steps and each is recorded as a
   * finding so a partial pass still surfaces useful diagnostics:
   *   - API list: GET /api/transactions returns 10 rows whose
   *     payee contains this run's token.
   *   - DOM list: navigating to /transactions renders rows
   *     containing the token (proves the list query also picks
   *     them up; a SWR cache regression would split this from
   *     the API check).
   *   - Report total: GET /api/reports/cashflow returns a
   *     category entry whose totalCount = 10 and absolute
   *     total = 10 × amount. Off-by-one bugs in the SQL aggregate
   *     (the kind that breaks every dashboard widget at once)
   *     fail HERE before reaching any user.
   *
   * Runs only when at least one expense category + one account
   * already exist (e2e seed-data covers both); otherwise the
   * test logs a skip finding. */
  test("goal: add 10 transactions to a category, verify list + report total", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const request = page.context().request;
    runCounters.goalsAttempted += 1;

    // 1. Resolve a target expense category + account.
    const categoriesRes = await request.get("/api/categories");
    const accountsRes = await request.get("/api/accounts");
    if (!categoriesRes.ok() || !accountsRes.ok()) {
      await recordFinding({
        page: "/transactions",
        action: `goal "addTenToCategory" — setup`,
        severity: "warn",
        kind: "issue",
        message: `Could not load categories (${categoriesRes.status()}) or accounts (${accountsRes.status()}) for setup.`,
      });
      runCounters.findingsCount += 1;
      recordGoalAttempt(appMap, "addTenToCategory", null);
      return;
    }
    const categories = (await categoriesRes.json()) as Array<{
      id: string;
      name: string;
      type: string;
      parentId: string | null;
    }>;
    const accounts = (await accountsRes.json()) as Array<{
      id: string;
      name: string;
    }>;
    const target = categories.find(
      (c) =>
        c.type === "expense" &&
        c.parentId === null &&
        !/uncategorised/i.test(c.name),
    );
    const account = accounts[0];
    if (!target || !account) {
      await recordFinding({
        page: "/transactions",
        action: `goal "addTenToCategory" — setup`,
        severity: "warn",
        kind: "issue",
        message: `Skipping — need at least one named expense category (have ${categories.length}) and one account (have ${accounts.length}).`,
      });
      runCounters.findingsCount += 1;
      recordGoalAttempt(appMap, "addTenToCategory", null);
      return;
    }

    // 2. POST 10 transactions, all on the same date so the
    // monthly cashflow window catches them in one bucket.
    const TXN_AMOUNT = "-25.00";
    const TXN_DATE = "2026-01-15";
    const N = 10;
    const createdIds: string[] = [];
    let postFailures = 0;
    for (let i = 0; i < N; i++) {
      const res = await request.post("/api/transactions", {
        data: {
          accountId: account.id,
          date: TXN_DATE,
          amount: TXN_AMOUNT,
          payee: `${RUN_TOKEN}-bulk-${i}`,
          categoryId: target.id,
        },
      });
      if (res.ok()) {
        const row = (await res.json().catch(() => null)) as
          | { id?: string }
          | null;
        if (row?.id) createdIds.push(row.id);
      } else {
        postFailures += 1;
        if (postFailures === 1) {
          // Record the FIRST failure with body so the operator
          // can see WHY the POST broke — subsequent failures
          // would just spam.
          const body = (await res.text().catch(() => "")).slice(0, 200);
          await recordFinding({
            page: "/transactions",
            action: `goal "addTenToCategory" — POST /api/transactions`,
            severity: "error",
            kind: "issue",
            message: `Iteration ${i} returned ${res.status()}. Body: ${body || "[empty]"}`,
          });
          runCounters.findingsCount += 1;
        }
      }
      runCounters.formSubmits += 1;
    }

    // 3. API list verification.
    const listRes = await request.get("/api/transactions?limit=200");
    const listOk = listRes.ok();
    const listTxns = listOk
      ? ((await listRes.json()) as Array<
          { id: string; payee: string | null; date: string; amount: string; categoryId: string | null; isSample?: boolean }
        >)
      : [];
    // Filter on the `-bulk-` suffix so we count ONLY this goal's
    // rows. RUN_TOKEN alone would also match the createTransaction
    // goal's row (which carries the same run token, different
    // suffix) — that's where the false-positive came from in the
    // 0.201.0 dev cycle (11/10 found).
    const bulkPrefix = `${RUN_TOKEN}-bulk-`;
    const apiMatches = listTxns.filter((t) =>
      (t.payee ?? "").startsWith(bulkPrefix),
    ).length;

    // State-leak diagnostic: if the target category contains MORE
    // Jan-2026 transactions than this run created, something else
    // wrote to it — historically the 20/500 cashflow finding traced
    // to TDZ-errored unlock paths ghost-doubling writes. The 0.213-
    // 0.215 TDZ cleanup retired that, but the check stays as a
    // sentinel: silent in normal runs, screams if the leak ever
    // comes back.
    const bankFeesTxns = listTxns.filter(
      (t) =>
        t.categoryId === target.id &&
        t.date >= "2026-01-01" &&
        t.date <= "2026-01-31",
    );
    if (bankFeesTxns.length !== apiMatches) {
      // eslint-disable-next-line no-console
      console.log(
        `[state-leak] addTenToCategory found ${bankFeesTxns.length} txns in "${target.name}" Jan 2026 — expected ${apiMatches} (this run's POSTs). ${bankFeesTxns.length - apiMatches} pre-existing rows:`,
      );
      for (const t of bankFeesTxns) {
        if ((t.payee ?? "").startsWith(bulkPrefix)) continue;
        // eslint-disable-next-line no-console
        console.log(
          `[state-leak]   ${t.date} ${t.amount.padStart(8)} payee="${t.payee ?? ""}" isSample=${t.isSample ?? "n/a"}`,
        );
      }
    }

    // 4. DOM verification — load /transactions and look for
    // tokens in the rendered table.
    await page.goto("/transactions");
    await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(500);
    runCounters.routesVisited += 1;
    const bodyText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    // Count occurrences of `${RUN_TOKEN}-bulk-` (each token is
    // unique per row).
    const domMatches = (
      bodyText.match(new RegExp(`${RUN_TOKEN}-bulk-`, "g")) ?? []
    ).length;

    // 5. Cashflow report total verification.
    const cashflowRes = await request.get(
      `/api/reports/cashflow?from=2026-01-01&to=2026-01-31&hideTransfers=false`,
    );
    let reportTotalCount: number | null = null;
    let reportTotalAbs: number | null = null;
    let reportCatName: string | null = null;
    if (cashflowRes.ok()) {
      const cashflow = (await cashflowRes.json()) as {
        expenses?: Array<{
          id: string;
          name: string;
          total: number;
          totalCount: number;
        }>;
      };
      const cat = cashflow.expenses?.find((c) => c.id === target.id);
      if (cat) {
        reportTotalCount = cat.totalCount;
        reportTotalAbs = Math.abs(cat.total);
        reportCatName = cat.name;
      }
    }

    const expectedAbsTotal = Math.abs(parseFloat(TXN_AMOUNT)) * N;
    const apiOK = apiMatches === N;
    const domOK = domMatches >= N;
    const reportOK =
      reportTotalCount === N && reportTotalAbs === expectedAbsTotal;

    // 6. Record each verification step as its own finding so a
    // partial-pass run still tells the operator which leg
    // diverged.
    await recordFinding({
      page: "/transactions",
      action: `goal "addTenToCategory" — verify list (API)`,
      severity: apiOK ? "info" : "error",
      kind: apiOK ? "verified" : "issue",
      message: `GET /api/transactions found ${apiMatches}/${N} rows matching "${bulkPrefix}*".`,
    });
    runCounters.findingsCount += 1;
    await recordFinding({
      page: "/transactions",
      action: `goal "addTenToCategory" — verify list (DOM)`,
      severity: domOK ? "info" : "error",
      kind: domOK ? "verified" : "issue",
      message: `DOM on /transactions contained ${domMatches} matches for "${RUN_TOKEN}-bulk-".`,
    });
    runCounters.findingsCount += 1;
    await recordFinding({
      page: "/reports",
      action: `goal "addTenToCategory" — verify category report total`,
      severity: reportOK ? "info" : "error",
      kind: reportOK ? "verified" : "issue",
      message:
        `Cashflow report for category "${reportCatName ?? target.name}" — ` +
        `totalCount=${reportTotalCount ?? "n/a"} (expected ${N}), ` +
        `|total|=${reportTotalAbs ?? "n/a"} (expected ${expectedAbsTotal.toFixed(2)}).`,
    });
    runCounters.findingsCount += 1;

    const allOK = apiOK && domOK && reportOK && postFailures === 0;
    if (allOK) {
      recordGoalAttempt(appMap, "addTenToCategory", {
        timestamp: new Date().toISOString(),
        route: "/transactions",
        triggerLabel: "POST /api/transactions × 10",
        fillSpec: {
          categoryId: target.id,
          accountId: account.id,
          amount: TXN_AMOUNT,
          date: TXN_DATE,
          count: String(N),
        },
        submitLabel: "POST /api/transactions",
        verified: "api",
      });
      runCounters.goalsAchieved += 1;
    } else {
      recordGoalAttempt(appMap, "addTenToCategory", null);
      // The compound test passes regardless — findings are the
      // payload. Sanity-check that at least the POSTs landed,
      // otherwise the seed data is broken and we want a hard
      // failure.
      expect(createdIds.length).toBeGreaterThan(0);
    }
  });

  /** Cross-page goal: create a scheduled transaction, then
   * verify it renders on BOTH `/scheduled` (the list view) AND
   * `/calendar` (the day-cell calendar). The four single-action
   * goals all stop at "row exists in the DB"; this one closes
   * the gap the TODO.md "Scheduled / Calendar" coverage entry
   * called out — the calendar's cashflow-forecast SQL is its
   * own pipeline, distinct from the list query, so a regression
   * in either path would slip past the createSchedule goal.
   *
   * Test data: schedule starts today, monthly frequency, so the
   * calendar's default month view (it doesn't read URL params
   * for the month — defaults to today via internal state) has
   * a guaranteed occurrence to render. Payee carries an
   * identifiable per-run token; the calendar cell shows the
   * payee text directly (cashflow-calendar.tsx:1368-1397), so
   * a body-text search hits cleanly without DOM gymnastics.
   *
   * Three verification legs:
   *   1. `GET /api/scheduled` finds the row by payee.
   *   2. Navigate `/scheduled`, grep body text for token.
   *   3. Navigate `/calendar`, grep body text for token.
   * Each leg gets its own finding so a partial-pass run
   * narrows the regression to one pipeline. */
  test("goal: create scheduled → verify on /scheduled list + /calendar", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const request = page.context().request;
    runCounters.goalsAttempted += 1;

    const accountsRes = await request.get("/api/accounts");
    if (!accountsRes.ok()) {
      await recordFinding({
        page: "/scheduled",
        action: `goal "scheduleOnCalendar" — setup`,
        severity: "warn",
        kind: "issue",
        message: `Could not load accounts (${accountsRes.status()}) for setup.`,
      });
      runCounters.findingsCount += 1;
      recordGoalAttempt(appMap, "scheduleOnCalendar", null);
      return;
    }
    const accounts = (await accountsRes.json()) as Array<{
      id: string;
      name: string;
    }>;
    const account = accounts[0];
    if (!account) {
      await recordFinding({
        page: "/scheduled",
        action: `goal "scheduleOnCalendar" — setup`,
        severity: "warn",
        kind: "issue",
        message: `Skipping — need at least one account (have ${accounts.length}).`,
      });
      runCounters.findingsCount += 1;
      recordGoalAttempt(appMap, "scheduleOnCalendar", null);
      return;
    }

    // Today as ISO. The calendar opens to today's month by
    // default, so a schedule starting today has a guaranteed
    // occurrence in the rendered grid.
    const today = new Date().toISOString().slice(0, 10);
    const TOKEN = `${RUN_TOKEN}-cal-sched`;

    const createRes = await request.post("/api/scheduled", {
      data: {
        kind: "schedule",
        accountId: account.id,
        payee: TOKEN,
        amount: "-50.00",
        type: "expense",
        frequency: "monthly",
        startDate: today,
        interval: 1,
      },
    });
    if (!createRes.ok()) {
      const body = (await createRes.text().catch(() => "")).slice(0, 200);
      await recordFinding({
        page: "/scheduled",
        action: `goal "scheduleOnCalendar" — POST /api/scheduled`,
        severity: "error",
        kind: "issue",
        message: `Returned ${createRes.status()}. Body: ${body || "[empty]"}`,
      });
      runCounters.findingsCount += 1;
      recordGoalAttempt(appMap, "scheduleOnCalendar", null);
      return;
    }
    runCounters.formSubmits += 1;
    const createdRow = (await createRes
      .json()
      .catch(() => null)) as { id?: string } | null;

    // Leg 1: API list. Hits the same endpoint the /scheduled
    // page uses for hydration, so a divergence between this
    // and Leg 2 points at the SWR / list-rendering layer
    // rather than the API.
    const listRes = await request.get("/api/scheduled");
    const apiHit = listRes.ok()
      ? ((await listRes.json()) as Array<{ payee: string | null }>).some(
          (s) => s.payee === TOKEN,
        )
      : false;

    // Leg 2: /scheduled DOM.
    await page.goto("/scheduled");
    await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(500);
    runCounters.routesVisited += 1;
    const scheduledText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    const scheduledHit = scheduledText.includes(TOKEN);

    // Leg 3: /calendar DOM. The calendar fetches cashflow
    // forecast data for the visible month and renders payee
    // text per scheduled occurrence; today's date should have
    // our token rendered in its cell.
    await page.goto("/calendar");
    await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(800);
    runCounters.routesVisited += 1;
    const calendarText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    const calendarHit = calendarText.includes(TOKEN);

    await recordFinding({
      page: "/scheduled",
      action: `goal "scheduleOnCalendar" — verify API list`,
      severity: apiHit ? "info" : "error",
      kind: apiHit ? "verified" : "issue",
      message: `GET /api/scheduled ${apiHit ? "found" : "DID NOT find"} a row with payee "${TOKEN}".`,
    });
    runCounters.findingsCount += 1;
    await recordFinding({
      page: "/scheduled",
      action: `goal "scheduleOnCalendar" — verify /scheduled DOM`,
      severity: scheduledHit ? "info" : "error",
      kind: scheduledHit ? "verified" : "issue",
      message: `DOM on /scheduled ${scheduledHit ? "contained" : "DID NOT contain"} the token "${TOKEN}".`,
    });
    runCounters.findingsCount += 1;
    await recordFinding({
      page: "/calendar",
      action: `goal "scheduleOnCalendar" — verify /calendar DOM`,
      severity: calendarHit ? "info" : "error",
      kind: calendarHit ? "verified" : "issue",
      message: `DOM on /calendar ${calendarHit ? "contained" : "DID NOT contain"} the token "${TOKEN}". Calendar renders payee text per scheduled occurrence (cashflow-calendar.tsx:1368-1397), so a miss here points at either the cashflow forecast SQL (server) or the calendar's SWR query / cell-rendering layer (client).`,
    });
    runCounters.findingsCount += 1;

    const allOK = apiHit && scheduledHit && calendarHit;
    if (allOK) {
      recordGoalAttempt(appMap, "scheduleOnCalendar", {
        timestamp: new Date().toISOString(),
        route: "/calendar",
        triggerLabel: "POST /api/scheduled",
        fillSpec: {
          accountId: account.id,
          payee: TOKEN,
          amount: "-50.00",
          startDate: today,
          frequency: "monthly",
        },
        submitLabel: "POST /api/scheduled",
        verified: "dom",
      });
      runCounters.goalsAchieved += 1;
    } else {
      recordGoalAttempt(appMap, "scheduleOnCalendar", null);
      // Hard sanity: the POST returned 201, so at minimum the
      // row should be findable via the API. If even apiHit is
      // false the seed data + route are broken.
      expect(createdRow?.id).toBeTruthy();
    }
  });

  /** Search a transaction by payee on /transactions.
   *
   * Seeds one transaction via the API with a unique per-run payee
   * token, then drives the UI:
   *   1. Navigate to /transactions?search=<token>
   *   2. Confirm the row's payee text appears in the rendered table
   *   3. Confirm GET /api/transactions?search=<token> returns it
   *
   * Pins the contract that the search box matches the payee column —
   * a regression that broke this would hide transactions from the
   * search results UI even though they're still in the DB. */
  test("goal: search transactions by payee", async ({ page }) => {
    test.setTimeout(60_000);
    const request = page.context().request;
    runCounters.goalsAttempted += 1;

    const accountsRes = await request.get("/api/accounts");
    if (!accountsRes.ok()) {
      await recordFinding({
        page: "/transactions",
        action: `goal "searchTransaction" — setup`,
        severity: "warn",
        kind: "issue",
        message: `Could not load accounts (${accountsRes.status()}).`,
      });
      runCounters.findingsCount += 1;
      recordGoalAttempt(appMap, "searchTransaction", null);
      return;
    }
    const accounts = (await accountsRes.json()) as Array<{ id: string }>;
    const account = accounts[0];
    if (!account) {
      recordGoalAttempt(appMap, "searchTransaction", null);
      return;
    }

    const TOKEN = `${RUN_TOKEN}-search-payee`;
    const postRes = await request.post("/api/transactions", {
      data: {
        accountId: account.id,
        date: "2026-01-20",
        amount: "-11.11",
        payee: TOKEN,
      },
    });
    expect(postRes.ok(), "seed POST should succeed").toBeTruthy();

    // API leg first — cheap + authoritative.
    const apiRes = await request.get(
      `/api/transactions?search=${encodeURIComponent(TOKEN)}&limit=10`,
    );
    const apiHit = apiRes.ok()
      ? ((await apiRes.json()) as Array<{ payee: string | null }>).some(
          (t) => t.payee === TOKEN,
        )
      : false;

    // DOM leg — navigate with ?search= so the table renders filtered.
    await page.goto(`/transactions?search=${encodeURIComponent(TOKEN)}`);
    await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
    runCounters.routesVisited += 1;
    let domHit = false;
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(400);
      const text = await page
        .locator("body")
        .innerText({ timeout: 5_000 })
        .catch(() => "");
      if (text.includes(TOKEN)) {
        domHit = true;
        break;
      }
    }

    await recordFinding({
      page: "/transactions",
      action: `goal "searchTransaction" — verify search filters to payee`,
      severity: apiHit && domHit ? "info" : "error",
      kind: apiHit && domHit ? "verified" : "issue",
      message: `API ${apiHit ? "matched" : "missed"} + DOM ${domHit ? "rendered" : "did not render"} payee "${TOKEN}" with search=${TOKEN}.`,
    });
    runCounters.findingsCount += 1;

    if (apiHit && domHit) {
      recordGoalAttempt(appMap, "searchTransaction", {
        timestamp: new Date().toISOString(),
        route: "/transactions",
        triggerLabel: `?search=${TOKEN}`,
        fillSpec: { payee: TOKEN },
        submitLabel: "GET /api/transactions?search=…",
        verified: "dom",
      });
      runCounters.goalsAchieved += 1;
    } else {
      recordGoalAttempt(appMap, "searchTransaction", null);
    }
  });

  /** Add a transaction with notes via the API, then view it on
   * /transactions and confirm the notes text is visible in the
   * rendered row (or expanded detail).
   *
   * The notes column is the operator's freeform-context field —
   * a regression that stops it being persisted, returned, OR
   * rendered would slip past the silent-monkey crawl (the field is
   * optional, no validation fires, no toast). This goal pins the
   * full round-trip. */
  test("goal: add and view a note on a transaction", async ({ page }) => {
    test.setTimeout(60_000);
    const request = page.context().request;
    runCounters.goalsAttempted += 1;

    const accountsRes = await request.get("/api/accounts");
    if (!accountsRes.ok()) {
      recordGoalAttempt(appMap, "addAndViewNote", null);
      return;
    }
    const accounts = (await accountsRes.json()) as Array<{ id: string }>;
    const account = accounts[0];
    if (!account) {
      recordGoalAttempt(appMap, "addAndViewNote", null);
      return;
    }

    const NOTE_TEXT = `note-from-${RUN_TOKEN}`;
    const PAYEE = `${RUN_TOKEN}-note-row`;
    const postRes = await request.post("/api/transactions", {
      data: {
        accountId: account.id,
        date: "2026-01-21",
        amount: "-22.22",
        payee: PAYEE,
        notes: NOTE_TEXT,
      },
    });
    expect(postRes.ok(), "seed POST should succeed").toBeTruthy();
    const created = (await postRes.json()) as {
      id: string;
      notes?: string | null;
    };
    expect(created.notes, "POST response should echo notes").toBe(NOTE_TEXT);

    // API leg — GET back and confirm notes persisted.
    const apiRes = await request.get(`/api/transactions?limit=100`);
    const apiHit = apiRes.ok()
      ? ((await apiRes.json()) as Array<{ id: string; notes?: string | null }>)
          .some((t) => t.id === created.id && t.notes === NOTE_TEXT)
      : false;

    // Flip the `transactionsShowNotes` display pref ON so the notes
    // text actually renders in the row. Default is OFF — without this
    // PATCH the DOM leg would always miss the note text even though
    // the row is in the table.
    await request.patch("/api/display-prefs", {
      data: { transactionsShowNotes: true },
    });

    // DOM leg — navigate to /transactions filtered to our row and
    // look for the notes text in the rendered body.
    await page.goto(`/transactions?search=${encodeURIComponent(PAYEE)}`);
    await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
    runCounters.routesVisited += 1;
    let domHit = false;
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(400);
      const text = await page
        .locator("body")
        .innerText({ timeout: 5_000 })
        .catch(() => "");
      if (text.includes(NOTE_TEXT)) {
        domHit = true;
        break;
      }
    }

    await recordFinding({
      page: "/transactions",
      action: `goal "addAndViewNote" — note round-trips API + DOM`,
      severity: apiHit && domHit ? "info" : "error",
      kind: apiHit && domHit ? "verified" : "issue",
      message: `API ${apiHit ? "echoed" : "lost"} notes + DOM ${domHit ? "rendered" : "did not render"} "${NOTE_TEXT}".`,
    });
    runCounters.findingsCount += 1;

    if (apiHit && domHit) {
      recordGoalAttempt(appMap, "addAndViewNote", {
        timestamp: new Date().toISOString(),
        route: "/transactions",
        triggerLabel: "POST /api/transactions (with notes)",
        fillSpec: { notes: NOTE_TEXT, payee: PAYEE },
        submitLabel: "GET /api/transactions",
        verified: "dom",
      });
      runCounters.goalsAchieved += 1;
    } else {
      recordGoalAttempt(appMap, "addAndViewNote", null);
    }
  });

  /** Search transactions by notes content.
   *
   * Pins the 0.213.0 backend change that extended the
   * `?search=` filter to match the `notes` column as well as
   * `payee`. Without this test a regression that narrowed the
   * search back to payee-only would silently break "find that
   * thing I wrote a note about" without any user-visible error. */
  test("goal: search transactions by notes content", async ({ page }) => {
    test.setTimeout(60_000);
    const request = page.context().request;
    runCounters.goalsAttempted += 1;

    const accountsRes = await request.get("/api/accounts");
    if (!accountsRes.ok()) {
      recordGoalAttempt(appMap, "searchForNote", null);
      return;
    }
    const accounts = (await accountsRes.json()) as Array<{ id: string }>;
    const account = accounts[0];
    if (!account) {
      recordGoalAttempt(appMap, "searchForNote", null);
      return;
    }

    const NOTE_NEEDLE = `find-me-${RUN_TOKEN}`;
    const PAYEE = `${RUN_TOKEN}-search-note`;
    const postRes = await request.post("/api/transactions", {
      data: {
        accountId: account.id,
        date: "2026-01-22",
        amount: "-33.33",
        payee: PAYEE,
        notes: `arbitrary leading text ${NOTE_NEEDLE} arbitrary trailing text`,
      },
    });
    expect(postRes.ok(), "seed POST should succeed").toBeTruthy();
    const created = (await postRes.json()) as { id: string };

    // API leg — search by the notes-only needle (NOT in payee).
    const apiRes = await request.get(
      `/api/transactions?search=${encodeURIComponent(NOTE_NEEDLE)}&limit=10`,
    );
    const apiHit = apiRes.ok()
      ? ((await apiRes.json()) as Array<{ id: string }>).some(
          (t) => t.id === created.id,
        )
      : false;

    // DOM leg — same search, this time check the rendered list.
    await page.goto(`/transactions?search=${encodeURIComponent(NOTE_NEEDLE)}`);
    await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
    runCounters.routesVisited += 1;
    let domHit = false;
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(400);
      const text = await page
        .locator("body")
        .innerText({ timeout: 5_000 })
        .catch(() => "");
      if (text.includes(PAYEE)) {
        // We render the payee on the row even when the match was
        // on notes — finding payee in the filtered list proves the
        // search box matched on the notes column.
        domHit = true;
        break;
      }
    }

    await recordFinding({
      page: "/transactions",
      action: `goal "searchForNote" — ?search= matches notes column`,
      severity: apiHit && domHit ? "info" : "error",
      kind: apiHit && domHit ? "verified" : "issue",
      message: `API ${apiHit ? "matched" : "missed"} + DOM ${domHit ? "rendered the matching row" : "did not render"} for notes-only needle "${NOTE_NEEDLE}".`,
    });
    runCounters.findingsCount += 1;

    if (apiHit && domHit) {
      recordGoalAttempt(appMap, "searchForNote", {
        timestamp: new Date().toISOString(),
        route: "/transactions",
        triggerLabel: `?search=${NOTE_NEEDLE} (notes-only)`,
        fillSpec: { notes: NOTE_NEEDLE, payee: PAYEE },
        submitLabel: "GET /api/transactions?search=…",
        verified: "dom",
      });
      runCounters.goalsAchieved += 1;
    } else {
      recordGoalAttempt(appMap, "searchForNote", null);
    }
  });

  /** Clear sample data via the Settings → Sample data panel.
   *
   * Pinned as the LAST goal in monkey-goals.spec.ts because the
   * wipe is destructive to the seeded accounts + sample
   * transactions every other test in this spec leans on. By the
   * time it runs, every prior goal has already done its work.
   *
   * Verifies the round-trip:
   *   1. GET /api/sample-data → confirm sample rows exist
   *   2. POST /api/sample-data/remove → expect ok
   *   3. GET /api/sample-data → confirm sampleAccounts /
   *      sampleTransactions / sampleScheduled all zeroed and
   *      `sampleDataSeeded` stays true (so the next unlock
   *      doesn't re-seed). */
  test("goal: clear sample data via Settings", async ({ page }) => {
    test.setTimeout(60_000);
    const request = page.context().request;
    runCounters.goalsAttempted += 1;

    const beforeRes = await request.get("/api/sample-data");
    if (!beforeRes.ok()) {
      await recordFinding({
        page: "/settings",
        action: `goal "clearSampleData" — GET /api/sample-data`,
        severity: "warn",
        kind: "issue",
        message: `GET /api/sample-data → ${beforeRes.status()}`,
      });
      runCounters.findingsCount += 1;
      recordGoalAttempt(appMap, "clearSampleData", null);
      return;
    }
    const before = (await beforeRes.json()) as {
      sampleAccounts: number;
      sampleTransactions: number;
      sampleScheduled: number;
      sampleDataSeeded: boolean;
    };
    // If the fixture had no sample data to begin with (e.g. an
    // already-wiped run), surface a finding so the operator knows
    // why the test was a no-op — but don't fail.
    const haveSampleData =
      before.sampleAccounts > 0 ||
      before.sampleTransactions > 0 ||
      before.sampleScheduled > 0;
    if (!haveSampleData) {
      await recordFinding({
        page: "/settings",
        action: `goal "clearSampleData" — precondition`,
        severity: "info",
        kind: "verified",
        message: `Nothing to wipe (sampleAccounts=${before.sampleAccounts}, sampleTxns=${before.sampleTransactions}, sampleSchedules=${before.sampleScheduled}). Skipping the destructive leg.`,
      });
      runCounters.findingsCount += 1;
      recordGoalAttempt(appMap, "clearSampleData", {
        timestamp: new Date().toISOString(),
        route: "/settings",
        triggerLabel: "GET /api/sample-data (no-op)",
        fillSpec: {},
        submitLabel: "(no wipe needed)",
        verified: "api",
      });
      runCounters.goalsAchieved += 1;
      return;
    }

    // POST the wipe.
    const wipeRes = await request.post("/api/sample-data/remove");
    const wipeOk = wipeRes.ok();
    let wipeSummary: { ok?: boolean; counts?: Record<string, number> } | null =
      null;
    if (wipeOk) {
      wipeSummary = (await wipeRes.json().catch(() => null)) as {
        ok?: boolean;
        counts?: Record<string, number>;
      } | null;
    }

    // GET again to confirm the counts zeroed out.
    const afterRes = await request.get("/api/sample-data");
    const after = afterRes.ok()
      ? ((await afterRes.json()) as {
          sampleAccounts: number;
          sampleTransactions: number;
          sampleScheduled: number;
          sampleDataSeeded: boolean;
        })
      : null;

    const cleared =
      after !== null &&
      after.sampleAccounts === 0 &&
      after.sampleTransactions === 0 &&
      after.sampleScheduled === 0 &&
      after.sampleDataSeeded === true;

    await recordFinding({
      page: "/settings",
      action: `goal "clearSampleData" — wipe round-trip`,
      severity: cleared ? "info" : "error",
      kind: cleared ? "verified" : "issue",
      message:
        `Before: accts=${before.sampleAccounts} txns=${before.sampleTransactions} schedules=${before.sampleScheduled}. ` +
        `Wipe ${wipeOk ? `OK (${JSON.stringify(wipeSummary?.counts ?? {})})` : `FAILED (${wipeRes.status()})`}. ` +
        `After: ${after ? `accts=${after.sampleAccounts} txns=${after.sampleTransactions} schedules=${after.sampleScheduled} seededFlag=${after.sampleDataSeeded}` : "(GET failed)"}.`,
    });
    runCounters.findingsCount += 1;

    if (cleared) {
      recordGoalAttempt(appMap, "clearSampleData", {
        timestamp: new Date().toISOString(),
        route: "/settings",
        triggerLabel: "POST /api/sample-data/remove",
        fillSpec: {},
        submitLabel: "POST /api/sample-data/remove",
        verified: "api",
      });
      runCounters.goalsAchieved += 1;
    } else {
      recordGoalAttempt(appMap, "clearSampleData", null);
    }
  });

  /** Rotate the SQLCipher passphrase via /api/rekey.
   *
   * Pinned last in the spec so a partial failure (e.g. rotation
   * succeeded but the revert leg didn't) doesn't break later
   * specs in the same run — by the time this fires, every other
   * goal has done its work, and the test wraps the revert in a
   * `try/finally` so even an assertion failure still attempts to
   * restore the original key.
   *
   * Verifies four legs:
   *   1. Wrong-current passphrase is rejected (4xx, key unchanged).
   *   2. Too-short next passphrase is rejected (4xx, key unchanged).
   *   3. Valid current + valid next → 200, the existing session
   *      keeps working (PRAGMA rekey rebinds in-place; the JWT
   *      cookie + connection state are untouched).
   *   4. Revert leg: rekey new → original. Required so the env's
   *      `E2E_SQLITE_KEY` still matches the file at the next
   *      next-start boot. */
  test("goal: rekey passphrase round-trip", async ({ page }) => {
    test.setTimeout(60_000);
    const request = page.context().request;
    runCounters.goalsAttempted += 1;

    const ORIGINAL =
      process.env.E2E_SQLITE_KEY ??
      "0000000000000000000000000000000000000000000000000000000000000000";
    const NEW =
      "1111111111111111111111111111111111111111111111111111111111111111";

    // Sanity-prime — confirm the session can read from the DB. If
    // this fails the rest is moot; flag and bail.
    const probe = await request.get("/api/accounts");
    if (!probe.ok()) {
      await recordFinding({
        page: "/settings",
        action: `goal "rekeyPassphrase" — precondition`,
        severity: "warn",
        kind: "issue",
        message: `GET /api/accounts → ${probe.status()} before rekey; session/db not in expected state.`,
      });
      runCounters.findingsCount += 1;
      recordGoalAttempt(appMap, "rekeyPassphrase", null);
      return;
    }

    // Track whether we actually flipped the key — drives the
    // revert in the finally block. If the happy-path rekey is
    // never attempted (e.g. precondition bail-out), revert is a
    // no-op.
    let keyRotated = false;

    try {
      // Leg 1: wrong current passphrase. Rate limiter allows 5
      // attempts / 60s, so one bad attempt fits in our budget.
      const wrongCurrentRes = await request.post("/api/rekey", {
        data: { current: "this-is-not-the-key", next: NEW },
      });
      const wrongCurrentRejected = !wrongCurrentRes.ok();
      await recordFinding({
        page: "/settings",
        action: `goal "rekeyPassphrase" — reject wrong current`,
        severity: wrongCurrentRejected ? "info" : "error",
        kind: wrongCurrentRejected ? "verified" : "issue",
        message: `POST /api/rekey with wrong current → ${wrongCurrentRes.status()} (${wrongCurrentRejected ? "rejected as expected" : "ACCEPTED — guardrail breached"}).`,
      });
      runCounters.findingsCount += 1;

      // Leg 2: too-short next passphrase. Route enforces
      // `next.length >= 8`.
      const tooShortRes = await request.post("/api/rekey", {
        data: { current: ORIGINAL, next: "short" },
      });
      const tooShortRejected = !tooShortRes.ok();
      await recordFinding({
        page: "/settings",
        action: `goal "rekeyPassphrase" — reject too-short next`,
        severity: tooShortRejected ? "info" : "error",
        kind: tooShortRejected ? "verified" : "issue",
        message: `POST /api/rekey with next="short" → ${tooShortRes.status()} (${tooShortRejected ? "rejected as expected" : "ACCEPTED — guardrail breached"}).`,
      });
      runCounters.findingsCount += 1;

      // Leg 3: happy path. Rotate to the new key and confirm the
      // existing session still works (the connection rebinds
      // in-place, no re-unlock needed for the live process).
      const rotateRes = await request.post("/api/rekey", {
        data: { current: ORIGINAL, next: NEW },
      });
      const rotateOk = rotateRes.ok();
      if (rotateOk) keyRotated = true;

      let postRotateReadOk = false;
      if (rotateOk) {
        const postRotateProbe = await request.get("/api/accounts");
        postRotateReadOk = postRotateProbe.ok();
      }
      await recordFinding({
        page: "/settings",
        action: `goal "rekeyPassphrase" — rotate and keep session`,
        severity: rotateOk && postRotateReadOk ? "info" : "error",
        kind: rotateOk && postRotateReadOk ? "verified" : "issue",
        message: `POST /api/rekey → ${rotateRes.status()}; post-rotate GET /api/accounts → ${postRotateReadOk ? "200" : "FAIL"}.`,
      });
      runCounters.findingsCount += 1;

      const allOK = wrongCurrentRejected && tooShortRejected && rotateOk && postRotateReadOk;
      if (allOK) {
        recordGoalAttempt(appMap, "rekeyPassphrase", {
          timestamp: new Date().toISOString(),
          route: "/settings",
          triggerLabel: "POST /api/rekey",
          fillSpec: { current: "(env)", next: "(test-fixture)" },
          submitLabel: "POST /api/rekey",
          verified: "api",
        });
        runCounters.goalsAchieved += 1;
      } else {
        recordGoalAttempt(appMap, "rekeyPassphrase", null);
      }
    } finally {
      // Always attempt the revert if we successfully rotated. A
      // failure here leaves the DB keyed with `NEW` but the env
      // pointing at `ORIGINAL` — global-setup of the NEXT
      // `pnpm test:e2e` invocation wipes test.db so the impact
      // is bounded to nothing important, but logging the failure
      // here makes it obvious in CI logs.
      if (keyRotated) {
        const revertRes = await request.post("/api/rekey", {
          data: { current: NEW, next: ORIGINAL },
        });
        if (!revertRes.ok()) {
          await recordFinding({
            page: "/settings",
            action: `goal "rekeyPassphrase" — revert leg`,
            severity: "error",
            kind: "issue",
            message: `Revert POST /api/rekey ${NEW.slice(0, 4)}…→${ORIGINAL.slice(0, 4)}… returned ${revertRes.status()}. Next next-start boot may fail to unlock.`,
          });
          runCounters.findingsCount += 1;
        }
      }
    }
  });
});

/** Locate an "Add" / "New" / "Create" trigger button on the
 * current page by accessible name. Returns null if no plausible
 * candidate is visible. */
async function findTrigger(
  page: Page,
  patterns: RegExp[],
): Promise<Locator | null> {
  const candidates = page.locator(
    "button:visible, [role='button']:visible, a:visible",
  );
  const count = await candidates.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 50); i++) {
    const c = candidates.nth(i);
    const label =
      (await c.getAttribute("aria-label").catch(() => null)) ??
      (await c.textContent().catch(() => null))?.trim() ??
      "";
    if (!label) continue;
    if (isDestructiveLabel(label)) continue;
    if (patterns.some((p) => p.test(label))) {
      return c;
    }
  }
  return null;
}

/** Fill the dialog's inputs with goal-specific overrides where a
 * field matches; everything else gets a generic safe default.
 * Returns the fillSpec actually applied — used to seed the
 * recipe stored in the AppMap. */
async function fillGoalDialog(
  dialog: Locator,
  overrides: Record<string, string>,
): Promise<Record<string, string>> {
  const fillSpec: Record<string, string> = {};
  const inputs = dialog.locator(
    "input:visible, textarea:visible, select:visible",
  );
  const count = await inputs.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = inputs.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    if (!(await el.isEnabled().catch(() => false))) continue;
    const meta = await el
      .evaluate((node) => {
        const e = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        // Field's accessible label — the user-visible identifier.
        // The transactions/scheduled forms in this app wrap inputs
        // in <label>Foo <input/></label> with NO `name` / `id`
        // attributes, so name-based matching misses every override.
        // `HTMLInputElement.labels` covers both wrapping <label>
        // and explicit `for="id"` — when present we use the first.
        // Otherwise fall back to text nodes of the closest <label>
        // (skipping nested form-control text so the value doesn't
        // pollute the label).
        let labelText = "";
        const labels = (e as HTMLInputElement).labels;
        if (labels && labels.length > 0) {
          labelText = (labels[0].textContent ?? "").trim();
        } else {
          // Field components in this repo render <label><span>Foo</span>
          // <Input/></label>. Walking direct text-node children misses
          // the span; full textContent is fine because <input>'s value
          // doesn't appear in textContent, and <textarea>'s textContent
          // is its initial child text (typically empty for fresh forms).
          const closest = e.closest("label");
          if (closest) {
            labelText = (closest.textContent ?? "").trim();
          }
        }
        return {
          tag: e.tagName,
          type: "type" in e ? e.type : "",
          name: ("name" in e ? e.name : "") || "",
          id: e.id || "",
          placeholder: "placeholder" in e ? e.placeholder : "",
          label: labelText,
          readOnly: "readOnly" in e ? e.readOnly : false,
          disabled: e.disabled,
        };
      })
      .catch(() => null);
    if (!meta) continue;
    if (meta.readOnly || meta.disabled) continue;
    if (meta.type === "hidden" || meta.type === "file" || meta.type === "password") {
      continue;
    }
    // Match the override by the field's user-visible label first
    // (most reliable in this codebase), then fall back to name /
    // id / placeholder for forms that use those.
    const key = (
      meta.label ||
      meta.name ||
      meta.id ||
      meta.placeholder ||
      ""
    )
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    const override = key
      ? Object.entries(overrides).find(([k]) => key.includes(k))?.[1]
      : undefined;
    const value = override ?? defaultForType(meta);
    if (value == null) continue;
    if (meta.tag === "SELECT") {
      // Selects can't accept arbitrary text; pick the second
      // option (the same fallback the generic filler uses).
      const opts = await el.locator("option").count().catch(() => 0);
      if (opts < 2) continue;
      await el.selectOption({ index: 1 }).catch(() => {});
      fillSpec[key || `select#${i}`] = "(2nd option)";
      continue;
    }
    if (meta.type === "checkbox") {
      await el.click().catch(() => {});
      fillSpec[key || `checkbox#${i}`] = "toggled";
      continue;
    }
    await el.fill(value).catch(() => {});
    fillSpec[key || `input#${i}`] = value;
  }
  return fillSpec;
}

function defaultForType(meta: { type: string; tag: string }): string | null {
  if (meta.tag === "TEXTAREA") return "monkey-goal";
  switch (meta.type) {
    case "text":
    case "search":
    case "tel":
    case "url":
      return "monkey-goal";
    case "email":
      return "monkey@goal.local";
    case "number":
      return "42";
    case "date":
      return "2026-01-01";
    case "datetime-local":
      return "2026-01-01T12:00";
    default:
      return null;
  }
}

async function dialogHeader(dialog: Locator): Promise<string | undefined> {
  // Look for either an explicit dialog-title element (shadcn's
  // `[data-slot="dialog-title"]` covers BaseUI / Radix variants)
  // or any heading inside the dialog. Short timeout so a dialog
  // that has neither doesn't stall the goal-driven test by
  // 30s+ of Playwright auto-wait.
  const h = dialog
    .locator(
      '[data-slot="dialog-title"], h1, h2, h3, [role="heading"]',
    )
    .first();
  const txt = await h.textContent({ timeout: 500 }).catch(() => null);
  return txt?.trim() || undefined;
}

/** Drive every SearchableCombobox-style picker visible inside
 * `dialog`. The shared primitive renders as a Popover wrapping a
 * button trigger plus a `<ul role="listbox">` of `<li role="option">`
 * items; the trigger button typically reads "Choose X…" or
 * "Select X…" before any selection is made. For each one we
 * find:
 *   1. click the trigger
 *   2. wait for the popover's listbox to render
 *   3. click the first visible `[role="option"]`
 *
 * Returns the number of pickers actually driven (so the run-report
 * can credit picker activity to button-click counts). Skips
 * triggers whose accessible name looks destructive ("Delete X",
 * "Archive", etc.) — defence in depth, even though no real picker
 * uses those labels today. */
async function drivePickers(dialog: Locator): Promise<number> {
  let driven = 0;
  // Triggers we recognise:
  //   1. SearchableCombobox — bare <button> whose visible text
  //      starts with "Choose…" / "Select…" / "Pick…"
  //      (the `emptyTriggerLabel` convention).
  //   2. Radix/BaseUI Select — `[data-slot="select-trigger"]`
  //      with the SelectValue's placeholder (e.g. "Account",
  //      "Destination").
  //   3. Anything with `role="combobox"` — covers future
  //      primitives that follow ARIA properly.
  // Each opens a popover or listbox portaled OUTSIDE the dialog
  // subtree, so we scope the post-click `[role="option"]` /
  // `[data-slot="select-item"]` search to the page, not the
  // dialog.
  // Narrow the candidate set to actual picker-shaped triggers
  // BEFORE iterating — saves a round-trip-per-button to read
  // attributes. Comma separator (not `:is()`) because Playwright
  // composes locator selectors as a comma-list internally and
  // `:is()` was silently matching nothing for some real triggers
  // in the wild.
  //
  // CRUCIAL: scope to triggers that still carry the
  // `data-placeholder` attribute. BaseUI/shadcn Select sets it
  // when no value is selected (the trigger shows the placeholder
  // text); once the user picks something the attribute drops.
  // This is what stops the goal-driven flow from overwriting
  // sensible defaults (Type=expense, Frequency=monthly on the
  // scheduled form) with the first SelectItem in DOM order —
  // which the e2e proved silently 500's the POST. Without the
  // filter we drive every picker every run, even ones already
  // satisfied; with it, only the truly-unset Account dropdown
  // gets clicked.
  //
  // role="combobox" controls (SearchableCombobox) don't always
  // expose data-placeholder, but they do expose an
  // `aria-expanded` baseline of false — we keep those in the
  // candidate set since false-positive drives on them are
  // benign (the existing trigger-click cycle dismisses any
  // popover that doesn't reveal a real option).
  const triggers = dialog.locator(
    '[data-slot="select-trigger"][data-placeholder]:visible, [role="combobox"]:visible',
  );
  // Also pick up bare-button SearchableCombobox triggers whose
  // visible label starts with "Choose…" / "Select…" / "Pick…".
  // These don't carry a `data-slot` or role.
  const textTriggers = dialog
    .locator("button:visible")
    .filter({ hasText: /^\s*(choose|select|pick)\b/i });

  const baseCount = await triggers.count().catch(() => 0);
  const textCount = await textTriggers.count().catch(() => 0);
  const total = Math.min(baseCount + textCount, 6);

  for (let i = 0; i < total; i++) {
    const t = i < baseCount ? triggers.nth(i) : textTriggers.nth(i - baseCount);
    if (!(await t.isVisible().catch(() => false))) continue;
    const label =
      (await t.getAttribute("aria-label").catch(() => null)) ??
      (await t.textContent().catch(() => null))?.trim() ??
      "";
    if (isDestructiveLabel(label)) continue;
    try {
      await t.click({ timeout: 800 });
      const page = t.page();
      // SelectContent and PopoverContent are both portaled
      // outside the dialog subtree, so we search at page scope.
      const option = page
        .locator(
          '[role="option"]:visible, [data-slot="select-item"]:visible',
        )
        .first();
      if (!(await option.isVisible({ timeout: 800 }).catch(() => false))) {
        // No option appeared — either the trigger wasn't a real
        // picker or its popover loaded too slowly. DO NOT press
        // Escape here — BaseUI Dialogs dismiss on Esc, and an
        // empty popover means Esc goes to the dialog itself,
        // closing the entire form. (This was the Loop 1
        // /scheduled regression — trace went
        // after-fill=1 → after-pickers-1=0 because every
        // trigger that didn't immediately reveal a popover ate
        // its own dialog.) Click the trigger again to
        // toggle-close any stray popover instead. If that
        // throws, the trigger is gone; just move on.
        await t.click({ timeout: 300, force: true }).catch(() => {});
        continue;
      }
      await option.click({ timeout: 800 }).catch(() => {});
      driven += 1;
    } catch {
      /* trigger didn't behave like a picker — skip */
    }
  }
  return driven;
}

/** Look for visible validation-error signals inside `dialog`
 * after a silent submit, and render them into a single short
 * string for the finding message. Picks up:
 *   - `[aria-invalid="true"]` on inputs (browser-native form
 *     validation surfaces this automatically)
 *   - error helper-text containers (shadcn's `[role="alert"]`
 *     inside a form field, or any element with a class
 *     containing "error" / "destructive")
 *   - "required" / "is required" / "must" patterns in visible
 *     text near a field
 *
 * Returns null when nothing was found — caller skips the
 * "Validation hints:" tail in the finding message. */
async function scrapeValidationErrors(
  dialog: Locator,
): Promise<string | null> {
  const hints: string[] = [];

  // `[aria-invalid="true"]` is the cleanest signal — modern
  // forms expose it explicitly.
  const invalidNames = await dialog
    .locator('[aria-invalid="true"]:visible')
    .evaluateAll((els) =>
      els.map((el) => {
        const e = el as HTMLInputElement;
        return e.getAttribute("aria-label") || e.name || e.id || "(unnamed)";
      }),
    )
    .catch(() => [] as string[]);
  for (const name of invalidNames) {
    hints.push(`field "${name}" invalid`);
  }

  // Visible alert blocks. Filter to short, error-shaped text —
  // anything longer than 120 chars is probably help copy.
  const alerts = await dialog
    .locator('[role="alert"]:visible')
    .evaluateAll((els) =>
      els
        .map((el) => (el.textContent ?? "").trim().replace(/\s+/g, " "))
        .filter((t) => t.length > 0 && t.length <= 120),
    )
    .catch(() => [] as string[]);
  for (const t of alerts) hints.push(t);

  // Cap output. More than 3 hints is signal-flood — the operator
  // can read the dialog directly if they need the full list.
  if (hints.length === 0) return null;
  const trimmed = hints.slice(0, 3);
  const extra = hints.length - trimmed.length;
  return trimmed.join("; ") + (extra > 0 ? ` (+${extra} more)` : "");
}

/** Smart-monkey discovery routine: probe `/api/scheduled` with a
 * matrix of known-baseline + known-bad payloads, recording each
 * response as a finding. The output rolls into TODO.md as a
 * GUARDRAIL inventory — combinations the server rejects today but
 * the UI doesn't catch up front. Each entry is one
 * future-improvement TODO (clamp the input, surface a zod
 * message, disable the submit until valid, etc.).
 *
 * Per the user's 2026-05-20 directive ("we should be handling
 * these combinations that fail, that's the purpose of these
 * tests"). Successful probes are cleaned up via DELETE so they
 * don't pollute the user's API check downstream. */
async function runScheduleGuardrailProbes(
  request: import("@playwright/test").APIRequestContext,
  runToken: string,
): Promise<void> {
  const accountsRes = await request.get("/api/accounts").catch(() => null);
  if (!accountsRes || !accountsRes.ok()) return;
  const accounts = (await accountsRes.json().catch(() => [])) as Array<{
    id: string;
  }>;
  const accountId = accounts[0]?.id;
  if (!accountId) return;

  // Each probe carries an EXPECTED outcome. Pre-0.215 the classifier
  // was hard-coded `res.ok() ? "question" : "issue"` — which read
  // every successful baseline POST as a "question" and every correct
  // guardrail rejection as an "issue", surfacing healthy behaviour
  // as red flags in the TODO.md monkey block. Now each probe declares
  // whether the server SHOULD accept (the baseline) or SHOULD reject
  // (the known-bad permutations), and the classifier compares:
  //   - expected match → kind:"verified" (guardrail working as intended)
  //   - expected mismatch → kind:"issue" (real regression target)
  // Baseline is the known-good combination from the user's
  // screenshot: Account + Type=expense + Frequency=monthly.
  const baseline = {
    kind: "schedule" as const,
    accountId,
    payee: `${runToken}-probe`,
    amount: "-25.00",
    type: "expense" as const,
    frequency: "monthly" as const,
    interval: 1,
    startDate: "2026-02-01",
  };
  interface Probe {
    label: string;
    payload: Record<string, unknown>;
    /** true → the API should ACCEPT (2xx); false → should REJECT (4xx). */
    expectAccept: boolean;
  }
  const probes: Probe[] = [
    {
      label: "baseline (Account + defaults)",
      payload: { ...baseline },
      expectAccept: true,
    },
    {
      label: "dayOfMonth=42 (exceeds zod max 31)",
      payload: { ...baseline, dayOfMonth: 42 },
      expectAccept: false,
    },
    {
      label: "type=transfer w/ no transferToAccountId",
      payload: { ...baseline, type: "transfer" },
      expectAccept: false,
    },
    {
      label: "frequency=once w/ no endDate",
      payload: { ...baseline, frequency: "once" },
      // The server currently ACCEPTS this — open question whether a
      // once-frequency schedule with no endDate is semantically
      // valid. Leaving expectAccept=true so a future guardrail that
      // tightens this would surface as an issue (drawing attention)
      // rather than silently changing behaviour.
      expectAccept: true,
    },
    {
      label: "amount with letter (regex violation)",
      payload: { ...baseline, amount: "monkey-goal" },
      expectAccept: false,
    },
  ];

  for (const probe of probes) {
    const res = await request
      .post("/api/scheduled", { data: probe.payload })
      .catch(() => null);
    if (!res) continue;
    const status = res.status();
    const accepted = res.ok();
    let summary: string;
    if (accepted) {
      // Clean up so this probe row doesn't pollute the goal's
      // own DOM/API verification check below.
      const created = (await res.json().catch(() => null)) as {
        id?: string;
      } | null;
      if (created?.id) {
        await request
          .delete(`/api/scheduled/${created.id}`)
          .catch(() => {});
      }
      summary = `→ ${status} ✅ accepted (cleaned up)`;
    } else {
      const body = (await res.text().catch(() => "")).slice(0, 200);
      summary = `→ ${status} ❌ ${body || "[empty body]"}`;
    }
    const expectedMatched = accepted === probe.expectAccept;
    await recordFinding({
      page: "/scheduled",
      action: `guardrail probe: ${probe.label}`,
      severity: expectedMatched ? "info" : "error",
      kind: expectedMatched ? "verified" : "issue",
      message: `${summary} (expected ${probe.expectAccept ? "accept" : "reject"}; got ${accepted ? "accept" : "reject"})`,
    });
  }
}

/** Read the visible label texts on every form control in the
 * dialog. Used in the "submit disabled" finding so the operator
 * can see WHICH fields the form expects without having to open
 * the dialog manually. Caps at the first dozen labels to keep
 * TODO.md readable. */
async function snapshotDialogLabels(dialog: Locator): Promise<string[]> {
  return await dialog
    .locator(
      "label:visible, [data-slot='label']:visible, [data-slot='select-trigger']:visible",
    )
    .evaluateAll((els) =>
      els
        .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((t) => t.length > 0 && t.length <= 60),
    )
    .catch(() => [] as string[]);
}

async function dismissDialog(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(150);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(150);
}

/** Walk a stored recipe: navigate, click the named trigger,
 * apply the saved fillSpec, click the named submit. Returns
 * { success } indicating whether the form went through (we still
 * verify outcome separately). */
async function attemptReplay(
  page: Page,
  recipe: SuccessfulRun,
): Promise<{ success: boolean }> {
  try {
    await page.goto(recipe.route);
    // See the analogous comment in the exploration goto above —
    // `networkidle` can hang on a NextAuth-poll retry loop and bust
    // the test's 120s budget. `domcontentloaded` is enough to know
    // the SPA shell is up; SWR fetches are caught by the post-submit
    // verifyOutcome polling loop.
    await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(400);

    const trigger = page
      .getByRole("button", { name: recipe.triggerLabel })
      .first();
    if (!(await trigger.isVisible().catch(() => false))) {
      return { success: false };
    }
    await trigger.click().catch(() => {});
    await page.waitForTimeout(400);

    const dialog = page
      .locator('[data-slot="dialog-content"]:visible, [role="dialog"]:visible')
      .last();
    if (!(await dialog.isVisible().catch(() => false))) {
      return { success: false };
    }

    // Replay the fillSpec — best-effort match on input
    // name/id/placeholder. Anything we can't find is skipped.
    const inputs = dialog.locator(
      "input:visible, textarea:visible, select:visible",
    );
    const count = await inputs.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const el = inputs.nth(i);
      const meta = await el
        .evaluate((node) => {
          const e = node as HTMLInputElement;
          return {
            name: e.name || "",
            id: e.id || "",
            placeholder: e.placeholder || "",
            tag: e.tagName,
          };
        })
        .catch(() => null);
      if (!meta) continue;
      const key = (meta.name || meta.id || meta.placeholder || "")
        .toLowerCase()
        .replace(/[^a-z]/g, "");
      const value = Object.entries(recipe.fillSpec).find(
        ([k]) => k === key || (key && k.includes(key)),
      )?.[1];
      if (!value) continue;
      if (meta.tag === "SELECT") continue; // 2nd-option index is fine as-is
      await el.fill(value).catch(() => {});
    }

    const submit = dialog
      .getByRole("button", { name: recipe.submitLabel })
      .first();
    if (!(await submit.isVisible().catch(() => false))) {
      return { success: false };
    }
    await submit.click().catch(() => {});
    await page.waitForTimeout(800);
    return { success: true };
  } catch {
    return { success: false };
  }
}

/** Look for `token` in the current page DOM first; if absent,
 * hit `verifyApi` and look for it in the JSON body. Returns
 * "dom" / "api" / null. Falsy → goal NOT verified.
 *
 * Defensive against the prior 120s-timeout failure mode where
 * `body.innerText()` could hang for Playwright's default 30s and
 * a stuck `request.get()` could hang another 30s — stacked across
 * the replay path + the exploration fall-through, that easily
 * blew past the test's 120s budget. Now:
 *   - DOM check polls 5× with a 5s innerText cap each, breaking
 *     the moment the token appears (typical: first poll catches
 *     it once SWR's revalidation lands).
 *   - API check uses an explicit 8s timeout. */
async function verifyOutcome(
  page: Page,
  request: import("@playwright/test").APIRequestContext,
  token: string,
  verifyApi: string,
): Promise<"dom" | "api" | null> {
  // DOM check — give Next a moment to re-render any list that
  // re-fetches via SWR. Poll rather than single-shot so we don't
  // race the SWR mutate→revalidate cycle.
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.waitForTimeout(400);
    const bodyText = await page
      .locator("body")
      .innerText({ timeout: 5_000 })
      .catch(() => "");
    if (bodyText.includes(token)) return "dom";
  }

  // API fallback — hits the list endpoint, scans the raw body
  // for the token. Cheap and authoritative. Explicit timeout so a
  // hung server can't drain the test's wall-clock budget.
  try {
    const res = await request.get(verifyApi, { timeout: 8_000 });
    if (!res.ok()) return null;
    const text = await res.text();
    if (text.includes(token)) return "api";
  } catch {
    /* unreachable / 5xx / timeout — treat as not verified */
  }
  return null;
}
