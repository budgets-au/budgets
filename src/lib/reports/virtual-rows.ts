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
 *  Tags are bucketed case-INSENSITIVELY — `PropertyA` and
 *  `propertya` are the same virtual row (the display label picks
 *  the first casing seen, so operators get consistent capitalisation
 *  without their earlier typing being overwritten). This mirrors
 *  the dedupe rule the popover and edit dialog already apply on
 *  input.
 *
 *  Deterministic in output order: alphabetical by tag. */
export function buildVirtualRowsByTag(
  cats: CashflowCategory[],
  tagsByCategoryId: Record<string, string[] | null | undefined>,
  months: string[],
): VirtualTagRow[] {
  const byTag = new Map<
    string,
    {
      display: string;
      members: Set<string>;
      byMonth: Record<string, number>;
    }
  >();

  for (const cat of cats) {
    const tags = tagsByCategoryId[cat.id];
    if (!tags || tags.length === 0) continue;
    for (const rawTag of tags) {
      const trimmed = rawTag.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      let bucket = byTag.get(key);
      if (!bucket) {
        bucket = { display: trimmed, members: new Set(), byMonth: {} };
        byTag.set(key, bucket);
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
  for (const bucket of byTag.values()) {
    // Skip tags with no activity in the window. A tag whose members
    // net exactly to 0 (income + expense cancelling) still had
    // activity — those rows are informative and stay. Only drop
    // the case where NO month had any contribution.
    if (Object.keys(bucket.byMonth).length === 0) continue;
    const total = Object.values(bucket.byMonth).reduce((s, n) => s + n, 0);
    rows.push({
      tag: bucket.display,
      memberCategoryIds: [...bucket.members].sort(),
      byMonth: bucket.byMonth,
      total,
    });
  }
  rows.sort((a, b) => a.tag.localeCompare(b.tag));
  return rows;
}
