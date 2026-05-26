import { db } from "@/db";
import { categories } from "@/db/schema";
import {
  buildChildrenByParent,
  descendantIdsFromMap,
} from "./category-tree";

// Pure tree helpers live in `./category-tree` so client components
// can import them without pulling `@/db` into the browser bundle.
// Re-exported here for the existing server-side consumers that
// imported them from this module before the split.
export {
  buildChildrenByParent,
  descendantIdsFromMap,
  type CategoryNode,
} from "./category-tree";

/**
 * One-shot helper for callers that only need a single subtree. Loads
 * every category to build the map, walks once, returns ids. Multi-call
 * sites (e.g. /api/scheduled/budget-progress) should build the map
 * themselves via {@link buildChildrenByParent} and reuse it across
 * walks.
 *
 * Used by the transactions list, transactions count, expenses drilldown,
 * and the categories edit cycle-check.
 */
export async function categoryDescendantIds(rootId: string): Promise<string[]> {
  const rows = await db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories);
  return descendantIdsFromMap(rootId, buildChildrenByParent(rows));
}

/** True when `candidateAncestorId` would create a cycle if set as the
 * parent of `nodeId` — i.e. the candidate is already a descendant of
 * the node (or is the node itself). Used by the categories edit
 * endpoint to reject a parent change that would create a cycle. */
export async function wouldCreateCycle(
  nodeId: string,
  candidateAncestorId: string,
): Promise<boolean> {
  if (nodeId === candidateAncestorId) return true;
  const descendants = await categoryDescendantIds(nodeId);
  return descendants.includes(candidateAncestorId);
}
