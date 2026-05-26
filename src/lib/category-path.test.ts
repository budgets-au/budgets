import { describe, expect, it } from "vitest";
import {
  buildCategoryMeta,
  buildCategoryPathStringMap,
  type CategoryLike,
} from "./category-path";

/** A canonical 3-level chain: top-level → child → grandchild.
 *  Real-world example from the seeded book — Caravan ›
 *  Insurance disambiguates from Ford › Insurance and Health ›
 *  Insurance. */
const CATS: CategoryLike[] = [
  { id: "caravan", name: "Caravan", parentId: null },
  { id: "caravan-ins", name: "Insurance", parentId: "caravan" },
  { id: "caravan-ins-comp", name: "Comprehensive", parentId: "caravan-ins" },
  { id: "ford", name: "Ford", parentId: null },
  { id: "ford-ins", name: "Insurance", parentId: "ford" },
  { id: "loose", name: "Standalone", parentId: null },
];

describe("buildCategoryPathStringMap", () => {
  it("joins ancestors with ' › ' for the same-leaf-name disambiguation case", () => {
    const m = buildCategoryPathStringMap(CATS);
    expect(m.get("caravan-ins")).toBe("Caravan › Insurance");
    expect(m.get("ford-ins")).toBe("Ford › Insurance");
  });

  it("walks the full grandparent → parent → child chain", () => {
    const m = buildCategoryPathStringMap(CATS);
    expect(m.get("caravan-ins-comp")).toBe(
      "Caravan › Insurance › Comprehensive",
    );
  });

  it("top-level categories render as just their name", () => {
    const m = buildCategoryPathStringMap(CATS);
    expect(m.get("loose")).toBe("Standalone");
    expect(m.get("caravan")).toBe("Caravan");
  });

  it("caps at 4 levels deep (defensive against pathological chains)", () => {
    // 6-level chain — anything past the 4th ancestor is dropped.
    const deep: CategoryLike[] = [
      { id: "L1", name: "L1", parentId: null },
      { id: "L2", name: "L2", parentId: "L1" },
      { id: "L3", name: "L3", parentId: "L2" },
      { id: "L4", name: "L4", parentId: "L3" },
      { id: "L5", name: "L5", parentId: "L4" },
      { id: "L6", name: "L6", parentId: "L5" },
    ];
    const m = buildCategoryPathStringMap(deep);
    // Leaf L6 walks up: L6 ← L5 ← L4 ← L3 (4 levels), L2/L1 dropped.
    expect(m.get("L6")).toBe("L3 › L4 › L5 › L6");
  });

  it("tolerates a parent_id that references a missing row (orphan)", () => {
    const orphan: CategoryLike[] = [
      { id: "orph", name: "Orphan", parentId: "ghost" },
    ];
    const m = buildCategoryPathStringMap(orphan);
    expect(m.get("orph")).toBe("Orphan");
  });
});

describe("buildCategoryMeta (pre-existing API)", () => {
  it("still returns depth + path array for each category", () => {
    const { meta } = buildCategoryMeta(CATS);
    expect(meta.get("caravan-ins-comp")).toEqual({
      depth: 2,
      path: ["Caravan", "Insurance", "Comprehensive"],
    });
    expect(meta.get("caravan")).toEqual({ depth: 0, path: ["Caravan"] });
  });
});
