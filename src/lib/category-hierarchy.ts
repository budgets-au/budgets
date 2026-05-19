import type { CashflowCategory } from "@/app/api/reports/cashflow/route";

/** The Cashflow API returns a flat list of categories — only those
 *  with direct transactions (or a budget/schedule attached
 *  directly) come back. A parent whose children have data but
 *  which has no own transactions is absent from the response.
 *  That makes a depth-2 leaf render with its `pl-16` indent but
 *  no visible parent above it; operators read the gap as a bug.
 *
 *  This pass walks the leaves, synthesises a row for any
 *  referenced parent that's missing, rolls up its real
 *  descendants' totals / plan / count, then emits rows in tree
 *  order (depth-0 → depth-1 → depth-2). Synthesised rows carry
 *  `isSynthetic: true` so the renderer can suppress the per-row
 *  link and hide button — the row exists as a structural header. */
export function buildHierarchicalRows(
  cats: CashflowCategory[],
  monthsInWindow: string[],
): Array<{ row: CashflowCategory; isSynthetic: boolean }> {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const synthIds = new Set<string>();

  function makeSynth(
    origId: string,
    name: string,
    type: "income" | "expense",
    parentId: string | null,
    parentName: string | null,
  ): CashflowCategory {
    return {
      id: origId,
      name,
      parentId,
      parentName,
      grandparentId: null,
      grandparentName: null,
      type,
      byMonth: {},
      countByMonth: {},
      total: 0,
      totalCount: 0,
      budgetPerMonth: 0,
      scheduledPerMonth: 0,
      budgetByMonth: {},
      scheduledByMonth: {},
    };
  }

  const synthByOrigId = new Map<string, CashflowCategory>();

  for (const c of cats) {
    if (
      c.grandparentId &&
      !byId.has(c.grandparentId) &&
      !synthByOrigId.has(c.grandparentId)
    ) {
      synthByOrigId.set(
        c.grandparentId,
        makeSynth(
          c.grandparentId,
          c.grandparentName ?? "Unknown",
          c.type,
          null,
          null,
        ),
      );
      synthIds.add(c.grandparentId);
    }
    if (
      c.parentId &&
      !byId.has(c.parentId) &&
      !synthByOrigId.has(c.parentId)
    ) {
      synthByOrigId.set(
        c.parentId,
        makeSynth(
          c.parentId,
          c.parentName ?? "Unknown",
          c.type,
          c.grandparentId ?? null,
          c.grandparentName ?? null,
        ),
      );
      synthIds.add(c.parentId);
    }
  }

  for (const [origId, synth] of synthByOrigId) {
    for (const c of cats) {
      const isDescendant =
        c.parentId === origId || c.grandparentId === origId;
      if (!isDescendant) continue;
      synth.total += c.total;
      synth.totalCount += c.totalCount;
      for (const m of monthsInWindow) {
        synth.scheduledByMonth[m] =
          (synth.scheduledByMonth[m] ?? 0) +
          (c.scheduledByMonth?.[m] ?? 0);
        synth.budgetByMonth[m] =
          (synth.budgetByMonth[m] ?? 0) + (c.budgetByMonth?.[m] ?? 0);
      }
    }
  }

  const all = [...cats, ...synthByOrigId.values()];
  const depth0 = all
    .filter((c) => !c.parentId && !c.grandparentId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const depth1ByParent = new Map<string, CashflowCategory[]>();
  for (const c of all) {
    if (c.parentId && !c.grandparentId) {
      const arr = depth1ByParent.get(c.parentId) ?? [];
      arr.push(c);
      depth1ByParent.set(c.parentId, arr);
    }
  }
  const depth2ByParent = new Map<string, CashflowCategory[]>();
  for (const c of all) {
    if (c.grandparentId) {
      const arr = depth2ByParent.get(c.parentId!) ?? [];
      arr.push(c);
      depth2ByParent.set(c.parentId!, arr);
    }
  }
  for (const arr of depth1ByParent.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }
  for (const arr of depth2ByParent.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }

  const out: Array<{ row: CashflowCategory; isSynthetic: boolean }> = [];
  for (const d0 of depth0) {
    out.push({ row: d0, isSynthetic: synthIds.has(d0.id) });
    for (const d1 of depth1ByParent.get(d0.id) ?? []) {
      out.push({ row: d1, isSynthetic: synthIds.has(d1.id) });
      for (const d2 of depth2ByParent.get(d1.id) ?? []) {
        out.push({ row: d2, isSynthetic: synthIds.has(d2.id) });
      }
    }
  }
  return out;
}
