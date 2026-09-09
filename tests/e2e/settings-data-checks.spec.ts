import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./_helpers";

test("security data checks resolve their loading states", async ({ page }) => {
  await signInAsAdmin(page);

  const [sampleResponse, orphanResponse] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/sample-data/remove"),
    ),
    page.waitForResponse((response) =>
      response.url().endsWith("/api/categories/orphans"),
    ),
    page.goto("/settings?tab=security"),
  ]);

  expect(sampleResponse.ok()).toBeTruthy();
  expect(orphanResponse.ok()).toBeTruthy();
  const samplePanel = page
    .getByRole("heading", { name: "Sample data" })
    .locator("xpath=../../..");
  const orphanPanel = page
    .getByRole("heading", { name: "Unused categories" })
    .locator("xpath=../../..");

  await expect(samplePanel).toContainText(
    /Demo accounts|No sample data|starter dataset has been removed/,
  );
  await expect(orphanPanel).toContainText(/Nothing to clean|no activity/);
  await expect(samplePanel.getByText("Checking…")).toHaveCount(0);
  await expect(orphanPanel.getByText("Checking…")).toHaveCount(0);
});
