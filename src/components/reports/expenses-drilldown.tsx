"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChevronDown, ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { amountClass, formatAUD, formatDate } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CategoryRow {
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categoryType: string | null;
  categoryParentId: string | null;
  total: string;
  count: string;
}

interface CategoryDef {
  id: string;
  name: string;
  type: string;
  color: string;
  parentId: string | null;
  transferKind?: "none" | "internal" | "external";
}

interface TxnRow {
  id: string;
  date: string;
  amount: string;
  payee: string | null;
  description: string | null;
  accountName: string | null;
  accountColor: string | null;
  categoryId: string | null;
  categoryName: string | null;
}

const PIE_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#f43f5e",
];

const UNCAT_ID = "__uncat__";

export function ExpensesDrilldown({
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

  const { data: catData = [] } = useSWR<CategoryRow[]>(
    `/api/reports?groupBy=category&from=${from}&to=${to}&hideTransfers=${hideTransfers}${accountIdsParam}`,
    fetcher,
  );
  const { data: allCategories = [] } = useSWR<CategoryDef[]>(
    `/api/categories`,
    fetcher,
  );

  // Drill-down stack — the path of category ids the user has clicked into.
  // Empty = top level (all expense roots). Last item = the current view's
  // node; we show its direct children.
  const [path, setPath] = useState<string[]>([]);
  // Show/hide the transactions panel — collapsed by default so the
  // breakdown stays the focus until the user explicitly asks for the rows.
  const [showTxns, setShowTxns] = useState(false);

  const tree = useMemo(() => {
    // Index everything we need to roll up by ancestry. Leaf totals come from
    // catData (one row per categoryId that had any txns); the full category
    // list gives us parent links for nodes that have no direct txns but do
    // have descendants. Uncategorised txns are bucketed under UNCAT_ID.
    const catById = new Map<string, CategoryDef>();
    for (const c of allCategories) catById.set(c.id, c);

    interface Node {
      id: string;
      name: string;
      color: string;
      parentId: string | null;
      transferKind: "none" | "internal" | "external";
      isExpense: boolean;
      ownTotal: number;
      ownCount: number;
      subtreeTotal: number;
      subtreeCount: number;
      childrenIds: string[];
    }
    const nodes = new Map<string, Node>();
    function ensure(c: CategoryDef): Node {
      let n = nodes.get(c.id);
      if (!n) {
        n = {
          id: c.id,
          name: c.name,
          color: c.color,
          parentId: c.parentId,
          transferKind: c.transferKind ?? "none",
          isExpense: c.type === "expense",
          ownTotal: 0,
          ownCount: 0,
          subtreeTotal: 0,
          subtreeCount: 0,
          childrenIds: [],
        };
        nodes.set(c.id, n);
      }
      return n;
    }
    for (const c of allCategories) ensure(c);
    // Wire children lists
    for (const n of nodes.values()) {
      if (n.parentId && nodes.has(n.parentId)) {
        nodes.get(n.parentId)!.childrenIds.push(n.id);
      }
    }
    // Apply leaf totals from the report API
    let uncatTotal = 0;
    let uncatCount = 0;
    for (const r of catData) {
      const tot = parseFloat(r.total);
      const cnt = parseInt(r.count);
      if (!r.categoryId) {
        uncatTotal += tot;
        uncatCount += cnt;
        continue;
      }
      const n = nodes.get(r.categoryId);
      if (!n) continue;
      n.ownTotal += tot;
      n.ownCount += cnt;
    }
    // Roll up subtree totals (post-order over the parent chain).
    function rollup(id: string, visited: Set<string>): { t: number; c: number } {
      if (visited.has(id)) return { t: 0, c: 0 };
      visited.add(id);
      const n = nodes.get(id);
      if (!n) return { t: 0, c: 0 };
      let t = n.ownTotal;
      let c = n.ownCount;
      for (const childId of n.childrenIds) {
        const sub = rollup(childId, visited);
        t += sub.t;
        c += sub.c;
      }
      n.subtreeTotal = t;
      n.subtreeCount = c;
      return { t, c };
    }
    for (const n of nodes.values()) {
      if (!n.parentId) rollup(n.id, new Set());
    }

    return { nodes, uncatTotal, uncatCount };
  }, [catData, allCategories]);

  // What's the current view? Either:
  //   path.length === 0  → top-level expense rollup (all expense roots)
  //   path.length > 0    → children of the last node in path. The last id
  //                        may be UNCAT_ID, a virtual node for txns with
  //                        no categoryId — handled in parallel below.
  const currentNodeId = path[path.length - 1] ?? null;
  const currentIsUncat = currentNodeId === UNCAT_ID;
  const currentNode =
    currentNodeId && !currentIsUncat ? tree.nodes.get(currentNodeId) ?? null : null;
  const currentLabel = currentIsUncat
    ? "Uncategorised"
    : currentNode?.name ?? null;

  const breadcrumbs = useMemo(() => {
    const out: { id: string | null; label: string }[] = [
      { id: null, label: "All expenses" },
    ];
    for (const id of path) {
      if (id === UNCAT_ID) {
        out.push({ id, label: "Uncategorised" });
        continue;
      }
      const n = tree.nodes.get(id);
      if (n) out.push({ id, label: n.name });
    }
    return out;
  }, [path, tree.nodes]);

  // Which node's children populate the breakdown card. When the current
  // scope is a leaf (or Uncategorised), there's nothing to break down — so
  // we step UP a level and show the surrounding siblings instead, with the
  // current node highlighted. That keeps the chart + list stable while the
  // user pages between siblings/leaves with transactions open.
  const listSourceNode =
    currentNode && currentNode.childrenIds.length === 0
      ? currentNode.parentId
        ? tree.nodes.get(currentNode.parentId) ?? null
        : null
      : currentNode;
  const listSourceIsTopLevel = !listSourceNode;
  const listSourceIsUncat = currentIsUncat && !listSourceNode;
  const listLabel = listSourceNode?.name ?? null;

  // Children to display in the breakdown card.
  const childRows = useMemo(() => {
    interface Row {
      id: string;
      name: string;
      color: string;
      total: number;
      count: number;
      hasChildren: boolean;
      isExpense: boolean;
    }
    const rows: Row[] = [];
    if (listSourceNode) {
      for (const childId of listSourceNode.childrenIds) {
        const n = tree.nodes.get(childId);
        if (!n) continue;
        if (n.subtreeTotal === 0) continue;
        rows.push({
          id: n.id,
          name: n.name,
          color: n.color,
          total: n.subtreeTotal,
          count: n.subtreeCount,
          hasChildren: n.childrenIds.length > 0,
          isExpense: n.isExpense,
        });
      }
    } else if (listSourceIsTopLevel) {
      // Top level: every expense root.
      for (const n of tree.nodes.values()) {
        if (n.parentId) continue;
        if (!n.isExpense) continue;
        if (n.subtreeTotal === 0) continue;
        rows.push({
          id: n.id,
          name: n.name,
          color: n.color,
          total: n.subtreeTotal,
          count: n.subtreeCount,
          hasChildren: n.childrenIds.length > 0,
          isExpense: true,
        });
      }
      if (tree.uncatTotal > 0) {
        rows.push({
          id: UNCAT_ID,
          name: "Uncategorised",
          color: "#94a3b8",
          total: tree.uncatTotal,
          count: tree.uncatCount,
          hasChildren: false,
          isExpense: true,
        });
      }
    }
    rows.sort((a, b) => b.total - a.total);
    return rows;
    // listSourceIsUncat referenced to keep the dep stable; it doesn't
    // change row contents independent of currentNode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listSourceNode, listSourceIsTopLevel, listSourceIsUncat, tree]);

  const scopeTotal = currentIsUncat
    ? tree.uncatTotal
    : currentNode
      ? currentNode.subtreeTotal
      : childRows.reduce((s, r) => s + r.total, 0);
  const scopeCount = currentIsUncat
    ? tree.uncatCount
    : currentNode
      ? currentNode.subtreeCount
      : childRows.reduce((s, r) => s + r.count, 0);

  // Denominator for the breakdown rows' percentages: the parent of the rows
  // we're displaying. When the user has drilled into a leaf, the rows
  // shown are the leaf's siblings (one level up), so percentages must be
  // against THAT level's total — not the leaf's. Otherwise sibling rows
  // could read >100% and the highlighted current leaf reads ~100%.
  const listScopeTotal = listSourceNode
    ? listSourceNode.subtreeTotal
    : childRows.reduce((s, r) => s + r.total, 0);

  // Transactions list — fetch only when at a leaf node, or when the user
  // explicitly drilled into a category. Top level shows aggregate only.
  const txnCategoryParam = currentNodeId
    ? currentNodeId === UNCAT_ID
      ? `&categoryId=__uncat__`
      : `&categoryId=${currentNodeId}&includeChildren=true`
    : "";
  const txnAccountsParam =
    accountIds.length > 0 ? `&accountIds=${accountIds.join(",")}` : "";
  const txnHideTransfersParam = hideTransfers ? `&hideTransfers=true` : "";
  const { data: txns = [] } = useSWR<TxnRow[]>(
    currentNodeId && showTxns
      ? `/api/transactions?from=${from}&to=${to}${txnAccountsParam}${txnCategoryParam}${txnHideTransfersParam}&direction=out&limit=500`
      : null,
    fetcher,
  );

  return (
    <div className="space-y-4">
      {/* Print/breadcrumb header — survives print, controls don't. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex items-center gap-1 text-sm flex-wrap">
          {breadcrumbs.map((b, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span key={b.id ?? "root"} className="flex items-center gap-1">
                {i > 0 && (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <button
                  type="button"
                  onClick={() => setPath(path.slice(0, i))}
                  disabled={isLast}
                  className={
                    isLast
                      ? "font-medium"
                      : "text-muted-foreground hover:text-foreground hover:underline"
                  }
                >
                  {b.label}
                </button>
              </span>
            );
          })}
        </nav>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.print()}
          className="print:hidden"
        >
          <Printer className="h-4 w-4 mr-1.5" /> Print
        </Button>
      </div>

      {/* Summary bar */}
      <Card>
        <CardContent className="py-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Period</p>
            <p className="font-medium">
              {formatDate(from)} – {formatDate(to)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="font-medium text-red-500">{formatAUD(scopeTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Transactions</p>
            <p className="font-medium">{scopeCount}</p>
          </div>
          {currentLabel && (
            <div>
              <p className="text-xs text-muted-foreground">Scope</p>
              <p className="font-medium">{currentLabel}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pie + child list — when the current scope is a leaf the chart shows
          its surrounding siblings (one level up) with the leaf highlighted,
          so the user keeps a stable visual context as they page through
          leaves with the transactions panel open. */}
      {childRows.length > 0 && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {listLabel ? `${listLabel} breakdown` : "Top categories"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={childRows.map((r) => ({ name: r.name, value: r.total }))}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  dataKey="value"
                  label={({ percent }) =>
                    (percent ?? 0) > 0.05
                      ? `${((percent ?? 0) * 100).toFixed(0)}%`
                      : ""
                  }
                >
                  {childRows.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatAUD(Number(v ?? 0))} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {listLabel ? "Sub-categories" : "Categories"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(path.length > 0 || listSourceNode !== currentNode) && (
              <button
                type="button"
                onClick={() => setPath(path.slice(0, -1))}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back to {listSourceNode?.name ?? "All expenses"}
              </button>
            )}
            <ul className="divide-y">
              {childRows.map((r, i) => {
                const pct = listScopeTotal > 0 ? (r.total / listScopeTotal) * 100 : 0;
                // Leaf categories (no further children) and Uncategorised
                // only do anything useful when the transactions panel is
                // open — drilling in just changes the breadcrumb otherwise.
                // Disable them so the user doesn't end up at an empty page.
                const isLeaf = !r.hasChildren || r.id === UNCAT_ID;
                const drillable = !isLeaf || showTxns;
                const isCurrent = r.id === currentNodeId;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (drillable) setPath([...path, r.id]);
                      }}
                      disabled={!drillable || isCurrent}
                      className={`w-full flex items-center justify-between gap-3 py-2 text-left ${
                        isCurrent
                          ? "bg-indigo-500/10 ring-1 ring-indigo-500/40 rounded-md px-2"
                          : drillable
                            ? "hover:bg-muted/50 cursor-pointer"
                            : "cursor-default opacity-70"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{
                            backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
                          }}
                        />
                        <span className="truncate">{r.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          ({r.count})
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
                          {pct.toFixed(0)}%
                        </span>
                        <span className="font-medium text-red-500 tabular-nums w-24 text-right">
                          {formatAUD(r.total)}
                        </span>
                        {drillable && (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
      )}

      {/* Transactions — only when drilled in. Header doubles as a toggle so
          the user can expand/collapse the table on demand (printing follows
          whichever state they leave it in). */}
      {currentNodeId && (
        <Card>
          <CardHeader>
            <button
              type="button"
              onClick={() => setShowTxns((v) => !v)}
              className="w-full flex items-center justify-between gap-2 text-left"
              aria-expanded={showTxns}
            >
              <CardTitle className="text-base">
                Transactions {currentLabel ? `· ${currentLabel}` : ""}
              </CardTitle>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {showTxns ? "Hide" : "Show"}
                {showTxns ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </span>
            </button>
          </CardHeader>
          {showTxns && (
          <CardContent>
            {txns.length === 0 ? (
              <p className="text-muted-foreground text-sm py-6 text-center">
                No transactions in this scope.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b bg-muted/50 text-xs text-muted-foreground font-medium">
                      <th className="text-left px-3 py-2 whitespace-nowrap w-[100px]">
                        Date
                      </th>
                      <th className="text-left px-3 py-2 whitespace-nowrap w-[120px]">
                        Account
                      </th>
                      <th className="text-left px-3 py-2 w-[160px]">Category</th>
                      <th className="text-left px-3 py-2 w-full">Payee</th>
                      <th className="text-right px-3 py-2 whitespace-nowrap">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {txns.map((t) => (
                      <tr key={t.id} className="group hover:bg-muted/30">
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(t.date)}
                        </td>
                        <td className="px-3 py-2">
                          {t.accountName && (
                            <span
                              className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap"
                              style={{
                                backgroundColor: t.accountColor ?? "#94a3b8",
                              }}
                            >
                              {t.accountName}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {t.categoryName ?? "—"}
                        </td>
                        <td
                          className="px-3 py-2 max-w-0"
                          title={t.payee ?? t.description ?? undefined}
                        >
                          <div className="truncate">
                            {t.payee || t.description || "—"}
                          </div>
                        </td>
                        <td
                          className={`px-3 py-2 text-right whitespace-nowrap tabular-nums ${amountClass(t.amount)}`}
                        >
                          {formatAUD(t.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
