import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { captureErrors, seedAccount, signInAsAdmin } from "./_helpers";

const RUN_TOKEN = randomBytes(3).toString("hex");

/** Regression coverage for the /accounts row contract.
 *
 * Runs on the default chromium project AND on the focused
 * firefox-account-row-hover project. Two invariants after 0.351:
 *
 *   1. Edit / Reconcile / Hide actions are ALWAYS visible on
 *      every row (no hover-reveal). This lands the discoverability
 *      call from #104 — hover-revealed actions were invisible to
 *      first-time users and touch viewers.
 *
 *   2. The row background still highlights on hover (kept as an
 *      ungated `.account-row:hover` rule in globals.css so Firefox's
 *      inconsistent `(hover: hover)` report can't drop it).
 *
 * Firefox-specific noise: the next-auth client logs a bare "Error"
 * to the console when the post-login redirect aborts its in-flight
 * session fetch. That fires during sign-in on every Firefox run and
 * predates this spec, so the console assertion tolerates exactly
 * that entry — anything else still fails. */
test("account rows show actions at rest and highlight on hover", async ({ page }) => {
  const { consoleErrors, pageErrors } = captureErrors(page);

  await signInAsAdmin(page);
  const account = await seedAccount(page.context(), {
    name: `${RUN_TOKEN}-hover-account`,
    type: "checking",
  });

  await page.goto("/accounts");

  const row = page.getByRole("group", {
    name: `${account.name} account`,
    exact: true,
  });
  const actions = row.getByRole("group", {
    name: `Actions for ${account.name}`,
    exact: true,
  });

  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Edit account" })).toBeAttached();
  await expect(row.getByRole("button", { name: "Reconcile account" })).toBeAttached();
  await expect(row.getByRole("button", { name: "Hide account" })).toBeAttached();

  // Actions are always visible at rest (0.351 — no hover-reveal).
  // Any viewport, any hover-capability report.
  await expect(actions).toHaveCSS("opacity", "1");

  // Row background must still change on hover — regression coverage
  // for the Firefox `(hover: hover)` bug the ungated CSS rule guards
  // against.
  const restingBackground = await row.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await row.hover();

  await expect(actions).toHaveCSS("opacity", "1");
  await expect
    .poll(() => row.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(restingBackground);

  expect(consoleErrors.filter((message) => message !== "Error")).toEqual([]);
  expect(pageErrors).toEqual([]);
});
