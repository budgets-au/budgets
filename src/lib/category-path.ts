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
