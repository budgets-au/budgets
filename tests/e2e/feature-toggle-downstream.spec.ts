import { test, expect } from "@playwright/test";
import { signInAsAdmin, captureErrors } from "./_helpers";

/** E2E coverage for the Investments/Super feature toggles' downstream
 *  effects (#26).
 *
 *  The monkey crawl confirms the SWITCH state persists in
 *  `display_prefs.featureInvestments` / `featureSuper`, but doesn't
 *  verify the user-visible knock-ons:
 *
 *   1. Navigating to `/investments` while `featureInvestments=false`
 *      redirects to `/dashboard` (gated by `redirect()` at the page
 *      level).
 *   2. The sidebar's "Investments" link is HIDDEN when the flag is
 *      false.
 *   3. Mirror behaviour for `/superannuation` + `featureSuper`.
 *
 *  Spec restores the flags to true in a `finally` block so the rest
 *  of the e2e suite (and the fixture for the next run) sees its
 *  expected defaults. */

test.describe("feature toggle downstream effects (#26)", () => {
  test("featureInvestments=false: redirect + sidebar link gone; restored after", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ctx = page.context();
    const request = ctx.request;
    const { consoleErrors, pageErrors } = captureErrors(page);

    await signInAsAdmin(page);

    try {
      // ── Toggle Investments OFF via the display-prefs PATCH (the
      //    same surface the Settings switch hits via `setPref`).
      const patch = await request.patch("/api/display-prefs", {
        data: { featureInvestments: false, featureSuper: false },
      });
      expect(patch.ok()).toBeTruthy();

      // ── Navigate to /investments — the page-level `redirect()`
      //    should bounce us to /dashboard. Playwright follows
      //    server redirects natively; the resulting URL is what
      //    the user lands on.
      await page.goto("/investments");
      await page.waitForLoadState("networkidle");
      expect(page.url()).toMatch(/\/dashboard$/);

      // Same for /superannuation.
      await page.goto("/superannuation");
      await page.waitForLoadState("networkidle");
      expect(page.url()).toMatch(/\/dashboard$/);

      // ── Sidebar link visibility: scope the search to the
      //    sidebar so a stray "Investments" string elsewhere on
      //    the page doesn't false-positive. The sidebar mounts at
      //    a known role/landmark in the app shell.
      // Use href-prefix locators — the sidebar appends a query
      // string (`?accountIds=...`) so an exact-match href misses.
      // Label-text won't work either since /superannuation renders
      // as "Super" (not "Superannuation").
      const sidebar = page.locator("nav").first();
      await expect(sidebar.locator('a[href^="/investments"]')).toHaveCount(0);
      await expect(sidebar.locator('a[href^="/superannuation"]')).toHaveCount(0);

      // ── Toggle ON: links reappear, pages stop redirecting.
      const patchOn = await request.patch("/api/display-prefs", {
        data: { featureInvestments: true, featureSuper: true },
      });
      expect(patchOn.ok()).toBeTruthy();

      // Reload so the layout picks up the new prefs (display-prefs
      // is fetched server-side at request time for the layout).
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await expect(sidebar.locator('a[href^="/investments"]')).toHaveCount(1);
      await expect(sidebar.locator('a[href^="/superannuation"]')).toHaveCount(1);

      await page.goto("/investments");
      await page.waitForLoadState("networkidle");
      // Now the URL stays on /investments — no redirect.
      expect(page.url()).toMatch(/\/investments(\?|$)/);
    } finally {
      // ── Always restore to defaults so the next spec / next run
      //    starts from a known state.
      await request
        .patch("/api/display-prefs", {
          data: { featureInvestments: true, featureSuper: true },
        })
        .catch(() => {});
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
