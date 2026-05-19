import { describe, expect, it } from "vitest";
import { buildHierarchicalRows } from "./category-hierarchy";
import type { CashflowCategory } from "@/app/api/reports/cashflow/route";

function cat(over: Partial<CashflowCategory> & { id: string }): CashflowCategory {
  return {
    id: over.id,
    name: over.name ?? over.id,
    parentId: over.parentId ?? null,
    parentName: over.parentName ?? null,
    grandparentId: over.grandparentId ?? null,
    grandparentName: over.grandparentName ?? null,
    type: over.type ?? "expense",
    byMonth: over.byMonth ?? {},
    countByMonth: over.countByMonth ?? {},
    total: over.total ?? 0,
    totalCount: over.totalCount ?? 0,
    budgetPerMonth: over.budgetPerMonth ?? 0,
    scheduledPerMonth: over.scheduledPerMonth ?? 0,
    budgetByMonth: over.budgetByMonth ?? {},
    scheduledByMonth: over.scheduledByMonth ?? {},
  };
}

describe("buildHierarchicalRows", () => {
  it("returns leaves unchanged when no parent is missing", () => {
    const parent = cat({ id: "P", name: "Parent", total: -100 });
    const child = cat({
      id: "C",
      name: "Child",
      parentId: "P",
      parentName: "Parent",
      total: -50,
    });
    const out = buildHierarchicalRows([parent, child], ["2026-01"]);
    expect(out.map((r) => r.row.id)).toEqual(["P", "C"]);
    expect(out.every((r) => !r.isSynthetic)).toBe(true);
  });

  it("synthesises a missing depth-0 parent for a depth-1 leaf", () => {
    const child = cat({
      id: "C",
      name: "Groceries",
      parentId: "FOOD",
      parentName: "Food",
      total: -500,
      totalCount: 3,
      scheduledByMonth: { "2026-01": 200 },
    });
    const out = buildHierarchicalRows([child], ["2026-01"]);
    expect(out.map((r) => r.row.id)).toEqual(["FOOD", "C"]);
    const synth = out[0];
    expect(synth.isSynthetic).toBe(true);
    expect(synth.row.name).toBe("Food");
    expect(synth.row.total).toBe(-500);
    expect(synth.row.totalCount).toBe(3);
    expect(synth.row.scheduledByMonth["2026-01"]).toBe(200);
    expect(out[1].isSynthetic).toBe(false);
  });

  it("synthesises a missing depth-1 parent for a depth-2 grandchild", () => {
    const gp = cat({
      id: "FOOD",
      name: "Food",
      total: -10,
    });
    const grand = cat({
      id: "APPLES",
      name: "Apples",
      parentId: "FRUIT",
      parentName: "Fruit",
      grandparentId: "FOOD",
      grandparentName: "Food",
      total: -80,
      totalCount: 2,
    });
    const out = buildHierarchicalRows([gp, grand], ["2026-01"]);
    // Tree order: FOOD (real, depth-0) → FRUIT (synth, depth-1) → APPLES
    expect(out.map((r) => r.row.id)).toEqual(["FOOD", "FRUIT", "APPLES"]);
    expect(out[0].isSynthetic).toBe(false);
    expect(out[1].isSynthetic).toBe(true);
    expect(out[1].row.name).toBe("Fruit");
    expect(out[1].row.parentId).toBe("FOOD");
    expect(out[1].row.total).toBe(-80);
    expect(out[2].isSynthetic).toBe(false);
  });

  it("synthesises both depth-0 and depth-1 when both are missing", () => {
    const grand = cat({
      id: "APPLES",
      name: "Apples",
      parentId: "FRUIT",
      parentName: "Fruit",
      grandparentId: "FOOD",
      grandparentName: "Food",
      total: -80,
      budgetByMonth: { "2026-01": 100 },
    });
    const out = buildHierarchicalRows([grand], ["2026-01"]);
    expect(out.map((r) => r.row.id)).toEqual(["FOOD", "FRUIT", "APPLES"]);
    expect(out[0].isSynthetic).toBe(true);
    expect(out[1].isSynthetic).toBe(true);
    // Both rolled-up rows reflect the descendant's figures.
    expect(out[0].row.total).toBe(-80);
    expect(out[1].row.total).toBe(-80);
    expect(out[0].row.budgetByMonth["2026-01"]).toBe(100);
    expect(out[1].row.budgetByMonth["2026-01"]).toBe(100);
  });

  it("aggregates multiple descendants into a single synthesised parent", () => {
    const a = cat({
      id: "A",
      parentId: "P",
      parentName: "Parent",
      total: -50,
      totalCount: 1,
      scheduledByMonth: { "2026-01": 10, "2026-02": 20 },
    });
    const b = cat({
      id: "B",
      parentId: "P",
      parentName: "Parent",
      total: -30,
      totalCount: 2,
      scheduledByMonth: { "2026-01": 5 },
    });
    const out = buildHierarchicalRows([a, b], ["2026-01", "2026-02"]);
    const synth = out.find((r) => r.row.id === "P");
    expect(synth).toBeDefined();
    expect(synth!.isSynthetic).toBe(true);
    expect(synth!.row.total).toBe(-80);
    expect(synth!.row.totalCount).toBe(3);
    expect(synth!.row.scheduledByMonth["2026-01"]).toBe(15);
    expect(synth!.row.scheduledByMonth["2026-02"]).toBe(20);
  });

  it("orders synthesised depth-0 parents alphabetically alongside real ones", () => {
    const realA = cat({ id: "A", name: "Apples", total: -10 });
    const childZ = cat({
      id: "Z1",
      name: "Zebra leaf",
      parentId: "ZP",
      parentName: "Zoo",
      total: -20,
    });
    const childB = cat({
      id: "B1",
      name: "Beta leaf",
      parentId: "BP",
      parentName: "Bananas",
      total: -30,
    });
    const out = buildHierarchicalRows([realA, childZ, childB], ["2026-01"]);
    // Top-level order: Apples, Bananas (synth), Zoo (synth)
    const tops = out.filter((r) => !r.row.parentId);
    expect(tops.map((r) => r.row.name)).toEqual(["Apples", "Bananas", "Zoo"]);
  });
});
