import { bench, describe } from "vitest";
import {
  buildChildrenByParent,
  descendantIdsFromMap,
  type CategoryNode,
} from "./category-descendants";

/** Build a synthetic tree shaped like a real budgets install:
 *   - 10 root categories
 *   - 5 children each (50 mid-level)
 *   - 4 grandchildren each (200 leaf)
 * Total: 260 nodes — close to the 200ish the explore agent observed
 * in the user's data. */
function buildTree(): CategoryNode[] {
  const rows: CategoryNode[] = [];
  for (let r = 0; r < 10; r++) {
    const rootId = `root-${r}`;
    rows.push({ id: rootId, parentId: null });
    for (let m = 0; m < 5; m++) {
      const midId = `${rootId}-m${m}`;
      rows.push({ id: midId, parentId: rootId });
      for (let l = 0; l < 4; l++) {
        rows.push({ id: `${midId}-l${l}`, parentId: midId });
      }
    }
  }
  return rows;
}

const tree = buildTree();
const sharedMap = buildChildrenByParent(tree);

// Mirror the "20 budgets need their subtree" pattern from
// /api/scheduled/budget-progress: 20 root walks per request.
const BUDGET_ROOTS = Array.from({ length: 20 }, (_, i) => `root-${i % 10}`);

describe("category descendants — 20 walks per request", () => {
  bench("AFTER: build map once, walk 20 times", () => {
    const map = buildChildrenByParent(tree);
    for (const root of BUDGET_ROOTS) {
      descendantIdsFromMap(root, map);
    }
  });

  bench("BEFORE: rebuild map on every walk (the old categoryDescendantIds shape)", () => {
    for (const root of BUDGET_ROOTS) {
      const map = buildChildrenByParent(tree);
      descendantIdsFromMap(root, map);
    }
  });

  bench("walk only (shared prebuilt map, lower bound)", () => {
    for (const root of BUDGET_ROOTS) {
      descendantIdsFromMap(root, sharedMap);
    }
  });
});
