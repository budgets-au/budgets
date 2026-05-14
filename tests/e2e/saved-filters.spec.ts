import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./_helpers";

/** Scenario tests for the Saved-Filters popover on
 * /transactions. The monkey crawl walks clicks but never fills
 * an input — so a "type a name, hit Save" regression would slip
 * past it. This spec drives the actual save flow. */
test.describe("transactions: saved filters", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/transactions?direction=in");
    await page.waitForLoadState("networkidle");
  });

  test("type a name and click Save persists the preset", async ({ page }) => {
    // Open the popover.
    await page.getByRole("button", { name: /Saved filters/i }).click();
    // Enter naming mode.
    await page.getByRole("button", { name: /Save current/i }).click();
    // Type a name + click Save.
    const input = page.locator('input[placeholder="Name this filter…"]');
    await expect(input).toBeVisible({ timeout: 3_000 });
    await input.fill("Income only");
    await page.getByRole("button", { name: /^Save$/ }).click();
    // The new preset should appear in the popover list.
    await expect(page.getByText("Income only")).toBeVisible({
      timeout: 3_000,
    });
  });

  test("type a name and press Enter persists the preset", async ({ page }) => {
    await page.getByRole("button", { name: /Saved filters/i }).click();
    await page.getByRole("button", { name: /Save current/i }).click();
    const input = page.locator('input[placeholder="Name this filter…"]');
    await expect(input).toBeVisible({ timeout: 3_000 });
    await input.fill("Just enter");
    await input.press("Enter");
    await expect(page.getByText("Just enter")).toBeVisible({
      timeout: 3_000,
    });
  });
});
