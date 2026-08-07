import { describe, expect, it } from "vitest";
import type { CashflowCategory } from "@/app/api/reports/cashflow/route";
import { buildVirtualRowsByTag } from "./virtual-rows";

/** Minimal factory — only the fields buildVirtualRowsByTag reads.
 *  Everything else on CashflowCategory is irrelevant to the sum. */
function cat(
  id: string,
  type: "income" | "expense",
  byMonth: Record<string, number>,
): CashflowCategory {
  return {
    id,
    name: id,
    parentId: null,
    parentName: null,
    grandparentId: null,
    grandparentName: null,
    type,
    byMonth,
    countByMonth: {},
    total: Object.values(byMonth).reduce((s, n) => s + n, 0),
    totalCount: 0,
    budgetTotal: 0,
    scheduledTotal: 0,
    budgetByMonth: {},
    scheduledByMonth: {},
  };
}

describe("buildVirtualRowsByTag", () => {
  it("returns [] when no categories carry tags", () => {
    const cats = [cat("a", "expense", { "2026-01": -100 })];
    expect(buildVirtualRowsByTag(cats, {}, ["2026-01"])).toEqual([]);
  });

  it("returns [] when the tag map is empty even with matching cats", () => {
    const cats = [cat("a", "expense", { "2026-01": -100 })];
    expect(buildVirtualRowsByTag(cats, { a: [] }, ["2026-01"])).toEqual([]);
  });

  it("sums a single tag across two same-type categories", () => {
    const cats = [
      cat("groceries", "expense", { "2026-01": -100, "2026-02": -50 }),
      cat("utilities", "expense", { "2026-01": -80, "2026-02": -40 }),
    ];
    const rows = buildVirtualRowsByTag(
      cats,
      { groceries: ["PropertyA"], utilities: ["PropertyA"] },
      ["2026-01", "2026-02"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tag: "PropertyA",
      memberCategoryIds: ["groceries", "utilities"],
      byMonth: { "2026-01": -180, "2026-02": -90 },
      total: -270,
    });
  });

  it("produces one signed net row per tag when income + expense mix", () => {
    // PropertyA has rent income + maintenance expense — expect a net
    // row (income positive, expense negative summed together).
    const cats = [
      cat("rent-in", "income", { "2026-01": 2500 }),
      cat("maint", "expense", { "2026-01": -400 }),
    ];
    const rows = buildVirtualRowsByTag(
      cats,
      { "rent-in": ["PropertyA"], maint: ["PropertyA"] },
      ["2026-01"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].byMonth["2026-01"]).toBe(2100); // 2500 - 400
    expect(rows[0].memberCategoryIds).toEqual(["maint", "rent-in"]);
  });

  it("skips months a category isn't active in and skips tags with zero window activity", () => {
    // "in-window" cat contributes; "out" has activity outside the
    // window so its byMonth for asked months is 0 → tag drops.
    const cats = [
      cat("in-window", "expense", { "2026-01": -50 }),
      cat("out", "expense", { "2025-12": -999 }),
    ];
    const rowsInWindow = buildVirtualRowsByTag(
      cats,
      { "in-window": ["Zero"] },
      ["2026-01"],
    );
    expect(rowsInWindow).toHaveLength(1);
    expect(rowsInWindow[0].byMonth).toEqual({ "2026-01": -50 });

    const rowsAllOut = buildVirtualRowsByTag(
      cats,
      { out: ["Zero"] },
      ["2026-01"],
    );
    expect(rowsAllOut).toEqual([]);
  });

  it("produces two rows when a category carries two tags — each row sums independently", () => {
    const cats = [
      cat("groceries", "expense", { "2026-01": -100 }),
      cat("utilities", "expense", { "2026-01": -80 }),
    ];
    const rows = buildVirtualRowsByTag(
      cats,
      { groceries: ["PropertyA", "Shared"], utilities: ["Shared"] },
      ["2026-01"],
    );
    expect(rows.map((r) => r.tag)).toEqual(["PropertyA", "Shared"]);
    const shared = rows.find((r) => r.tag === "Shared")!;
    expect(shared.byMonth["2026-01"]).toBe(-180);
    const propA = rows.find((r) => r.tag === "PropertyA")!;
    expect(propA.byMonth["2026-01"]).toBe(-100);
  });

  it("orders rows alphabetically regardless of tag insertion order", () => {
    const cats = [
      cat("a", "expense", { "2026-01": -10 }),
      cat("b", "expense", { "2026-01": -20 }),
      cat("c", "expense", { "2026-01": -30 }),
    ];
    const rows = buildVirtualRowsByTag(
      cats,
      { a: ["Zulu"], b: ["Alpha"], c: ["Mike"] },
      ["2026-01"],
    );
    expect(rows.map((r) => r.tag)).toEqual(["Alpha", "Mike", "Zulu"]);
  });

  it("trims whitespace tags and drops empty ones", () => {
    const cats = [cat("a", "expense", { "2026-01": -100 })];
    const rows = buildVirtualRowsByTag(
      cats,
      { a: ["  PropertyA  ", "", "   "] },
      ["2026-01"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tag).toBe("PropertyA");
  });

  it("dedupes members when the same category id appears multiple times", () => {
    // Defensive — memberCategoryIds must be unique even if the same
    // cat is passed twice under different tag entries.
    const cats = [cat("a", "expense", { "2026-01": -50 })];
    const rows = buildVirtualRowsByTag(
      cats,
      { a: ["PropertyA", "PropertyA"] },
      ["2026-01"],
    );
    // Both tag entries collapse to one bucket; member should appear once.
    expect(rows).toHaveLength(1);
    expect(rows[0].memberCategoryIds).toEqual(["a"]);
  });
});
