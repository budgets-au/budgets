"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { differenceInDays, parseISO } from "date-fns";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Eye, EyeOff, Printer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { formatAUD } from "@/lib/utils";

import type {
  CashflowReport as CashflowData,
  CashflowCategory,
} from "@/app/api/reports/cashflow/route";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface HierNode {
  id: string;
  name: string;
  depth: 0 | 1 | 2;
  ownTotal: number;
  parentId: string | null;
}

function buildTree(cats: CashflowCategory[]) {
  const nodes = new Map<string, HierNode>();
  for (const c of cats) {
    const depth: 0 | 1 | 2 = c.grandparentId ? 2 : c.parentId ? 1 : 0;
    nodes.set(c.id, {
      id: c.id,
      name: c.name,
      depth,
      ownTotal: Math.abs(c.total),
      parentId: c.parentId,
    });
    if (c.parentId && !nodes.has(c.parentId)) {
      const pd = (depth - 1) as 0 | 1;
      nodes.set(c.parentId, {
        id: c.parentId,
        name: c.parentName ?? "?",
        depth: pd,
        ownTotal: 0,
        parentId: pd === 1 ? c.grandparentId : null,
      });
    }
    if (c.grandparentId && !nodes.has(c.grandparentId)) {
      nodes.set(c.grandparentId, {
        id: c.grandparentId,
        name: c.grandparentName ?? "?",
        depth: 0,
        ownTotal: 0,
        parentId: null,
      });
    }
  }

  const childrenOf = new Map<string, string[]>();
  for (const n of nodes.values()) {
    if (n.parentId) {
      const arr = childrenOf.get(n.parentId) ?? [];
      arr.push(n.id);
      childrenOf.set(n.parentId, arr);
    }
  }

  const rolled = new Map<string, number>();
  function rollUp(id: string): number {
    const cached = rolled.get(id);
    if (cached != null) return cached;
    const n = nodes.get(id);
    if (!n) return 0;
    let s = n.ownTotal;
    for (const cid of childrenOf.get(id) ?? []) s += rollUp(cid);
    rolled.set(id, s);
    return s;
  }
  for (const id of nodes.keys()) rollUp(id);

  return { nodes, childrenOf, rolled };
}

/** Effective rolled-up total — excluded cats contribute nothing, and a
 * cat with an excluded ancestor is itself effectively excluded (the eye
 * toggle hides the whole subtree). */
function rollUpEffective(
  tree: ReturnType<typeof buildTree>,
  excluded: Set<string>,
  id: string,
): number {
  if (excluded.has(id)) return 0;
  const n = tree.nodes.get(id);
  if (!n) return 0;
  let s = n.ownTotal;
  for (const cid of tree.childrenOf.get(id) ?? []) {
    s += rollUpEffective(tree, excluded, cid);
  }
  return s;
}

interface RenderRow {
  id: string;
  name: string;
  depth: 0 | 1 | 2;
  /** Effective total — excluded subtrees contribute 0. */
  total: number;
  hasChildren: boolean;
  /** True when this row (or an ancestor) is in the excluded set. */
  isExcluded: boolean;
}

