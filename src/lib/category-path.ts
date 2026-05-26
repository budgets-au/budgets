export interface CategoryLike {
  id: string;
  name: string;
  parentId: string | null;
}

export function buildCategoryMeta(categories: CategoryLike[]) {
  const byId = new Map(categories.map((c) => [c.id, c]));

  function getDepth(id: string, visited = new Set<string>()): number {
    if (visited.has(id)) return 0;
    visited.add(id);
    const cat = byId.get(id);
    if (!cat?.parentId) return 0;
    return 1 + getDepth(cat.parentId, visited);
  }

  function getPath(id: string, visited = new Set<string>()): string[] {
    if (visited.has(id)) return [];
    visited.add(id);
    const cat = byId.get(id);
    if (!cat) return [];
    if (!cat.parentId) return [cat.name];
    return [...getPath(cat.parentId, visited), cat.name];
  }

  const meta = new Map<string, { depth: number; path: string[] }>();
  for (const cat of categories) {
    meta.set(cat.id, { depth: getDepth(cat.id), path: getPath(cat.id) });
  }

  return { meta, byId };
}

/** Build `Map<categoryId, "Parent › Child › Leaf">` for every
 *  category — the human-readable form the import expand panel and
 *  the transactions neighbours panel use as their category label.
 *  Disambiguates the "Insurance" categories that exist under
 *  Caravan / Ford / Motorbike / Health, etc. Depth-capped at 4
 *  levels so a runaway parent chain can't produce an unreadable
 *  string. */
export function buildCategoryPathStringMap(
  categories: CategoryLike[],
): Map<string, string> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const PATH_DEPTH_CAP = 4;
  const out = new Map<string, string>();
  for (const cat of categories) {
    const parts: string[] = [];
    let cur: CategoryLike | undefined = cat;
    let depth = 0;
    while (cur && depth < PATH_DEPTH_CAP) {
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      depth++;
    }
    out.set(cat.id, parts.length ? parts.join(" › ") : cat.name);
  }
  return out;
}
