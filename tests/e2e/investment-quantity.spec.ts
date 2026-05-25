import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { signInAsAdmin, captureErrors } from "./_helpers";

/** E2E coverage for the add-investment → dashboard-data path (#23).
 *
 *  The monkey crawl POSTs investments but doesn't return to verify
 *  the row's `quantity` is reflected in the data the
 *  `stocks-summary-card` dashboard widget reads. The widget itself
 *  reads from `GET /api/investments` client-side; there's no
 *  `/api/dashboard/stocks-summary` route. This spec pins the API
 *  contract that the widget depends on:
 *
 *   1. POST `/api/investments { kind: "stock", quantity: "12.5", ... }`
 *      → 201 + row.
 *   2. GET `/api/investments` → row present, `quantity = "12.5"`,
 *      `costBasis` reflects `quantity * purchasePrice`,
 *      `currentValue` and `totalReturnAbs` are numbers (Yahoo upstream
 *      blip-tolerant — values may be 0 / null when offline).
 *   3. DELETE for cleanup.
 *
 *  The RSU spec (#24) already covers the vest-schedule flow; this
 *  one specifically pins the plain-stock flow that drives the
 *  `stocks-summary` widget. */

const RUN_TOKEN = randomBytes(3).toString("hex");

interface InvestmentRow {
  id: string;
  kind: string;
  symbol: string;
  quantity: string;
  purchasePrice: string | null;
  costBasis: number;
  currentValue: number;
  totalReturnAbs: number;
}

test.describe("add investment → dashboard data (#23)", () => {
  test("POST stock + GET reflects quantity, costBasis = quantity × purchasePrice", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ctx = page.context();
    const request = ctx.request;
    const { consoleErrors, pageErrors } = captureErrors(page);

    await signInAsAdmin(page);

    const symbol = `STK${RUN_TOKEN.toUpperCase()}`;
    const quantity = "12.5";
    const purchasePrice = "10.00";

    // ── POST a stock holding. Explicit `name` + `purchasePrice` so
    //    the route's Yahoo fallback (which runs when those are
    //    missing) never fires — keeps the spec network-independent.
    const createRes = await request.post("/api/investments", {
      data: {
        kind: "stock",
        symbol,
        exchange: "NASDAQ",
        currency: "USD",
        name: "Test Stock Holding",
        quantity,
        purchaseDate: "2026-01-15",
        purchasePrice,
      },
    });
    expect(createRes.status()).toBe(201);
    const created = (await createRes.json()) as { id: string };

    try {
      // ── GET /api/investments — find our row, assert quantity
      //    reflects.
      const listRes = await request.get("/api/investments");
      expect(listRes.ok()).toBeTruthy();
      const list = (await listRes.json()) as InvestmentRow[];
      const row = list.find((r) => r.id === created.id);
      expect(row).toBeTruthy();
      expect(row!.kind).toBe("stock");
      expect(row!.symbol).toBe(symbol);
      expect(row!.quantity).toBe(quantity);

      // costBasis = quantity × purchasePrice = 12.5 × 10 = 125. The
      // calc layer's `costBasis(row)` does the same multiplication;
      // pinning the rollup value here proves the widget's primary
      // input is computed.
      expect(row!.costBasis).toBeCloseTo(125, 2);

      // currentValue and totalReturnAbs are numbers regardless of
      // Yahoo's upstream state — they're 0 when no price is known.
      // (The widget tolerates the same.)
      expect(typeof row!.currentValue).toBe("number");
      expect(typeof row!.totalReturnAbs).toBe("number");
    } finally {
      // Cleanup.
      await request
        .delete(`/api/investments/${created.id}`)
        .catch(() => {});
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
