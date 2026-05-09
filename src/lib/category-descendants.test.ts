import { describe, expect, it } from "vitest";
import {
  buildChildrenByParent,
  descendantIdsFromMap,
  type CategoryNode,
} from "./category-descendants";

const TREE: CategoryNode[] = [
  { id: "root-a", parentId: null },
  { id: "root-b", parentId: null },
  { id: "a-1", parentId: "root-a" },
  { id: "a-2", parentId: "root-a" },
  { id: "a-1-x", parentId: "a-1" },
  { id: "a-1-y", parentId: "a-1" },
  { id: "a-1-x-deep", parentId: "a-1-x" },
  { id: "b-1", parentId: "root-b" },
  { id: "orphan", parentId: "missing-parent" },
];

describe("buildChildrenByParent", () => {
  it("groups children by their parentId", () => {
    const map = buildChildrenByParent(TREE);
    expect(map.get("root-a")?.sort()).toEqual(["a-1", "a-2"]);
    expect(map.get("a-1")?.sort()).toEqual(["a-1-x", "a-1-y"]);
    expect(map.get("a-1-x")).toEqual(["a-1-x-deep"]);
  });

  it("ignores rows with null parentId — they're roots, not children", () => {
    const map = buildChildrenByParent(TREE);
    // Root entries themselves never appear as values in the map.
    for (const [, children] of map) {
      expect(children).not.toContain("root-a");
      expect(children).not.toContain("root-b");
    }
  });

  it("returns an empty map when input is empty", () => {
    expect(buildChildrenByParent([]).size).toBe(0);
  });
});

describe("descendantIdsFromMap", () => {
  const map = buildChildrenByParent(TREE);

  it("includes the root itself plus every descendant", () => {
    const ids = descendantIdsFromMap("root-a", map);
    expect(ids.sort()).toEqual(
      ["a-1", "a-1-x", "a-1-x-deep", "a-1-y", "a-2", "root-a"].sort(),
    );
  });

  it("returns just the root when it has no children", () => {
    expect(descendantIdsFromMap("a-1-x-deep", map)).toEqual(["a-1-x-deep"]);
  });

  it("doesn't cross sibling subtrees", () => {
    const ids = descendantIdsFromMap("root-b", map);
    expect(ids).toContain("root-b");
    expect(ids).toContain("b-1");
    expect(ids).not.toContain("a-1");
    expect(ids).not.toContain("root-a");
  });

  it("handles a root that's not in the map at all (no children case)", () => {
    expect(descendantIdsFromMap("does-not-exist", map)).toEqual(["does-not-exist"]);
  });

  it("doesn't infinite-loop on a self-referential cycle", () => {
    // Pathological input — the matcher tolerates it because seen-set
    // dedupes on each visit. Without that guard this would loop forever.
    const cyclic: CategoryNode[] = [
      { id: "x", parentId: "y" },
      { id: "y", parentId: "x" },
    ];
    const m = buildChildrenByParent(cyclic);
    const out = descendantIdsFromMap("x", m);
    expect(out.sort()).toEqual(["x", "y"]);
  });

  it("reuses the same map for multiple walks (no shared mutable state)", () => {
    const a = descendantIdsFromMap("root-a", map);
    const b = descendantIdsFromMap("root-b", map);
    // Walking root-a must not have polluted root-b's result.
    expect(b).toEqual(["root-b", "b-1"]);
    expect(a).toContain("a-1");
  });
});
