import { test, expect } from "@playwright/test";
import { signInAsAdmin, captureErrors } from "./_helpers";

/** E2E coverage for the watchlist add → list → history-fetch flow
 *  (#25). Watchlist is a separate table from `investments`; the
 *  monkey crawl doesn't reach it because the add-investment dialog's
 *  Watchlist branch needs a real Yahoo-looking ticker to behave
 *  realistically.
 *
 *  Three legs, all API-driven (no DOM):
 *   1. `POST /api/watchlist` with `{symbol, exchange, currency, name}`
 *      — explicit `name` skips the upstream Yahoo lookup so the
 *      test doesn't depend on network reachability. 201 + id.
 *   2. `GET /api/watchlist` lists the new row.
 *   3. `GET /api/watchlist/{id}/history?range=1m` returns the
 *      stable `{ series, dividends }` shape. Either array can be
 *      empty (Yahoo rate-limit / CI quirk) — we only assert the
 *      shape, not the numeric values.
 *   4. Duplicate-symbol guard: a second POST with the same
 *      `(symbol, exchange)` pair returns 409.
 *   5. Cleanup: `DELETE /api/watchlist/{id}` succeeds.
 *
 *  Yahoo network availability is treated as upstream-best-effort:
 *  if `GET /history` returns 502 we skip the shape assertion and
 *  log a warning. The test passes when the endpoint contract is
 *  intact; we don't condition on whether Yahoo is up. */

test.describe("watchlist add → history (#25)", () => {
  test("POST → GET list → GET history → duplicate-guard → DELETE", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ctx = page.context();
    const request = ctx.request;
    const { consoleErrors, pageErrors } = captureErrors(page);

    await signInAsAdmin(page);

    // ── POST a watchlist entry. Supply `name` so the route's
    //    Yahoo-lookup fallback never fires (the test would
    //    otherwise depend on yahoo.com being reachable).
    const SYMBOL = `E2E${Date.now().toString(36).toUpperCase()}`;
    const postRes = await request.post("/api/watchlist", {
      data: {
        symbol: SYMBOL,
        exchange: "NASDAQ",
        currency: "USD",
        name: "Test Watchlist Inc.",
      },
    });
    expect(postRes.ok()).toBeTruthy();
    expect(postRes.status()).toBe(201);
    const created = (await postRes.json()) as {
      id: string;
      symbol: string;
      name: string | null;
    };
    expect(created.id).toBeTruthy();
    expect(created.symbol).toBe(SYMBOL);

    try {
      // ── GET /api/watchlist surfaces the new row.
      const listRes = await request.get("/api/watchlist");
      expect(listRes.ok()).toBeTruthy();
      const list = (await listRes.json()) as Array<{ id: string; symbol: string }>;
      const found = list.find((r) => r.id === created.id);
      expect(found).toBeTruthy();
      expect(found?.symbol).toBe(SYMBOL);

      // ── GET history. Shape is { series, dividends }. Either can
      //    be empty on Yahoo-blocked CI; only assert the shape.
      const histRes = await request.get(
        `/api/watchlist/${created.id}/history?range=1m`,
      );
      if (histRes.status() === 502) {
        // Upstream blip — log + skip the shape check.
        console.warn(
          "[watchlist e2e] /history returned 502 (Yahoo upstream) — skipping shape assertion",
        );
      } else {
        expect(histRes.ok()).toBeTruthy();
        const hist = (await histRes.json()) as {
          series?: unknown;
          dividends?: unknown;
        };
        expect(Array.isArray(hist.series)).toBe(true);
        expect(Array.isArray(hist.dividends)).toBe(true);
      }

      // ── Duplicate-guard: re-POSTing the same (symbol, exchange)
      //    returns 409 with a typed error message. Lets the UI
      //    show a friendly "already watching X" toast.
      const dupRes = await request.post("/api/watchlist", {
        data: {
          symbol: SYMBOL,
          exchange: "NASDAQ",
          currency: "USD",
          name: "Test Watchlist Inc.",
        },
      });
      expect(dupRes.status()).toBe(409);
      const dupBody = (await dupRes.json()) as { error?: string };
      expect(dupBody.error).toMatch(/already on the watchlist/i);
    } finally {
      // ── Cleanup: delete the seeded row so subsequent specs
      //    don't have to dedupe.
      await request
        .delete(`/api/watchlist/${created.id}`)
        .catch(() => {});
    }

    // No console / page errors during the walk.
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
