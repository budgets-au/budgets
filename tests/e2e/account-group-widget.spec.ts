import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { captureErrors, setDashboardLayout, signInAsAdmin } from "./_helpers";

/** Account group widget (0.365): several accounts combined into one balance.
 *  Credit/loan balances are stored negative, so "savings − debts" is a sum. */
test("account group widget combines balances and honours subtract", async ({ page }) => {
  const { pageErrors } = captureErrors(page);
  await signInAsAdmin(page);
  const run = randomBytes(3).toString("hex");
  const mk = async (name: string, type: string, startingBalance: string) =>
    (await (
      await page.request.post("/api/accounts", { data: { name: `${name} ${run}`, type, color: "#6366f1", startingBalance } })
    ).json()) as { id: string };
  const savings = await mk("Group Savings", "savings", "5000");
  const card = await mk("Group Card", "credit", "-1200.50");

  const title = `Net position ${run}`;
  await setDashboardLayout(page.context(), [
    {
      widgetId: "account-group",
      x: 0,
      y: 0,
      w: 3,
      h: 3,
      config: { title, members: [{ id: savings.id, sign: 1 }, { id: card.id, sign: 1 }] },
    },
  ]);
  await page.goto("/dashboard");
  const widget = page.locator("[data-slot=card]", { hasText: title });
  await expect(widget).toContainText("$3,799.50");
  await expect(widget).toContainText("2 accounts");

  await page.getByRole("button", { name: /Edit dashboard/ }).click();
  await page.getByRole("button", { name: `Subtract Group Card ${run}` }).click();
  await page.getByRole("button", { name: /^Save/ }).click();
  // 5000 − (−1200.50)
  await expect(page.locator("[data-slot=card]", { hasText: title })).toContainText("$6,200.50");

  expect(pageErrors.map((e) => e.message)).toEqual([]);
});
