import { test, expect } from "@playwright/test";
import { signInAsAdmin, captureErrors } from "./_helpers";

/** E2E coverage for the RSU vest-schedule flow (#24).
 *
 *  An RSU grant carries a `quantity` (the total shares granted)
 *  and a series of vest events. Each vest specifies a date,
 *  the quantity that vests on that date, and an
 *  `isSatisfied` flag (LTI-style performance gates). The
 *  rolled-up "vestedQuantity" on the parent investment is
 *  computed from satisfied vests whose date is on or before
 *  today.
 *
 *  Contract this spec pins:
 *
 *   1. POST `/api/investments { kind: "rsu", quantity: "100", ... }`
 *      → 201 + row. RSUs without an explicit `purchasePrice`
 *      get defaulted to "0" (so cost basis is meaningful).
 *   2. POST `/api/investments/{id}/vests { vestDate: <past>, quantity: "40", isSatisfied: true }`
 *      → 201 + vest row.
 *   3. POST a second vest in the future with quantity 60.
 *   4. GET `/api/investments` → find the row, assert:
 *        - `vests` array has both vests
 *        - `vestedQuantity` = 40 (the past one only — the
 *          future one hasn't vested yet)
 *   5. DELETE the second vest → 200.
 *   6. GET again → only the first vest remains.
 *   7. Cleanup: DELETE the investment.
 *
 *  Network independence: explicit `name` and `purchasePrice`
 *  on the POST so the route's Yahoo fallback never fires. */

const RUN_TOKEN = Math.random().toString(36).slice(2, 8);

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

interface VestRow {
  id: string;
  vestDate: string;
  quantity: string;
  isSatisfied: boolean;
}

interface InvestmentListRow {
  id: string;
  symbol: string;
  kind: string;
  quantity: string;
  vestedQuantity: number;
  maturationDate: string | null;
}

interface InvestmentDetailRow extends InvestmentListRow {
  vests: VestRow[];
}

test.describe("RSU vest schedule (#24)", () => {
  test("POST RSU + two vests; only past+satisfied counts toward vestedQuantity", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ctx = page.context();
    const request = ctx.request;
    const { consoleErrors, pageErrors } = captureErrors(page);

    await signInAsAdmin(page);

    // ── POST the RSU grant. Explicit name + purchasePrice so
    //    no Yahoo lookup is needed.
    const symbol = `RSU${RUN_TOKEN.toUpperCase()}`;
    const createRes = await request.post("/api/investments", {
      data: {
        kind: "rsu",
        symbol,
        exchange: "NASDAQ",
        currency: "USD",
        name: "Test RSU Grant",
        quantity: "100",
        purchaseDate: isoDaysFromNow(-365),
        purchasePrice: "0",
      },
    });
    expect(createRes.status()).toBe(201);
    const created = (await createRes.json()) as { id: string };
    const investmentId = created.id;

    let pastVestId: string | null = null;
    let futureVestId: string | null = null;

    try {
      // ── Vest 1: 30 days ago, 40 shares, satisfied. Should
      //    contribute to vestedQuantity.
      const pastVestRes = await request.post(
        `/api/investments/${investmentId}/vests`,
        {
          data: {
            vestDate: isoDaysFromNow(-30),
            quantity: "40",
            isSatisfied: true,
          },
        },
      );
      expect(pastVestRes.status()).toBe(201);
      pastVestId = ((await pastVestRes.json()) as VestRow).id;

      // ── Vest 2: 30 days from now, 60 shares, satisfied. Future
      //    date → should NOT contribute to vestedQuantity yet.
      const futureVestRes = await request.post(
        `/api/investments/${investmentId}/vests`,
        {
          data: {
            vestDate: isoDaysFromNow(30),
            quantity: "60",
            isSatisfied: true,
          },
        },
      );
      expect(futureVestRes.status()).toBe(201);
      futureVestId = ((await futureVestRes.json()) as VestRow).id;

      // ── GET the investments list — verifies the rollup fields
      //    (`vestedQuantity`, `maturationDate`). The full `vests`
      //    array lives on the per-id detail endpoint, not the list.
      const listRes = await request.get("/api/investments");
      expect(listRes.ok()).toBeTruthy();
      const list = (await listRes.json()) as InvestmentListRow[];
      const row = list.find((r) => r.id === investmentId);
      expect(row).toBeTruthy();
      expect(row!.kind).toBe("rsu");
      expect(row!.quantity).toBe("100");

      // ── vestedQuantity: only the past vest counts.
      expect(row!.vestedQuantity).toBeCloseTo(40, 6);

      // ── maturationDate is the LATEST vest_date — the future one.
      expect(row!.maturationDate).toBe(isoDaysFromNow(30));

      // ── GET the per-id detail for the full vests array.
      const detailRes = await request.get(`/api/investments/${investmentId}`);
      expect(detailRes.ok()).toBeTruthy();
      const detail = (await detailRes.json()) as InvestmentDetailRow;
      expect(detail.vests.length).toBe(2);
      const vestQuantities = detail.vests
        .map((v) => Number(v.quantity))
        .sort((a, b) => a - b);
      expect(vestQuantities).toEqual([40, 60]);

      // ── DELETE the future vest.
      const delRes = await request.delete(
        `/api/investments/vests/${futureVestId}`,
      );
      expect(delRes.ok()).toBeTruthy();
      futureVestId = null;

      // ── Re-GET detail: only the past vest remains; list
      //    rollup still shows vestedQuantity = 40 but
      //    maturationDate flipped from the future date to the
      //    past one (since that's now the latest).
      const detail2Res = await request.get(`/api/investments/${investmentId}`);
      const detail2 = (await detail2Res.json()) as InvestmentDetailRow;
      expect(detail2.vests.length).toBe(1);
      expect(Number(detail2.vests[0].quantity)).toBeCloseTo(40, 6);

      const list2Res = await request.get("/api/investments");
      const list2 = (await list2Res.json()) as InvestmentListRow[];
      const row2 = list2.find((r) => r.id === investmentId);
      expect(row2).toBeTruthy();
      expect(row2!.vestedQuantity).toBeCloseTo(40, 6);
      expect(row2!.maturationDate).toBe(isoDaysFromNow(-30));
    } finally {
      // ── Cleanup — DELETE any remaining vest, then the
      //    investment. Wrapped so a mid-spec failure still
      //    tidies up.
      if (futureVestId) {
        await request
          .delete(`/api/investments/vests/${futureVestId}`)
          .catch(() => {});
      }
      if (pastVestId) {
        await request
          .delete(`/api/investments/vests/${pastVestId}`)
          .catch(() => {});
      }
      await request
        .delete(`/api/investments/${investmentId}`)
        .catch(() => {});
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
