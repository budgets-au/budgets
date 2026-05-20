import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  type AppMap,
  type GoalKey,
  type SuccessfulRun,
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
    overrides: {
      description: `${RUN_TOKEN}-tx`,
      payee: `${RUN_TOKEN}-payee`,
      amount: "42.00",
      date: "2026-01-15",
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
      // The form opens defaulting to kind=schedule. No setup
      // needed; the toggle just needs to NOT be flipped to
      // budget. Defensive: if a kind picker is present, ensure
      // the schedule option is selected.
      const kindSchedule = dialog
        .locator('button:has-text("Schedule"), [role="radio"]:has-text("Schedule")')
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
      // Budget is the "other" kind on the same form. The toggle
      // is labelled "Budget" — flip to it. If the form has no
      // such toggle, the goal can't be completed here.
      const kindBudget = dialog
        .locator('button:has-text("Budget"), [role="radio"]:has-text("Budget")')
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
  });

  test.afterAll(async () => {
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
      let achieved: SuccessfulRun | null = null;
      for (const route of goal.candidateRoutes) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(400);

        const trigger = await findTrigger(page, goal.triggerPatterns);
        if (!trigger) continue;
        const triggerLabel =
          (await trigger.textContent().catch(() => null))?.trim() ?? "(unnamed)";
        await trigger.click().catch(() => {});
        await page.waitForTimeout(500);

        const dialog = page
          .locator('[data-slot="dialog-content"]:visible, [role="dialog"]:visible')
          .first();
        if (!(await dialog.isVisible().catch(() => false))) {
          // Trigger didn't open a dialog — this candidate route
          // doesn't host the goal's form. Move on.
          continue;
        }

        if (goal.setupDialog) {
          const ok = await goal.setupDialog(dialog);
          if (!ok) {
            await dismissDialog(page);
            continue;
          }
        }

        const fillSpec = await fillGoalDialog(dialog, goal.overrides);
        if (Object.keys(fillSpec).length === 0) {
          // Dialog had no fillable inputs — probably not the
          // right form (or it's already in a confirm state).
          await dismissDialog(page);
          continue;
        }

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
          break;
        }

        // Record an unverified outcome as a finding so the
        // operator knows the form fired (or didn't) and what
        // happened.
        await recordFinding({
          page: route,
          action: `goal "${goal.label}" — submit "${submitLabel}"`,
          severity: outcome.kind === "error" ? "error" : "info",
          kind: outcome.kind === "error" ? "issue" : "question",
          message: `Filled ${Object.keys(fillSpec).length} fields, submit fired ${describeOutcome(outcome)}, but neither DOM nor API showed a row matching "${goal.domToken}".`,
        });
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
      } else {
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
        return {
          tag: e.tagName,
          type: "type" in e ? e.type : "",
          name: ("name" in e ? e.name : "") || "",
          id: e.id || "",
          placeholder: "placeholder" in e ? e.placeholder : "",
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
    const key = (meta.name || meta.id || meta.placeholder || "")
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
  const h = dialog.locator('h1, h2, h3, [role="heading"]').first();
  const txt = await h.textContent().catch(() => null);
  return txt?.trim() || undefined;
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
