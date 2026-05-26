import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./_helpers";

/** /superannuation snapshot form: invalid year ("42") used to be a
 *  silent no-op — the year input had `min="1990"` so the browser's
 *  native HTML5 validation cancelled submit before the JS handler
 *  ever ran; the JS handler holds the `toast.error("Enter a valid
 *  FY-end year")` that should fire. The 2026-05-26 monkey crawl
 *  picked it up and 0.297.0 fixed it (added `noValidate` to the
 *  form so the JS handler always runs).
 *
 *  This spec pins the contract: an invalid year produces a
 *  user-visible toast and NO `/api/super` POST; a valid year +
 *  balance POSTs successfully and toasts. */

test.describe("/superannuation snapshot form validation", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("invalid year produces a toast and fires no POST", async ({ page }) => {
    test.setTimeout(30_000);

    // Watch for any POST to /api/super (we expect ZERO in this case).
    const postSpy: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/super")) {
        postSpy.push(req.url());
      }
    });

    await page.goto("/superannuation");
    // Per-person panels each expose their own "Add fund/year"
    // button; click the first (default "Me" person on a fresh DB).
    const addBtn = page
      .getByRole("button", { name: /add fund\/year/i })
      .first();
    await addBtn.waitFor({ state: "visible" });
    await addBtn.click();

    const yearInput = page.locator("#super-year");
    const balanceInput = page.locator("#super-balance");
    await yearInput.waitFor({ state: "visible" });

    // Fill an out-of-range year (mirrors the monkey's "42" fill).
    await yearInput.fill("42");
    await balanceInput.fill("100");

    // Click Save — used to be HTML5-rejected silently; should now
    // run the JS handler and toast the error.
    await page.getByRole("button", { name: /^save$/i }).click();

    // Toast surfaces; no POST fired.
    await expect(
      page.locator("[data-sonner-toast]", { hasText: /valid fy-end year/i }),
    ).toBeVisible({ timeout: 3000 });
    expect(postSpy).toEqual([]);
  });

  test("valid year + balance POSTs and toasts success", async ({ page }) => {
    test.setTimeout(30_000);

    const postSpy: string[] = [];
    page.on("request", (req) => {
      if (
        req.method() === "POST" &&
        req.url().includes("/api/super") &&
        !req.url().includes("/api/super/people")
      ) {
        postSpy.push(req.url());
      }
    });

    await page.goto("/superannuation");
    await page.waitForLoadState("networkidle");
    const addBtn = page
      .getByRole("button", { name: /add fund\/year/i })
      .first();
    await addBtn.waitFor({ state: "visible" });
    await expect(addBtn).toBeEnabled();
    await addBtn.click();

    const yearInput = page.locator("#super-year");
    const balanceInput = page.locator("#super-balance");
    await yearInput.waitFor({ state: "visible", timeout: 10_000 });

    // Use a wildly-future-but-still-valid year so this spec
    // doesn't collide with whatever snapshot might already exist
    // for the current FY in a long-lived test DB.
    await yearInput.fill("2199");
    await balanceInput.fill("123456.78");

    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(
      page.locator("[data-sonner-toast]", { hasText: /saved/i }),
    ).toBeVisible({ timeout: 5000 });
    expect(postSpy.length).toBeGreaterThanOrEqual(1);
  });
});
