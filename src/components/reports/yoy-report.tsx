"use client";

import useSWR from "swr";
import { useEffect, useMemo, useState } from "react";
import { subYears, format } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Minus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { formatAUD } from "@/lib/utils";
import {
  startOfFinancialYear,
  endOfFinancialYear,
  financialYearLabel,
} from "@/lib/financial-year";
import type {
  CashflowReport as CashflowData,
  CashflowCategory,
} from "@/app/api/reports/cashflow/route";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const iso = (d: Date) => format(d, "yyyy-MM-dd");

interface HierNode {
  id: string;
  name: string;
  depth: 0 | 1 | 2;
  parentId: string | null;
  type: "income" | "expense";
  ownThis: number;
  ownLast: number;
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

interface Tree {
  nodes: Map<string, HierNode>;
  childrenOf: Map<string, string[]>;
  /** Rolled-up totals: own + every descendant's own. */
  rolledThis: Map<string, number>;
  rolledLast: Map<string, number>;
}

/** Same shape as the envelope report's tree, but with two side-by-side
 * total maps (this FY + last FY) so each row can show both. Synthetic
 * parent/grandparent nodes are filled in when only children appear in
 * the data — matches the envelope-report behaviour. */
function buildTree(
  thisData: CashflowData,
  lastData: CashflowData,
  scope: "expense" | "income" | "all",
): Tree {
  const nodes = new Map<string, HierNode>();

  function ingest(cats: CashflowCategory[], type: "income" | "expense", side: "this" | "last") {
    for (const c of cats) {
      if (scope !== "all" && type !== scope) continue;
      const depth: 0 | 1 | 2 = c.grandparentId ? 2 : c.parentId ? 1 : 0;
      const existing = nodes.get(c.id);
      if (existing) {
        if (side === "this") existing.ownThis += c.total;
        else existing.ownLast += c.total;
      } else {
        nodes.set(c.id, {
          id: c.id,
          name: c.name,
          depth,
          parentId: c.parentId,
          type,
          ownThis: side === "this" ? c.total : 0,
          ownLast: side === "last" ? c.total : 0,
        });
      }
      // Synthesise missing ancestor nodes — the envelope report does
      // the same. Parents/grandparents with no direct activity still
      // need a row so the tree's depth-1/2 children have somewhere
      // to anchor.
      if (c.parentId && !nodes.has(c.parentId)) {
        const pd = (depth - 1) as 0 | 1;
        nodes.set(c.parentId, {
          id: c.parentId,
          name: c.parentName ?? "?",
          depth: pd,
          parentId: pd === 1 ? c.grandparentId : null,
          type,
          ownThis: 0,
          ownLast: 0,
        });
      }
      if (c.grandparentId && !nodes.has(c.grandparentId)) {
        nodes.set(c.grandparentId, {
          id: c.grandparentId,
          name: c.grandparentName ?? "?",
          depth: 0,
          parentId: null,
          type,
          ownThis: 0,
          ownLast: 0,
        });
      }
    }
  }

  ingest(thisData.income, "income", "this");
  ingest(thisData.expenses, "expense", "this");
  ingest(lastData.income, "income", "last");
  ingest(lastData.expenses, "expense", "last");

  const childrenOf = new Map<string, string[]>();
  for (const n of nodes.values()) {
    if (n.parentId) {
      const arr = childrenOf.get(n.parentId) ?? [];
      arr.push(n.id);
      childrenOf.set(n.parentId, arr);
    }
  }

  const rolledThis = new Map<string, number>();
  const rolledLast = new Map<string, number>();
  function rollUp(id: string): { t: number; l: number } {
    const cachedT = rolledThis.get(id);
    const cachedL = rolledLast.get(id);
    if (cachedT != null && cachedL != null) return { t: cachedT, l: cachedL };
    const n = nodes.get(id);
    if (!n) return { t: 0, l: 0 };
    let t = n.ownThis;
    let l = n.ownLast;
    for (const cid of childrenOf.get(id) ?? []) {
      const r = rollUp(cid);
      t += r.t;
      l += r.l;
    }
    rolledThis.set(id, t);
    rolledLast.set(id, l);
    return { t, l };
  }
  for (const id of nodes.keys()) rollUp(id);

  return { nodes, childrenOf, rolledThis, rolledLast };
}

interface RenderRow {
  id: string;
  name: string;
  depth: 0 | 1 | 2;
  type: "income" | "expense";
  thisYear: number;
  lastYear: number;
  delta: number;
  pctDelta: number;
  hasChildren: boolean;
}

/** Flatten the tree to a render list — same shape envelope-report uses.
 * Drops zero-on-both-sides subtrees. Sorts each level's children by
 * |Δ| descending so the biggest movers within each parent lead. */
function flattenForDisplay(
  tree: Tree,
  collapsed: Set<string>,
): RenderRow[] {
  const rows: RenderRow[] = [];
  function walk(id: string) {
    const n = tree.nodes.get(id);
    if (!n) return;
    const thisYear = tree.rolledThis.get(id) ?? 0;
    const lastYear = tree.rolledLast.get(id) ?? 0;
    if (thisYear === 0 && lastYear === 0) return;
    const delta = thisYear - lastYear;
    const pctDelta =
      lastYear !== 0
        ? (delta / Math.abs(lastYear)) * 100
        : thisYear !== 0
          ? Infinity
          : 0;
    const activeKids = (tree.childrenOf.get(id) ?? [])
      .map((cid) => ({
        cid,
        t: tree.rolledThis.get(cid) ?? 0,
        l: tree.rolledLast.get(cid) ?? 0,
      }))
      .filter((x) => x.t !== 0 || x.l !== 0)
      .sort((a, b) => Math.abs(b.t - b.l) - Math.abs(a.t - a.l));
    rows.push({
      id,
      name: n.name,
      depth: n.depth,
      type: n.type,
      thisYear,
      lastYear,
      delta,
      pctDelta,
      hasChildren: activeKids.length > 0,
    });
    if (collapsed.has(id)) return;
    for (const { cid } of activeKids) walk(cid);
  }
  const roots = Array.from(tree.nodes.values())
    .filter((n) => n.depth === 0)
    .filter((n) => {
      const t = tree.rolledThis.get(n.id) ?? 0;
      const l = tree.rolledLast.get(n.id) ?? 0;
      return t !== 0 || l !== 0;
    })
    .sort((a, b) => {
      const da = Math.abs(
        (tree.rolledThis.get(a.id) ?? 0) - (tree.rolledLast.get(a.id) ?? 0),
      );
      const db = Math.abs(
        (tree.rolledThis.get(b.id) ?? 0) - (tree.rolledLast.get(b.id) ?? 0),
      );
      return db - da;
    });
  for (const r of roots) walk(r.id);
  return rows;
}

/** Year-over-year category-totals comparison for the Reports page.
 * Pulls cashflow for the current and previous Australian financial
 * year in parallel and joins them into a single 3-level tree.
 * Same collapse / indent UX as the envelope report — parents start
 * collapsed; click a chevron to drill in.
 *
 * Account filter from the page level is respected; transfer
 * categories follow the same hideTransfers param the cashflow tab
 * uses so the comparison is apples-to-apples. */
export function YoYReport({
  accountIds,
}: {
  accountIds: string[];
}) {
  const [scope, setScope] = useState<"expense" | "income" | "all">("expense");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const { prefs, setPref } = useDisplayPrefs();
  const hideTransfers = prefs.yoyHideTransfers;

  const now = new Date();
  const thisFY = {
    from: iso(startOfFinancialYear(now)),
    to: iso(endOfFinancialYear(now)),
    label: financialYearLabel(now),
  };
  const lastFYAnchor = subYears(now, 1);
  const lastFY = {
    from: iso(startOfFinancialYear(lastFYAnchor)),
    to: iso(endOfFinancialYear(lastFYAnchor)),
    label: financialYearLabel(lastFYAnchor),
  };

  const accountIdsParam =
    accountIds.length > 0 ? `&accountIds=${accountIds.join(",")}` : "";

  const { data: thisData, isLoading: lt } = useSWR<CashflowData>(
    `/api/reports/cashflow?from=${thisFY.from}&to=${thisFY.to}&hideTransfers=${hideTransfers}${accountIdsParam}`,
    fetcher,
  );
  const { data: lastData, isLoading: ll } = useSWR<CashflowData>(
    `/api/reports/cashflow?from=${lastFY.from}&to=${lastFY.to}&hideTransfers=${hideTransfers}${accountIdsParam}`,
    fetcher,
  );

  const tree = useMemo(
    () => (thisData && lastData ? buildTree(thisData, lastData, scope) : null),
    [thisData, lastData, scope],
  );

  // Every time data or scope changes, collapse every parent — the
  // report opens at the depth-0 overview each time, matching the
  // envelope-report behaviour. Click-to-expand stays within the
  // session.
  useEffect(() => {
    if (!tree) return;
    const ids: string[] = [];
    for (const n of tree.nodes.values()) {
      const t = tree.rolledThis.get(n.id) ?? 0;
      const l = tree.rolledLast.get(n.id) ?? 0;
      if (t === 0 && l === 0) continue;
      const hasKids = (tree.childrenOf.get(n.id) ?? []).some((cid) => {
        const ct = tree.rolledThis.get(cid) ?? 0;
        const cl = tree.rolledLast.get(cid) ?? 0;
        return ct !== 0 || cl !== 0;
      });
      if (hasKids) ids.push(n.id);
    }
    setCollapsedIds(new Set(ids));
  }, [tree]);

  function toggleCollapsed(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const rows = useMemo(
    () => (tree ? flattenForDisplay(tree, collapsedIds) : []),
    [tree, collapsedIds],
  );

  const allParentIds = useMemo(() => {
    if (!tree) return [] as string[];
    const ids: string[] = [];
    for (const n of tree.nodes.values()) {
      const hasKids = (tree.childrenOf.get(n.id) ?? []).some((cid) => {
        const ct = tree.rolledThis.get(cid) ?? 0;
        const cl = tree.rolledLast.get(cid) ?? 0;
        return ct !== 0 || cl !== 0;
      });
      if (hasKids) ids.push(n.id);
    }
    return ids;
  }, [tree]);
  const anyCollapsed = allParentIds.some((id) => collapsedIds.has(id));

  if (lt || ll) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Loading year-over-year comparison…
      </p>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">
          Year over year — {thisFY.label} vs {lastFY.label}
        </CardTitle>
        <div className="flex items-center gap-2">
          {allParentIds.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCollapsedIds(
                  anyCollapsed ? new Set() : new Set(allParentIds),
                )
              }
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
          <div className="flex rounded-md border overflow-hidden text-xs">
            {(["expense", "income", "all"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`px-2.5 py-1 capitalize transition-colors ${
                  scope === s
                    ? "bg-indigo-600 text-white font-medium"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {s === "all" ? "Both" : s + "s"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <Switch
              size="sm"
              checked={hideTransfers}
              onCheckedChange={(v) => setPref("yoyHideTransfers", v)}
              aria-label="Hide transfer-typed categories"
            />
            Hide transfers
          </label>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No category activity in either year for the current selection.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-3 py-2 font-medium">Category</th>
                  <th className="text-right px-3 py-2 font-medium">
                    {lastFY.label}
                  </th>
                  <th className="text-right px-3 py-2 font-medium">
                    {thisFY.label}
                  </th>
                  <th className="text-right px-3 py-2 font-medium">Δ</th>
                  <th className="text-right px-3 py-2 font-medium">Δ%</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => {
                  const expense = r.type === "expense";
                  const moreSpend = expense && r.delta < 0;
                  const lessSpend = expense && r.delta > 0;
                  const moreIncome = !expense && r.delta > 0;
                  const lessIncome = !expense && r.delta < 0;
                  const Icon = Math.abs(r.delta) < 1
                    ? Minus
                    : r.delta > 0
                      ? ArrowUp
                      : ArrowDown;
                  const tone =
                    Math.abs(r.delta) < 1
                      ? "text-muted-foreground"
                      : moreSpend || lessIncome
                        ? "text-red-500"
                        : lessSpend || moreIncome
                          ? "text-emerald-600"
                          : "text-muted-foreground";
                  const isCollapsed = collapsedIds.has(r.id);
                  const Chevron = isCollapsed ? ChevronRight : ChevronDown;
                  return (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td
                        className={`pr-3 py-1.5 whitespace-nowrap ${INDENT_CLASS[r.depth]} ${ROW_FONT[r.depth]}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {r.hasChildren ? (
                            <button
                              type="button"
                              onClick={() => toggleCollapsed(r.id)}
                              className="p-0.5 -ml-0.5 rounded hover:bg-muted"
                              aria-label={isCollapsed ? "Expand" : "Collapse"}
                            >
                              <Chevron className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                          ) : (
                            <span className="w-[18px] inline-block" />
                          )}
                          <span>{r.name}</span>
                        </span>
                      </td>
                      <td className="text-right px-3 py-1.5 tabular-nums text-muted-foreground">
                        {formatAUD(r.lastYear)}
                      </td>
                      <td className="text-right px-3 py-1.5 tabular-nums">
                        {formatAUD(r.thisYear)}
                      </td>
                      <td className={`text-right px-3 py-1.5 tabular-nums ${tone}`}>
                        <span className="inline-flex items-center gap-1 justify-end">
                          <Icon className="h-3 w-3" />
                          {formatAUD(Math.abs(r.delta))}
                        </span>
                      </td>
                      <td className={`text-right px-3 py-1.5 tabular-nums text-xs ${tone}`}>
                        {Number.isFinite(r.pctDelta)
                          ? `${r.pctDelta >= 0 ? "+" : ""}${r.pctDelta.toFixed(0)}%`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
