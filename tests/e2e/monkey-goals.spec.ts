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
      // The form opens defaulting to kind=schedule. Defensive:
      // if a kind picker is present, click the "Schedule"
      // button by accessible name (the buttons are icon-only
      // with aria-label, so :has-text wouldn't find them).
      const kindSchedule = dialog
        .getByRole("button", { name: "Schedule", exact: true })
        .first();
      if (await kindSchedule.isVisible().catch(() => false)) {
        await kindSchedule.click().catch(() => {});
      }
      return true;
    },
    overrides: {
      description: `${RUN_TOKEN}-sched`,
      payee: `${RUN_TOKEN}-sched-payee`,
      amount: "25.00",
      startdate: "2026-02-01",
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
    overrides: {
      name: `${RUN_TOKEN}-budget`,
      description: `${RUN_TOKEN}-budget`,
      amount: "300.00",
      startdate: "2026-02-01",
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
        await page.waitForLoadState("networkidle");
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

        const dialog = page
          .locator('[data-slot="dialog-content"]:visible, [role="dialog"]:visible')
          .first();
        if (!(await dialog.isVisible().catch(() => false))) {
          // Trigger didn't open a dialog — this candidate route
          // doesn't host the goal's form. Move on.
          continue;
        }
        runCounters.dialogsOpened += 1;

        if (goal.setupDialog) {
          const ok = await goal.setupDialog(dialog);
          if (!ok) {
            await dismissDialog(page);
            continue;
          }
        }

        const fillSpec = await fillGoalDialog(dialog, goal.overrides);
        // Drive every SearchableCombobox-style picker inside the
        // dialog: click the trigger, pick the first listbox item.
        // This is what shipped the createTransaction goal from
        // "submit silently no-op" in 0.196.0 to actually firing
        // a network call — the account + category fields aren't
        // <select> elements and the generic input pass skipped
        // them entirely.
        const pickerCount = await drivePickers(dialog);
        runCounters.buttonClicks += pickerCount;
        if (Object.keys(fillSpec).length === 0 && pickerCount === 0) {
          // Dialog had nothing the crawler could drive — probably
          // not the right form (or it's already in a confirm state).
          await dismissDialog(page);
          continue;
        }
        runCounters.textInputsFilled += Object.keys(fillSpec).length;

        const submit = await findSubmitButton(dialog);
        if (!submit) {
          await dismissDialog(page);
          continue;
        }
        const submitLabel =
          (await submit.textContent().catch(() => null))?.trim() ?? "Submit";

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
  // attributes. The :is() lets one query do the union.
  const triggers = dialog.locator(
    ':is([data-slot="select-trigger"], [role="combobox"]):visible',
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
        await page.keyboard.press("Escape").catch(() => {});
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
    await page.waitForLoadState("networkidle");
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
      .first();
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
 * "dom" / "api" / null. Falsy → goal NOT verified. */
async function verifyOutcome(
  page: Page,
  request: import("@playwright/test").APIRequestContext,
  token: string,
  verifyApi: string,
): Promise<"dom" | "api" | null> {
  // DOM check — give Next a moment to re-render any list that
  // re-fetches via SWR.
  await page.waitForTimeout(800);
  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  if (bodyText.includes(token)) return "dom";

  // API fallback — hits the list endpoint, scans the raw body
  // for the token. Cheap and authoritative.
  try {
    const res = await request.get(verifyApi);
    if (!res.ok()) return null;
    const text = await res.text();
    if (text.includes(token)) return "api";
  } catch {
    /* unreachable / 5xx — treat as not verified */
  }
  return null;
}
