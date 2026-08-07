import type { CashflowCategory } from "@/app/api/reports/cashflow/route";

/** A virtual row that aggregates the byMonth values of every real
 *  category tagged with `tag`. Rendered on the Cashflow report below
 *  the main table under a "Tagged views" header, each row toggleable
 *  independently. Deliberately excluded from Total Income / Total
 *  Expenses / Surplus math — these are a parallel view of the same
 *  data, not additional data. */
export interface VirtualTagRow {
  /** Human-readable tag label — also used as the row id. Two
   *  categories carrying the same tag string produce ONE row. */
  tag: string;
  /** Category ids that contribute to this tag's sum. Sorted for
   *  deterministic identity across renders. */
  memberCategoryIds: string[];
  /** Signed per-month totals: sum of every member's byMonth[m] for
   *  each m in the caller's `months` window. Values are stored with
   *  the sign the Cashflow report already uses — income positive,
   *  expense negative — so a tag mixing both reads as net effect. */
  byMonth: Record<string, number>;
  /** Sum of byMonth across the window. Convenience so the caller
   *  doesn't reduce it every render. */
  total: number;
}

/** Build one virtual row per unique tag across the supplied
 *  categories. Only tags with at least one non-zero member entry in
 *  the requested `months` window materialise — a tag that exists
 *  on a category but the category has no activity in the window
 *  wouldn't produce a useful row, so we drop it.
 *
 *  Deterministic in output order: alphabetical by tag. */
export function buildVirtualRowsByTag(
  cats: CashflowCategory[],
  tagsByCategoryId: Record<string, string[] | null | undefined>,
  months: string[],
): VirtualTagRow[] {
  const byTag = new Map<
    string,
    { members: Set<string>; byMonth: Record<string, number> }
  >();

  for (const cat of cats) {
    const tags = tagsByCategoryId[cat.id];
    if (!tags || tags.length === 0) continue;
    for (const rawTag of tags) {
      const tag = rawTag.trim();
      if (!tag) continue;
      let bucket = byTag.get(tag);
      if (!bucket) {
        bucket = { members: new Set(), byMonth: {} };
        byTag.set(tag, bucket);
      }
      bucket.members.add(cat.id);
      for (const m of months) {
        const v = cat.byMonth[m] ?? 0;
        if (v === 0) continue;
        bucket.byMonth[m] = (bucket.byMonth[m] ?? 0) + v;
      }
    }
  }

  const rows: VirtualTagRow[] = [];
  for (const [tag, bucket] of byTag) {
    // Skip tags that ended up with zero activity across the window.
    const total = Object.values(bucket.byMonth).reduce((s, n) => s + n, 0);
    if (total === 0 && Object.keys(bucket.byMonth).length === 0) continue;
    rows.push({
      tag,
      memberCategoryIds: [...bucket.members].sort(),
      byMonth: bucket.byMonth,
      total,
    });
  }
  rows.sort((a, b) => a.tag.localeCompare(b.tag));
  return rows;
}