function flattenForDisplay(
  tree: ReturnType<typeof buildTree>,
  collapsed: Set<string>,
  excluded: Set<string>,
  showHidden: boolean,
  sortColumn: "name" | "period",
  sortDir: "asc" | "desc",
): RenderRow[] {
  // Pre-compute effective totals so sorts at every level use the same
  // (post-exclusion) magnitudes that the rows display, instead of the
  // full rolled totals which would still rank an excluded subtree as if
  // it were live.
  const effectiveTotal = new Map<string, number>();
  function effective(id: string): number {
    const cached = effectiveTotal.get(id);
    if (cached != null) return cached;
    const v = rollUpEffective(tree, excluded, id);
    effectiveTotal.set(id, v);
    return v;
  }

  function compareIds(a: string, b: string): number {
    if (sortColumn === "name") {
      const aName = tree.nodes.get(a)?.name ?? "";
      const bName = tree.nodes.get(b)?.name ?? "";
      const cmp = aName.localeCompare(bName, undefined, { sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    }
    // Period: use rolled total when showHidden is on so excluded rows
    // keep a stable position relative to their unexcluded siblings;
    // otherwise rank by the effective (post-exclusion) magnitudes the
    // rows actually display.
    const av = showHidden ? (tree.rolled.get(a) ?? 0) : effective(a);
    const bv = showHidden ? (tree.rolled.get(b) ?? 0) : effective(b);
    return sortDir === "asc" ? av - bv : bv - av;
  }

  const rows: RenderRow[] = [];
  function walk(id: string, ancestorExcluded: boolean) {
    const n = tree.nodes.get(id);
    if (!n) return;
    const t = tree.rolled.get(id) ?? 0;
    if (t === 0) return;
    const isExcluded = ancestorExcluded || excluded.has(id);
    if (isExcluded && !showHidden) return;
    const eff = isExcluded ? 0 : effective(id);
    const activeKids = (tree.childrenOf.get(id) ?? [])
      .filter((cid) => (tree.rolled.get(cid) ?? 0) > 0)
      .sort(compareIds);
    rows.push({
      id,
      name: n.name,
      depth: n.depth,
      total: eff,
      hasChildren: activeKids.length > 0,
      isExcluded,
    });
    if (collapsed.has(id)) return;
    for (const cid of activeKids) walk(cid, isExcluded);
  }
  const roots = Array.from(tree.nodes.values())
    .filter((n) => n.depth === 0 && (tree.rolled.get(n.id) ?? 0) > 0)
    .map((n) => n.id)
    .sort(compareIds);
  for (const id of roots) walk(id, false);
  return rows;
}

const INDENT_CLASS: Record<0 | 1 | 2, string> = {
  0: "pl-3",
  1: "pl-9",
  2: "pl-16",
};

const ROW_FONT: Record<0 | 1 | 2, string> = {
  0: "font-semibold",
  1: "font-medium",
  2: "text-muted-foreground",
};

export function EnvelopeReport({
  from,
  to,
  accountIds,
  hideTransfers,
}: {
  from: string;
  to: string;
  accountIds: string[];
  hideTransfers: boolean;
}) {
  const accountIdsParam =
    accountIds.length > 0 ? `&accountIds=${accountIds.join(",")}` : "";
  const { data, isLoading } = useSWR<CashflowData>(
    `/api/reports/cashflow?from=${from}&to=${to}&hideTransfers=${hideTransfers}${accountIdsParam}`,
    fetcher,
  );

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  // Every time the data reloads (page open, period change, SWR revalidate),
  // collapse every parent — the report opens at the depth-0 overview each
  // time. User clicks within a session still expand individual subtrees.
  useEffect(() => {
    if (!data) return;
    const t = buildTree(data.expenses);
    const ids: string[] = [];
    for (const n of t.nodes.values()) {
      if ((t.rolled.get(n.id) ?? 0) === 0) continue;
      const hasKids = (t.childrenOf.get(n.id) ?? []).some(
        (cid) => (t.rolled.get(cid) ?? 0) > 0,
      );
      if (hasKids) ids.push(n.id);
    }
    setCollapsedIds(new Set(ids));
  }, [data]);
  function toggleCollapsed(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Excluded cat ids — the eye-off toggle. DB-backed via displayPrefs
  // so the operator's curated envelope set follows them across devices.
  const { prefs, setPref } = useDisplayPrefs();
  const excludedIds = new Set(prefs.envelopeExcludedCatIds);
  function toggleExcluded(id: string) {
    const next = new Set(excludedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPref("envelopeExcludedCatIds", [...next]);
  }
  const [showHidden, setShowHidden] = useState(false);

  // Sort state lives on displayPrefs too. Defaults to category-name
  // ascending so the table opens in a predictable order; click a
  // column header to flip the direction (same column) or switch
  // axis (different column). The sort applies at every tree level —
  // roots, sub-parents, and leaves all rank by the same key.
  const sortColumn = prefs.envelopeSortColumn;
  const sortDir = prefs.envelopeSortDir;
  function clickSort(col: "name" | "period") {
    if (col === sortColumn) {
      setPref("envelopeSortDir", sortDir === "asc" ? "desc" : "asc");
    } else {
      setPref("envelopeSortColumn", col);
      // Sensible default direction per axis: alphabetic ascending,
      // money descending (biggest envelopes first when the operator
      // switches to the period axis).
      setPref("envelopeSortDir", col === "name" ? "asc" : "desc");
    }
  }

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
    );
  }
  if (!data) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No data for this period.
      </p>
    );
  }

  const days = Math.max(1, differenceInDays(parseISO(to), parseISO(from)) + 1);
  const weeks = days / 7;
  const months = days / (365.25 / 12);

  const tree = buildTree(data.expenses);
  const allParentIds = Array.from(tree.nodes.values())
    .filter((n) => {
      const t = tree.rolled.get(n.id) ?? 0;
      if (t === 0) return false;
      return (tree.childrenOf.get(n.id) ?? []).some(
        (cid) => (tree.rolled.get(cid) ?? 0) > 0,
      );
    })
    .map((n) => n.id);
  const anyCollapsed = allParentIds.some((id) => collapsedIds.has(id));

  function collapseAll() {
    setCollapsedIds(new Set(allParentIds));
  }
  function expandAll() {
    setCollapsedIds(new Set());
  }

  const rows = flattenForDisplay(
    tree,
    collapsedIds,
    excludedIds,
    showHidden,
    sortColumn,
    sortDir,
  );
  // Grand total = sum of effective totals at depth-0, excluding rows that
  // are themselves excluded (but still displayed when showHidden is on).
  const grandTotal = rows
    .filter((r) => r.depth === 0 && !r.isExcluded)
    .reduce((s, r) => s + r.total, 0);
  const hiddenCount = excludedIds.size;

  return (
    <Card data-print-area>
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Envelope
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Based on {days} days ({weeks.toFixed(1)} weeks · {months.toFixed(1)} months) — set aside this much per envelope to match.
            </p>
          </div>
          <div
            className="flex items-center gap-2 print:hidden"
            data-print-hide
          >
            {hiddenCount > 0 && (
              <Button
                variant={showHidden ? "default" : "outline"}
                size="sm"
                onClick={() => setShowHidden((p) => !p)}
                title={
                  showHidden
                    ? "Hide excluded rows again"
                    : "Reveal excluded rows so you can re-include them"
                }
              >
                {showHidden ? (
                  <Eye className="h-3.5 w-3.5 mr-1" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 mr-1" />
                )}
                {hiddenCount} hidden
              </Button>
            )}
            {allParentIds.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={anyCollapsed ? expandAll : collapseAll}
              >
                {anyCollapsed ? (
                  <>
                    <ChevronDown className="h-3.5 w-3.5 mr-1" /> Expand all
                  </>
                ) : (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 mr-1" /> Collapse all
                  </>
                )}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
            >
              <Printer className="h-4 w-4 mr-1.5" /> Print
            </Button>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No expenses in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <SortableTh
                    align="left"
                    label="Category"
                    column="name"
                    activeColumn={sortColumn}
                    direction={sortDir}
                    onClick={() => clickSort("name")}
                  />
                  <SortableTh
                    align="right"
                    label="Period"
                    column="period"
                    activeColumn={sortColumn}
                    direction={sortDir}
                    onClick={() => clickSort("period")}
                  />
                  {/* Monthly / Weekly / Daily are scaled derivatives of
                      Period — sorting by any of them produces the same
                      order as Period — so the headers piggyback on the
                      same `period` axis. The arrow shows on whichever
                      numeric column the operator's currently sorting by. */}
                  <SortableTh
                    align="right"
                    label="Monthly"
                    column="period"
                    activeColumn={sortColumn}
                    direction={sortDir}
                    onClick={() => clickSort("period")}
                    suppressIndicator
                  />
                  <SortableTh
                    align="right"
                    label="Weekly"
                    column="period"
                    activeColumn={sortColumn}
                    direction={sortDir}
                    onClick={() => clickSort("period")}
                    suppressIndicator
                  />
                  <SortableTh
                    align="right"
                    label="Daily"
                    column="period"
                    activeColumn={sortColumn}
                    direction={sortDir}
                    onClick={() => clickSort("period")}
                    suppressIndicator
                  />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => {
                  const isCollapsed = collapsedIds.has(r.id);
                  const Chevron = isCollapsed ? ChevronRight : ChevronDown;
                  const directlyExcluded = excludedIds.has(r.id);
                  // Excluded subtree rows render faded; values shown as "—"
                  // since they're not contributing to the totals.
                  const fadedCls = r.isExcluded
                    ? "opacity-40 line-through"
                    : "";
                  return (
                    <tr key={r.id} className="hover:bg-muted/30 group">
                      <td
                        className={`pr-3 py-1.5 whitespace-nowrap ${INDENT_CLASS[r.depth]} ${ROW_FONT[r.depth]}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {r.hasChildren ? (
                            <button
                              type="button"
                              onClick={() => toggleCollapsed(r.id)}
                              className="p-0.5 -ml-0.5 rounded hover:bg-muted print:hidden"
                              aria-label={isCollapsed ? "Expand" : "Collapse"}
                            >
                              <Chevron className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                          ) : (
                            <span className="w-[18px] inline-block" />
                          )}
                          <button
                            type="button"
                            onClick={() => toggleExcluded(r.id)}
                            className={`p-0.5 rounded hover:bg-muted print:hidden transition-opacity ${
                              directlyExcluded
                                ? "opacity-100"
                                : "lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100"
                            }`}
                            title={
                              directlyExcluded
                                ? "Include this category in the envelope"
                                : "Exclude this category (and its descendants) from the envelope"
                            }
                            aria-label={directlyExcluded ? "Include" : "Exclude"}
                          >
                            {directlyExcluded ? (
                              <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </button>
                          <span className={fadedCls}>{r.name}</span>
                        </span>
                      </td>
                      <td className={`px-3 py-1.5 text-right tabular-nums text-muted-foreground ${fadedCls}`}>
                        {r.isExcluded ? "—" : formatAUD(r.total)}
                      </td>
                      <td className={`px-3 py-1.5 text-right tabular-nums text-muted-foreground ${fadedCls}`}>
                        {r.isExcluded ? "—" : formatAUD(r.total / months)}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right tabular-nums font-semibold ${
                          r.isExcluded
                            ? "text-muted-foreground"
                            : "text-indigo-600 dark:text-indigo-400"
                        } ${fadedCls}`}
                      >
                        {r.isExcluded ? "—" : formatAUD(r.total / weeks)}
                      </td>
                      <td className={`px-3 py-1.5 text-right tabular-nums text-muted-foreground ${fadedCls}`}>
                        {r.isExcluded ? "—" : formatAUD(r.total / days)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 bg-muted/40 font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatAUD(grandTotal)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatAUD(grandTotal / months)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-indigo-600 dark:text-indigo-400">
                    {formatAUD(grandTotal / weeks)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatAUD(grandTotal / days)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Column header that doubles as a sort toggle. The active column
 * shows an up/down arrow matching `direction`; inactive columns get
 * a neutral double-arrow on hover only, so the header bar stays
 * quiet at rest. `suppressIndicator` lets the numeric piggyback
 * columns (Monthly/Weekly/Daily) defer their arrow to the canonical
 * Period column when the operator's sorted by period. */
function SortableTh({
  align,
  label,
  column,
  activeColumn,
  direction,
  onClick,
  suppressIndicator,
}: {
  align: "left" | "right";
  label: string;
  column: "name" | "period";
  activeColumn: "name" | "period";
  direction: "asc" | "desc";
  onClick: () => void;
  suppressIndicator?: boolean;
}) {
  const isActive = column === activeColumn && !suppressIndicator;
  const Icon = isActive
    ? direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  return (
    <th className={`px-3 py-2 font-medium ${align === "left" ? "text-left" : "text-right"}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition-colors hover:text-foreground focus:outline-none focus:text-foreground ${
          align === "right" ? "ml-auto" : ""
        } ${isActive ? "text-foreground" : ""}`}
        aria-label={`Sort by ${label}`}
      >
        <span>{label}</span>
        <Icon
          className={`h-3 w-3 ${
            isActive ? "opacity-80" : "opacity-30 group-hover:opacity-60"
          }`}
        />
      </button>
    </th>
  );
}
