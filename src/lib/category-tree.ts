/** Pure helpers for walking the category parent → children
 *  adjacency tree. Split out of `category-descendants.ts` (which
 *  also exports DB-touching helpers) so client components can
 *  import the tree-walk utilities without dragging `@/db` — and
 *  by extension `better-sqlite3` and the backup subsystem — into
 *  the browser bundle. */

export interface CategoryNode {
  id: string;
  parentId: string | null;
}

/** Build a parent → children adjacency map once so descendant
 *  walks are pure JS lookups. Exported separately so callers that
 *  need the map for multiple roots build it once instead of once
 *  per call. */
export function buildChildrenByParent(
  rows: CategoryNode[],
): Map<string, string[]> {
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
 *  `[rootId, ...descendants]`. Pure function so it's trivially
 *  testable and the caller can run it many times against one
 *  prebuilt map without re-fetching categories. */
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
