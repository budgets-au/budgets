import { test, expect, devices, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { captureErrors, seedAccount, seedTransaction, signInAsAdmin } from "./_helpers";

/** Receipt attachments + notes from the collapsed transaction row (0.354–0.362).
 *
 *  Pins the regressions fixed in 0.362: uploads must survive the pointer
 *  leaving the popover while the OS picker is open (the inputs used to live
 *  inside the popover), the first tap on a phone must open it, and the icons
 *  must sit on screen beside the payee on narrow viewports. */

const RUN = randomBytes(3).toString("hex");
// 1×1 PNG — decodable, so the thumbnail path renders.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function seedRow(page: Page, label: string) {
  const account = await seedAccount(page.context(), { name: `Receipts ${label} ${RUN}` });
  const txn = await seedTransaction(page.context(), {
    accountId: account.id,
    date: "2026-03-14",
    amount: "-12.50",
    payee: `Receipt Cafe ${label} ${RUN}`,
  });
  await page.goto(`/transactions?accountId=${account.id}`);
  return { account, txn };
}

const clip = (page: Page) =>
  page.getByRole("button", { name: /Attach a receipt|receipts? — show or add/ }).filter({ visible: true }).first();

test("attach, preview and delete a receipt from the collapsed row", async ({ page }) => {
  const { consoleErrors, pageErrors } = captureErrors(page);
  await signInAsAdmin(page);
  const { txn } = await seedRow(page, "desk");

  await clip(page).hover();
  const pick = page.getByRole("button", { name: "Pick file" });
  await expect(pick).toBeVisible();

  const chooserP = page.waitForEvent("filechooser");
  await pick.click();
  const chooser = await chooserP;
  // Pointer leaves the popover while the picker is "open" — the upload must
  // still go through.
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);
  await chooser.setFiles({ name: "lunch.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Receipt attached")).toBeVisible();
  await expect(page.getByRole("button", { name: "1 receipt — show or add" }).filter({ visible: true })).toBeVisible();

  const list = await page.request.get(`/api/transactions/${txn.id}/attachments`);
  const { attachments } = (await list.json()) as { attachments: Array<{ contentType: string }> };
  expect(attachments.map((a) => a.contentType)).toEqual(["image/png"]);

  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);
  await clip(page).hover();
  await expect(page.locator("img[alt='lunch.png']")).toBeVisible();
  await page.getByRole("button", { name: "Delete lunch.png" }).click({ force: true });
  await page.getByRole("button", { name: /^Delete$/ }).click();
  await expect(page.getByText("Deleted lunch.png")).toBeVisible();
  await expect(page.getByRole("button", { name: "Attach a receipt" }).filter({ visible: true })).toBeVisible();

  expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("add a note from the collapsed row", async ({ page }) => {
  await signInAsAdmin(page);
  const { txn } = await seedRow(page, "note");
  await page.getByRole("button", { name: "Add a note" }).filter({ visible: true }).first().click();
  await page.getByPlaceholder("Add a note about this transaction…").fill("split with Sam");
  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(
    page.getByRole("button", { name: "Edit note: split with Sam" }).filter({ visible: true }),
  ).toBeVisible();
  const res = await page.request.get(`/api/transactions/${txn.id}`);
  expect(((await res.json()) as { notes: string | null }).notes).toBe("split with Sam");
});

// The preset's defaultBrowserType can't be set per-describe; the rest
// (viewport, touch, mobile UA) is what matters here.
const { defaultBrowserType: _browser, ...iPhone } = devices["iPhone 13"];

test.describe("phone viewport", () => {
  test.use(iPhone);

  test("receipt icon is on screen and opens on the first tap", async ({ page }) => {
    await signInAsAdmin(page);
    await seedRow(page, "phone");
    const button = clip(page);
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await button.tap();
    await expect(page.getByRole("button", { name: "Take photo" })).toBeVisible();
  });
});
