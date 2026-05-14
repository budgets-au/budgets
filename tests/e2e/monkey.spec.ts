import { test, type Page } from "@playwright/test";
import {
  clearFindings,
  isDestructiveLabel,
  isNoiseMessage,
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
