import { test, type Locator, type Page } from "@playwright/test";
import {
  clearFindings,
  describeOutcome,
  fillInputSafely,
  findSubmitButton,
  isDestructiveLabel,
  isNoiseMessage,
  observeSubmitOutcome,
  recordFinding,
  type MonkeyFinding,
} from "./_monkey-helpers";
import { signInAsAdmin } from "./_helpers";

/** "1000 monkeys" — exploratory crawl. Visit each top-level page,
 * find every safe interactive element (buttons, switches,
 * checkboxes, selects, radios), poke each one, watch for console /
 * page errors. Persistence checks: every Switch toggled is also
 * verified to survive a page reload.
 *
 * The crawl does NOT fail on findings — its job is to surface them
 * into TODO.md (via globalTeardown). The Golden Book's hard
 * assertions still live in the other specs.
 *
 * Destructive actions (sign out, lock, delete, etc.) are
 * blacklisted by label match so the session survives the crawl.
 *
 * Per-page time budget: ~30 s. Total crawl: ~5 min. */

const CRAWL_PAGES: ReadonlyArray<{ path: string; label: string }> = [
  { path: "/dashboard", label: "Dashboard" },
  { path: "/transactions", label: "Transactions" },
  { path: "/scheduled", label: "Scheduled" },
  { path: "/calendar", label: "Calendar" },
  { path: "/investments", label: "Investments" },
  { path: "/superannuation", label: "Superannuation" },
  { path: "/reports", label: "Reports" },
  { path: "/categories", label: "Categories" },
  { path: "/settings", label: "Settings" },
];

