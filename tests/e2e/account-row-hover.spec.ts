import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { captureErrors, seedAccount, signInAsAdmin } from "./_helpers";

const RUN_TOKEN = randomBytes(3).toString("hex");

/** Regression coverage for the /accounts row hover contract.
 *
 * Runs on the default chromium project AND on the focused
 * firefox-account-row-hover project. The row highlight and the
 * Edit / Reconcile / Hide actions must appear whenever a pointer
 * with hover capability is over the row — Firefox can report the
 * `(hover: hover)` media feature inconsistently (Tailwind v4 gates
 * its hover utilities behind it), so the reveal must not depend on
 * that report.
 *
 * Firefox-specific noise: the next-auth client logs a bare "Error"
 * to the console when the post-login redirect aborts its in-flight
 * session fetch. That fires during sign-in on every Firefox run and
 * predates this spec, so the console assertion tolerates exactly
 * that entry — anything else still fails. */
test("account rows expose actions across hover capability reports", async ({ page }) => {
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

  // Resting opacity is 0 only on hover-capable lg+ viewports. When the
  // browser reports no hover capability the actions must stay visible.
  const canHover = await page.evaluate(() => matchMedia("(any-hover: hover)").matches);
  await expect(actions).toHaveCSS("opacity", canHover ? "0" : "1");

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
