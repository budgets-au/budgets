import { db } from "@/db";
import { categories } from "@/db/schema";

export interface CategoryNode {
  id: string;
  parentId: string | null;
}

/** Build a parent → children adjacency map once so descendant walks
 * are pure JS lookups. Exported separately so callers that need the
 * map for multiple roots (e.g. budget-progress walks every budget's
 * subtree) build it once instead of once per call. */
export function buildChildrenByParent(rows: CategoryNode[]): Map<string, string[]> {
  const childrenByParent = new Map<string, string[]>();
  for (const r of rows) {
    if (r.parentId == null) continue;
    const arr = childrenByParent.get(r.parentId) ?? [];
    arr.push(r.id);
    childrenByParent.set(r.parentId, arr);
  }
  return childrenByParent;
}

/** Walk the parent → children map starting at `rootId`. Returns
 * `[rootId, ...descendants]`. Pure function so it's trivially testable
 * and the caller can run it many times against one prebuilt map
 * without re-fetching categories. */
export function descendantIdsFromMap(
  rootId: string,
  childrenByParent: Map<string, string[]>,
): string[] {
  const out: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>([rootId]);
  while (stack.length > 0) {
    const cur = stack.pop()!;
    out.push(cur);
    for (const child of childrenByParent.get(cur) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        stack.push(child);
      }
    }
  }
  return out;
}

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