test.describe("1000 monkeys exploratory crawl", () => {
  test.beforeAll(async () => {
    await clearFindings();
  });

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  for (const p of CRAWL_PAGES) {
    test(`monkey: ${p.label}`, async ({ page }) => {
      test.setTimeout(60_000);
      const errors: MonkeyFinding[] = [];

      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (isNoiseMessage(text)) return;
        errors.push({
          page: p.path,
          action: "(console)",
          severity: "error",
          message: text,
        });
      });
      page.on("pageerror", (err) => {
        if (isNoiseMessage(err.message)) return;
        errors.push({
          page: p.path,
          action: "(page error)",
          severity: "error",
          message: err.message,
          detail: err.stack,
        });
      });

      await page.goto(p.path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);

      // Toggle every Switch on the page, then reload and confirm
      // the state survived. Each toggle is also flipped back so
      // the crawl is idempotent.
      const initialSwitchCount = await page
        .locator('[data-slot="switch"]')
        .count()
        .catch(() => 0);
      for (let i = 0; i < initialSwitchCount; i++) {
        // Re-locate inside the loop — switches can be re-mounted
        // after the previous reload, so a stored Locator from an
        // earlier iteration is sometimes attached to a detached
        // DOM node.
        const sw = page.locator('[data-slot="switch"]').nth(i);
        if (!(await sw.isVisible().catch(() => false))) continue;
        const label =
          (await sw.getAttribute("aria-label").catch(() => null)) ??
          `switch #${i}`;
        if (isDestructiveLabel(label)) continue;
        // Skip switches that live inside a form / dialog — they're
        // typically tied to an unsaved form draft, not a persisted
        // pref, so the reload-persistence assertion doesn't apply.
        const inForm = await sw
          .evaluate(
            (el) => !!el.closest('form,[data-slot="dialog-content"]'),
          )
          .catch(() => false);
        if (inForm) continue;
        try {
          const before = await sw
            .getAttribute("aria-checked")
            .catch(() => null);
          await sw.click({ timeout: 2_000 });
          await page.waitForTimeout(200);
          const after = await page
            .locator('[data-slot="switch"]')
            .nth(i)
            .getAttribute("aria-checked")
            .catch(() => null);
          if (before === after || after === null) {
            errors.push({
              page: p.path,
              action: `toggle "${label}"`,
              severity: "warn",
              message: `Switch did not change state after click (was ${before}, still ${after}).`,
            });
            continue;
          }
          // Reload and verify persistence.
          await page.reload();
          await page.waitForLoadState("networkidle");
          await page.waitForTimeout(300);
          const reloaded = page.locator('[data-slot="switch"]').nth(i);
          if (!(await reloaded.isVisible().catch(() => false))) continue;
          const persisted = await reloaded
            .getAttribute("aria-checked")
            .catch(() => null);
          if (persisted !== after) {
            errors.push({
              page: p.path,
              action: `toggle "${label}"`,
              severity: "error",
              message: `Switch did not persist across reload (was ${after}, became ${persisted}).`,
            });
          }
          // Flip back so the next iteration isn't influenced.
          await reloaded.click({ timeout: 2_000 }).catch(() => {});
          await page.waitForTimeout(150);
        } catch (e) {
          errors.push({
            page: p.path,
            action: `toggle "${label}"`,
            severity: "warn",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      // Click each safe button. We don't reload between clicks —
      // many buttons open a modal / nav fragment, the goal is to
      // catch render-time crashes on those affordances.
      await clickSafeButtons(page, p.path, errors);

      // Cycle each <select> through every option.
      await cycleSelects(page, p.path, errors);

      // Fill every form / dialog on the page and submit it.
      // Surfaces silent-no-op submits as questions — the bug class
      // click-only crawling can't see.
      await fillAndSubmitForms(page, p.path, errors);

      for (const f of errors) {
        await recordFinding(f);
      }
    });
  }
});

async function clickSafeButtons(
  page: Page,
  _pagePath: string,
  _errors: MonkeyFinding[],
): Promise<void> {
  // Snapshot the button list — clicking some buttons opens modals
  // that mount more buttons, but we don't want to chase those
  // forever. One pass per page.
  const buttons = page.locator("button:visible").or(
    page.locator('[role="button"]:visible'),
  );
  const count = await buttons.count();
  for (let i = 0; i < Math.min(count, 25); i++) {
    const btn = buttons.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    if (!(await btn.isEnabled().catch(() => false))) continue;
    const label =
      (await btn.getAttribute("aria-label")) ??
      (await btn.textContent())?.trim() ??
      `button #${i}`;
    if (isDestructiveLabel(label)) continue;
    try {
      await btn.click({ timeout: 1500, trial: false });
      await page.waitForTimeout(200);
      // Close any modal/dialog that opened so the next click
      // doesn't fall onto its content.
      await dismissOpenOverlay(page);
    } catch {
      // Element may have detached (clicked a tab that re-renders).
      // Not a fail unless the page itself errored.
    }
  }
}

async function cycleSelects(
  page: Page,
  pagePath: string,
  errors: MonkeyFinding[],
): Promise<void> {
  const selects = page.locator("select:visible");
  const count = await selects.count();
  for (let i = 0; i < count; i++) {
    const sel = selects.nth(i);
    if (!(await sel.isVisible().catch(() => false))) continue;
    if (!(await sel.isEnabled().catch(() => false))) continue;
    const label =
      (await sel.getAttribute("aria-label")) ?? `select #${i}`;
    if (isDestructiveLabel(label)) continue;
    try {
      const options = await sel.locator("option").all();
      const initial = await sel.inputValue();
      for (const opt of options) {
        const value = await opt.getAttribute("value");
        if (value == null) continue;
        await sel.selectOption(value).catch(() => {});
        await page.waitForTimeout(100);
      }
      // Restore initial so the crawl is idempotent.
      await sel.selectOption(initial).catch(() => {});
    } catch (e) {
      errors.push({
        page: pagePath,
        action: `select "${label}"`,
        severity: "warn",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

async function dismissOpenOverlay(page: Page): Promise<void> {
  // Press Escape twice to close stacked dialogs / popovers.
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(80);
  await page.keyboard.press("Escape").catch(() => {});
}

/** Walk every `<form>` and every visible dialog content block on
 * the page, fill its inputs with safe defaults, submit, and
 * record the outcome.
 *
 * Dialogs typically aren't open by default — we rely on the
 * preceding click-safe-buttons phase to have opened (and not
 * yet dismissed) any modal forms whose trigger buttons matched.
 * Standalone `<form>` elements (e.g. the search bar) get the
 * fill+submit treatment regardless.
 *
 * Each form gets a reload between submits so persistence isn't
 * tested implicitly here — that's the switch sweep's job. */
async function fillAndSubmitForms(
  page: Page,
  pagePath: string,
  errors: MonkeyFinding[],
): Promise<void> {
  // Snapshot the form containers as DOM-stable handles. We
  // recompute the count each iteration because submitting one
  // form can re-render the page.
  const FORM_SELECTOR =
    'form, [data-slot="dialog-content"], [role="dialog"]';
  let processed = 0;
  const PROCESSED_CAP = 8; // per-page cap; keeps the time budget honest
  while (processed < PROCESSED_CAP) {
    const containers = page.locator(FORM_SELECTOR);
    const count = await containers.count().catch(() => 0);
    if (processed >= count) break;
    const container = containers.nth(processed);
    processed += 1;
    if (!(await container.isVisible().catch(() => false))) continue;

    const submit = await findSubmitButton(container);
    if (!submit) continue;
    const submitLabel =
      (await submit.textContent().catch(() => null))?.trim() ??
      "(unnamed submit)";

    // Fill every visible input/textarea/select inside the form.
    const filled = await fillContainerInputs(container);
    if (filled === 0) continue; // nothing to drive — skip

    const outcome = await observeSubmitOutcome(page, async () => {
      await submit.click({ timeout: 2_000 }).catch(() => {});
    });

    if (outcome.kind === "silent") {
      errors.push({
        page: pagePath,
        action: `submit "${submitLabel}"`,
        severity: "info",
        kind: "question",
        message: `Filled ${filled} input${filled === 1 ? "" : "s"} and clicked **${submitLabel}** — no network call, toast, or navigation fired. Should it have?`,
      });
    } else if (outcome.kind === "error") {
      errors.push({
        page: pagePath,
        action: `submit "${submitLabel}"`,
        severity: "error",
        kind: "issue",
        message: `Console error during submit: ${outcome.message}`,
      });
    } else if (outcome.kind === "network" && outcome.status >= 500) {
      errors.push({
        page: pagePath,
        action: `submit "${submitLabel}"`,
        severity: "error",
        kind: "issue",
        message: describeOutcome(outcome),
      });
    }
    // Non-error network / toast / nav are healthy — don't record.

    // Reset for the next form. Dismiss any dialog the submit may
    // have opened, then reload to a clean state. Reload is
    // necessary because submitting one form might cause the
    // others on the page to re-render in a different DOM order
    // (or be replaced entirely by a thank-you screen).
    await dismissOpenOverlay(page);
    await page.goto(pagePath).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(200);
  }
}

/** Fill every visible, enabled, non-destructive input/select/
 * textarea inside the given container. Returns the count of
 * inputs the helper actually touched — caller skips the submit
 * if nothing was filled. */
async function fillContainerInputs(container: Locator): Promise<number> {
  const inputs = container.locator(
    "input:visible, textarea:visible, select:visible",
  );
  const count = await inputs.count().catch(() => 0);
  let filled = 0;
  for (let i = 0; i < count; i++) {
    if (await fillInputSafely(inputs.nth(i))) filled += 1;
  }
  return filled;
}
