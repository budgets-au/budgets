/**
 * Round-trip regression test for /api/display-prefs PATCH → GET.
 *
 * Targets the bug class the user reported as "hidden categories on
 * the cashflow report aren't being saved". The flow is:
 *   1. GET → seeded blob (dynamic default with internal-transfer
 *      cat IDs in `cashflowExcludedCatIds`).
 *   2. PATCH with a user-extended hide list.
 *   3. GET → must return the patched value, not the dynamic default.
 *
 * Any regression in the upsert/merge/parser would surface here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { categories } from "@/db/schema";
import {
  createTestDb,
  installTestDb,
  type TestDb,
} from "./_helpers/test-db";
import { testAuth } from "./_helpers/auth-mock";

vi.mock("@/lib/auth", () => ({ auth: testAuth }));

type Resp = { cashflowExcludedCatIds: string[] };

describe("golden / display-prefs round-trip", () => {
  let db: TestDb;
  let prefsGET: () => Promise<Response>;
  let prefsPATCH: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    db = createTestDb();
    installTestDb(db);
    // Seed three categories, one of which is an internal transfer.
    db.drizzleDb
      .insert(categories)
      .values([
        { id: "cat-groceries", name: "Groceries", type: "expense", transferKind: "none" },
        { id: "cat-rent", name: "Rent", type: "expense", transferKind: "none" },
        {
          id: "cat-xfer",
          name: "Internal Transfer",
          type: "expense",
          transferKind: "internal",
        },
      ])
      .run();
    const mod = await import("@/app/api/display-prefs/route");
    prefsGET = mod.GET as unknown as () => Promise<Response>;
    prefsPATCH = mod.PATCH as unknown as (req: Request) => Promise<Response>;
  });
  afterAll(() => {
    db.close();
  });

  it("GET on a fresh DB returns transfer cats as default-hidden", async () => {
    const res = await prefsGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Resp;
    expect(body.cashflowExcludedCatIds).toContain("cat-xfer");
    expect(body.cashflowExcludedCatIds).not.toContain("cat-groceries");
  });

  it("PATCH then GET preserves a user-extended hide list", async () => {
    const patch = await prefsPATCH(
      new Request("http://test/api/display-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cashflowExcludedCatIds: ["cat-xfer", "cat-groceries"],
        }),
      }),
    );
    expect(patch.status).toBe(200);
    const patchBody = (await patch.json()) as Resp;
    expect(patchBody.cashflowExcludedCatIds.sort()).toEqual([
      "cat-groceries",
      "cat-xfer",
    ]);

    // Subsequent GET must return the persisted list, not the
    // dynamic default.
    const get = await prefsGET();
    expect(get.status).toBe(200);
    const body = (await get.json()) as Resp;
    expect(body.cashflowExcludedCatIds.sort()).toEqual([
      "cat-groceries",
      "cat-xfer",
    ]);
  });

  it("PATCH with an empty array genuinely clears all hides", async () => {
    // Operator unhides everything via the eye-back-on flow. The
    // empty array must survive — it shouldn't fall through to the
    // dynamic-default "transfers hidden" behaviour.
    const patch = await prefsPATCH(
      new Request("http://test/api/display-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashflowExcludedCatIds: [] }),
      }),
    );
    expect(patch.status).toBe(200);

    const get = await prefsGET();
    const body = (await get.json()) as Resp;
    expect(body.cashflowExcludedCatIds).toEqual([]);
  });

  it("PATCH preserves other prefs while updating one", async () => {
    // Update one key, confirm an unrelated key from a prior PATCH
    // is still the patched value (not reset to default).
    await prefsPATCH(
      new Request("http://test/api/display-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cashflowExcludedCatIds: ["cat-rent"],
          cashflowShowHidden: true,
        }),
      }),
    );
    await prefsPATCH(
      new Request("http://test/api/display-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashflowTotalsLevel: "parent" }),
      }),
    );

    const get = await prefsGET();
    const body = (await get.json()) as {
      cashflowExcludedCatIds: string[];
      cashflowShowHidden: boolean;
      cashflowTotalsLevel: string;
    };
    expect(body.cashflowExcludedCatIds).toEqual(["cat-rent"]);
    expect(body.cashflowShowHidden).toBe(true);
    expect(body.cashflowTotalsLevel).toBe("parent");
  });

  it("PATCH chartScheduleTheme + chartSchedulePalettes round-trip", async () => {
    // User adds a custom palette and selects it as active. Both
    // values must survive the round-trip — the parser used to lock
    // chartScheduleTheme to a "fabulous" | "standard" enum, which
    // would silently drop a custom palette id back to the default.
    const palette = {
      id: "pal-night",
      name: "Night",
      actual: "#222222",
      saved: "#333333",
      over: "#aa0000",
      forecast: "#888888",
    };
    const patch = await prefsPATCH(
      new Request("http://test/api/display-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chartSchedulePalettes: [palette],
          chartScheduleTheme: "pal-night",
        }),
      }),
    );
    expect(patch.status).toBe(200);

    const get = await prefsGET();
    const body = (await get.json()) as {
      chartScheduleTheme: string;
      chartSchedulePalettes: Array<typeof palette>;
    };
    expect(body.chartScheduleTheme).toBe("pal-night");
    expect(body.chartSchedulePalettes).toEqual([palette]);
  });
});
