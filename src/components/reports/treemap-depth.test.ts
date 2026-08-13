import { describe, expect, it } from "vitest";
import { pruneToDepth, type TmNode } from "./treemap-report";

/** Builds a 3-level tree mirroring the real category hierarchy:
 *  grandparent → parent → leaf. Values roll up, which is what the
 *  real `buildTreemapTree` produces. */
function tree(): TmNode {
  const leafA: TmNode = {
    id: "leaf-a", name: "Groceries", value: 60, paletteIndex: 0,
    parentId: "parent", hasKids: false, children: [],
  };
  const leafB: TmNode = {
    id: "leaf-b", name: "Restaurants", value: 40, paletteIndex: 0,
    parentId: "parent", hasKids: false, children: [],
  };
  const parent: TmNode = {
    id: "parent", name: "Food", value: 100, paletteIndex: 0,
    parentId: "gp", hasKids: true, children: [leafA, leafB],
  };
  return {
    id: "gp", name: "Living", value: 100, paletteIndex: 0,
    parentId: null, hasKids: true, children: [parent],
  };
}

describe("pruneToDepth", () => {
  it("level 1 renders the root alone", () => {
    const out = pruneToDepth(tree(), 1);
    expect(out.id).toBe("gp");
    expect(out.children).toEqual([]);
  });

  it("level 2 keeps the parent but drops the leaves", () => {
    const out = pruneToDepth(tree(), 2);
    expect(out.children.map((c) => c.id)).toEqual(["parent"]);
    expect(out.children[0].children).toEqual([]);
  });

  it("level 3 keeps the whole hierarchy", () => {
    const out = pruneToDepth(tree(), 3);
    expect(out.children[0].children.map((c) => c.id)).toEqual([
      "leaf-a",
      "leaf-b",
    ]);
  });

  it("asking for more levels than exist is a no-op, not an error", () => {
    const out = pruneToDepth(tree(), 99);
    expect(out.children[0].children).toHaveLength(2);
  });

  // The whole point of capping the depth is that a parent still
  // shows its full rolled-up total — it just stops being
  // subdivided. If pruning changed values the tiles would shrink
  // and the treemap would misrepresent the split.
  it("preserves rolled-up values at every level", () => {
    for (const levels of [1, 2, 3]) {
      const out = pruneToDepth(tree(), levels);
      expect(out.value).toBe(100);
    }
    expect(pruneToDepth(tree(), 2).children[0].value).toBe(100);
  });

  // Tiles at the cut line must stay drillable — otherwise choosing
  // "1 level" would strand the operator with no way into level 2.
  it("keeps hasKids intact so pruned tiles are still drillable", () => {
    const out = pruneToDepth(tree(), 1);
    expect(out.hasKids).toBe(true);
    expect(out.children).toEqual([]);

    const two = pruneToDepth(tree(), 2);
    expect(two.children[0].hasKids).toBe(true);
    expect(two.children[0].children).toEqual([]);
  });

  it("does not mutate the input tree", () => {
    const src = tree();
    pruneToDepth(src, 1);
    expect(src.children[0].children).toHaveLength(2);
  });
});
