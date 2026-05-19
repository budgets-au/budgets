"use client";

import { useState } from "react";
import useSWR from "swr";
import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { formatAUD } from "@/lib/utils";
import { TREND_UP, TREND_DOWN } from "@/lib/colours";
import {
  ChartTooltipCard,
  ChartTooltipHeader,
  ChartTooltipRow,
} from "@/components/ui/chart-tooltip";

/** Sankey hover surfaces either a node (single value) or a link
 * (source → target with a flow value). Recharts shapes vary by
 * Sankey version, so this tolerates both shapes. */
function SankeyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    name?: string | number;
    value?: number;
    payload?: { source?: { name?: string }; target?: { name?: string }; name?: string };
  }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0];
  const inner = row.payload;
  const source = inner?.source?.name;
  const target = inner?.target?.name;
  const isLink = source != null && target != null;
  return (
    <ChartTooltipCard>
      <ChartTooltipHeader
        title={isLink ? `${source} → ${target}` : String(inner?.name ?? row.name ?? "")}
      />
      <ChartTooltipRow label="Flow" value={formatAUD(Number(row.value ?? 0))} />
    </ChartTooltipCard>
  );
}
import type {
  CashflowReport as CashflowData,
  CashflowCategory,
} from "@/app/api/reports/cashflow/route";

type SankeyScope = "all" | "income" | "expenses";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CategoryDef {
  id: string;
  name: string;
  color: string;
}

interface HierNode {
  id: string;
  name: string;
  depth: 0 | 1 | 2;
  ownTotal: number;
  parentId: string | null;
}

interface Hierarchy {
  nodes: Map<string, HierNode>;
  childrenOf: Map<string, string[]>;
  rolled: Map<string, number>;
  totalSum: number;
}

/** Build a 3-level category tree (depth 0/1/2) from a cashflow side. Each
 * cashflow row carries parent/grandparent ids and the cat's *own* direct
 * total — children's totals come from their own rows. Ancestors that don't
 * appear in the array (e.g. a parent with no direct activity but children
 * that do) are synthesised from descendants' parent/grandparent name fields. */
function buildHierarchy(cats: CashflowCategory[]): Hierarchy {
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
      const parentDepth = (depth - 1) as 0 | 1;
      nodes.set(c.parentId, {
        id: c.parentId,
        name: c.parentName ?? "?",
        depth: parentDepth,
        ownTotal: 0,
        parentId: parentDepth === 1 ? c.grandparentId : null,
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
  for (const node of nodes.values()) {
    if (node.parentId) {
      const arr = childrenOf.get(node.parentId) ?? [];
      arr.push(node.id);
      childrenOf.set(node.parentId, arr);
    }
  }

  const rolled = new Map<string, number>();
  function rollUp(id: string): number {
    const cached = rolled.get(id);
    if (cached != null) return cached;
    const node = nodes.get(id);
    if (!node) return 0;
    let sum = node.ownTotal;
    for (const cid of childrenOf.get(id) ?? []) sum += rollUp(cid);
    rolled.set(id, sum);
    return sum;
  }
  for (const id of nodes.keys()) rollUp(id);

  const totalSum = Array.from(nodes.values())
    .filter((n) => n.depth === 0)
    .reduce((s, n) => s + (rolled.get(n.id) ?? 0), 0);

  return { nodes, childrenOf, rolled, totalSum };
}

interface SankeyNodeDatum {
  name: string;
  value?: number;
}
interface SankeyLinkDatum {
  source: number;
  target: number;
  value: number;
}

interface CustomNodeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  payload?: {
    name: string;
    value: number;
    sourceLinks?: number[];
    targetLinks?: number[];
  };
}

interface ExpandHandlers {
  expandableIdxs: Set<number>;
  expandedIdxs: Set<number>;
  onToggle: (idx: number) => void;
}

interface CustomLinkProps {
  sourceX?: number;
  sourceY?: number;
  targetX?: number;
  targetY?: number;
  sourceControlX?: number;
  targetControlX?: number;
  linkWidth?: number;
  index?: number;
  payload?: {
    source: { name: string };
    target: { name: string };
    value: number;
  };
}

function makeCustomNode(
  isDark: boolean,
  colorsByIdx: string[],
  expand: ExpandHandlers,
) {
  const fillDefault = isDark ? "#475569" : "#94a3b8";
  return function CustomNode(props: CustomNodeProps) {
    const { x, y, width, height, payload, index } = props;
    if (
      x == null ||
      y == null ||
      width == null ||
      height == null ||
      !payload ||
      index == null
    ) {
      return null;
    }
    const fill = colorsByIdx[index] ?? fillDefault;
    // Source nodes (no incoming links) sit at the left edge — put their
    // labels in the LEFT margin so they don't overlap outgoing bands.
    // Everything else gets a label on the right of its rectangle.
    const isSource = (payload.sourceLinks?.length ?? 0) === 0;
    const labelX = isSource ? x - 6 : x + width + 6;
    const isExpandable = expand.expandableIdxs.has(index);
    const isExpanded = expand.expandedIdxs.has(index);
    const handleClick = isExpandable
      ? (e: React.MouseEvent<SVGElement>) => {
          e.stopPropagation();
          expand.onToggle(index);
        }
      : undefined;
    const textAnchor: "start" | "end" = isSource ? "end" : "start";
    const labelFill = isDark ? "#e2e8f0" : "#0f172a";
    const subFill = isDark ? "#94a3b8" : "#64748b";
    // Chevron hint for expandable cats — sits flush against the rect on the
    // OUTGOING-flow side of the node so it points the way the children
    // would appear.
    const chevron = isExpandable
      ? isExpanded
        ? "▾"
        : isSource
          ? "◂"
          : "▸"
      : null;
    // Expandable nodes get a bright outline so they stand out in a crowded
    // chart. Without it the chevron alone is easy to miss.
    const strokeColor = isExpandable ? "#6366f1" : "none";
    const strokeWidth = isExpandable ? 2 : 0;

    // Single-line layout: label nearer the rect, value further out toward
    // the chart edge. Approximate label width with a per-char estimate so
    // we can offset the value's <text> without measuring.
    const labelText = chevron
      ? isSource
        ? `${payload.name} ${chevron}`
        : `${chevron} ${payload.name}`
      : payload.name;
    const valueText = formatAUD(payload.value).replace("A$", "$");
    const APPROX_CHAR_PX = 6.5;
    const labelWidthEst = labelText.length * APPROX_CHAR_PX;
    const valueGap = 8;
    const valueX = isSource
      ? labelX - labelWidthEst - valueGap
      : labelX + labelWidthEst + valueGap;
    const textY = y + height / 2 + 4;

    return (
      <g
        onClick={handleClick}
        style={isExpandable ? { cursor: "pointer" } : undefined}
      >
        <rect
          x={x}
          y={y}
          width={width}
          height={Math.max(2, height)}
          fill={fill}
          fillOpacity={0.95}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
        />
        <text
          x={labelX}
          y={textY}
          textAnchor={textAnchor}
          fontSize={11}
          fontWeight={isExpandable ? 600 : 500}
          fill={isExpandable ? "#6366f1" : labelFill}
        >
          {labelText}
        </text>
        <text
          x={valueX}
          y={textY}
          textAnchor={textAnchor}
          fontSize={10}
          fill={subFill}
        >
          {valueText}
        </text>
      </g>
    );
  };
}

function makeCustomLink(linkColors: string[]) {
  return function CustomLink(props: CustomLinkProps) {
    const {
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourceControlX,
      targetControlX,
      linkWidth,
      index,
    } = props;
    if (
      sourceX == null ||
      sourceY == null ||
      targetX == null ||
      targetY == null ||
      sourceControlX == null ||
      targetControlX == null ||
      linkWidth == null ||
      index == null
    ) {
      return <path d="" />;
    }
    // Each link knows its colour explicitly — the income side's flow runs
    // child→parent, the expense side runs parent→child, so a "non-hub end
    // wins" rule can't pick the right end uniformly. Tracking colour
    // per-link at build time avoids the directional asymmetry.
    const stroke = linkColors[index] ?? "#94a3b8";
    const path = `M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`;
    return (
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={Math.max(1, linkWidth)}
        strokeOpacity={0.45}
      />
    );
  };
}

export function SankeyReport({
  from,
  to,
  accountIds,
}: {
  from: string;
  to: string;
  accountIds: string[];
}) {
  const accountIdsParam =
    accountIds.length > 0 ? `&accountIds=${accountIds.join(",")}` : "";
  const { prefs, setPref } = useDisplayPrefs();
  const hideTransfers = prefs.sankeyHideTransfers;
  const scope: SankeyScope = prefs.reportsSankeyScope;
  function changeScope(next: SankeyScope) {
    setPref("reportsSankeyScope", next);
  }
  const { data, isLoading } = useSWR<CashflowData>(
    `/api/reports/cashflow?from=${from}&to=${to}&hideTransfers=${hideTransfers}${accountIdsParam}`,
    fetcher,
  );
  const { data: allCategories = [] } = useSWR<CategoryDef[]>(
    `/api/categories`,
    fetcher,
  );
  const isDark = useDarkMode();


  // Set of cat ids whose children are revealed. Depth-0 cats are always
  // revealed (showing depth-1 parents) — only depth-1 cats are toggleable
  // here, so the user clicks a parent to bring its grandchildren in.
  const [expandedCatIds, setExpandedCatIds] = useState<Set<string>>(new Set());
  function toggleExpanded(catId: string) {
    setExpandedCatIds((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }
  function expandAll(ids: string[]) {
    setExpandedCatIds(new Set(ids));
  }
  function collapseAll() {
    setExpandedCatIds(new Set());
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

  const incomeTree = buildHierarchy(data.income);
  const expenseTree = buildHierarchy(data.expenses);

  const totalIncome = incomeTree.totalSum;
  const totalExpense = expenseTree.totalSum;
  const surplus = totalIncome - totalExpense;

  if (totalIncome === 0 && totalExpense === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No transactions in this period.
      </p>
    );
  }

  const colorById = new Map<string, string>();
  for (const c of allCategories) colorById.set(c.id, c.color);

  const HUB_TOTAL_INCOME = "#6366f1";
  const HUB_SAVED = TREND_UP;
  const HUB_SAVINGS_DRAWN = "#f59e0b";
  const FALLBACK_INCOME = "#22c55e";
  const FALLBACK_EXPENSE = TREND_DOWN;

  const showIncome = scope === "all" || scope === "income";
  const showExpenses = scope === "all" || scope === "expenses";

  const nodes: SankeyNodeDatum[] = [];
  const links: SankeyLinkDatum[] = [];
  const colorsByIdx: string[] = [];
  const linkColors: string[] = [];
  const catIdsByIdx: (string | null)[] = [];

  function pushNode(name: string, color: string, catId: string | null = null): number {
    const i = nodes.length;
    nodes.push({ name });
    colorsByIdx.push(color);
    catIdsByIdx.push(catId);
    return i;
  }
  function pushLink(source: number, target: number, value: number, color: string) {
    links.push({ source, target, value });
    linkColors.push(color);
  }

  // Visibility cascade:
  //   depth-0 cats: always shown
  //   depth-1 cats: shown only when depth-0 parent is in expandedCatIds
  //   depth-2 cats: shown only when depth-1 parent is in expandedCatIds AND
  //                 the depth-1 parent itself is shown
  // Both depth-0 and depth-1 cats are clickable to reveal the next level.
  function isShown(tree: Hierarchy, catId: string): boolean {
    const node = tree.nodes.get(catId);
    if (!node) return false;
    if ((tree.rolled.get(catId) ?? 0) === 0) return false;
    if (node.depth === 0) return true;
    if (!node.parentId) return false;
    if (!expandedCatIds.has(node.parentId)) return false;
    if (node.depth === 1) return true;
    // depth-2: also requires its depth-1 parent to be shown
    return isShown(tree, node.parentId);
  }
  function hasActiveDepth1Children(tree: Hierarchy, catId: string): boolean {
    return (tree.childrenOf.get(catId) ?? []).some(
      (cid) =>
        (tree.rolled.get(cid) ?? 0) > 0 && tree.nodes.get(cid)?.depth === 1,
    );
  }
  function hasActiveDepth2Children(tree: Hierarchy, catId: string): boolean {
    return (tree.childrenOf.get(catId) ?? []).some(
      (cid) =>
        (tree.rolled.get(cid) ?? 0) > 0 && tree.nodes.get(cid)?.depth === 2,
    );
  }

  // ─── Income side ────────────────────────────────────────────────────────
  const incomeIdToIdx = new Map<string, number>();
  if (showIncome) {
    for (const node of incomeTree.nodes.values()) {
      if (!isShown(incomeTree, node.id)) continue;
      const color = colorById.get(node.id) ?? FALLBACK_INCOME;
      incomeIdToIdx.set(node.id, pushNode(node.name, color, node.id));
    }
  }
  const incomeDirectOwnerToIdx = new Map<string, number>();
  if (showIncome) {
    for (const node of incomeTree.nodes.values()) {
      // Synth-direct: only render when the column it lives in is visible.
      //   depth-0 owner → synth in depth-1 col → needs depth-0 expanded
      //   depth-1 owner → synth in depth-2 col → needs depth-1 shown AND
      //                                          depth-1 expanded
      if (node.ownTotal === 0) continue;
      if (node.depth === 0) {
        if (!expandedCatIds.has(node.id)) continue;
        if (!hasActiveDepth1Children(incomeTree, node.id)) continue;
      } else if (node.depth === 1) {
        if (!isShown(incomeTree, node.id)) continue;
        if (!expandedCatIds.has(node.id)) continue;
        if (!hasActiveDepth2Children(incomeTree, node.id)) continue;
      } else {
        continue;
      }
      const color = colorById.get(node.id) ?? FALLBACK_INCOME;
      incomeDirectOwnerToIdx.set(
        node.id,
        pushNode(`${node.name} (direct)`, color),
      );
    }
  }

  // Savings drawn (only meaningful in "all"+deficit) — sits at the income
  // column to balance the hub.
  let savingsDrawnIdx: number | null = null;
  if (scope === "all" && surplus < 0) {
    savingsDrawnIdx = pushNode("Savings (drawn)", HUB_SAVINGS_DRAWN);
  }

  // Hub. Always present; label depends on scope.
  const hubName = scope === "expenses" ? "Total Expenses" : "Total Income";
  const hubIdx = pushNode(hubName, HUB_TOTAL_INCOME);

  // Saved (only in "all"+surplus) — sink at the next column right.
  let savedIdx: number | null = null;
  if (scope === "all" && surplus > 0) {
    savedIdx = pushNode("Saved", HUB_SAVED);
  }

  // ─── Expense side ───────────────────────────────────────────────────────
  const expenseIdToIdx = new Map<string, number>();
  if (showExpenses) {
    for (const node of expenseTree.nodes.values()) {
      if (!isShown(expenseTree, node.id)) continue;
      const color = colorById.get(node.id) ?? FALLBACK_EXPENSE;
      expenseIdToIdx.set(node.id, pushNode(node.name, color, node.id));
    }
  }
  const expenseDirectOwnerToIdx = new Map<string, number>();
  if (showExpenses) {
    for (const node of expenseTree.nodes.values()) {
      if (node.ownTotal === 0) continue;
      if (node.depth === 0) {
        if (!expandedCatIds.has(node.id)) continue;
        if (!hasActiveDepth1Children(expenseTree, node.id)) continue;
      } else if (node.depth === 1) {
        if (!isShown(expenseTree, node.id)) continue;
        if (!expandedCatIds.has(node.id)) continue;
        if (!hasActiveDepth2Children(expenseTree, node.id)) continue;
      } else {
        continue;
      }
      const color = colorById.get(node.id) ?? FALLBACK_EXPENSE;
      expenseDirectOwnerToIdx.set(
        node.id,
        pushNode(`${node.name} (direct)`, color),
      );
    }
  }

  // ─── Links ──────────────────────────────────────────────────────────────
  if (showIncome) {
    // child → parent within income tree (band coloured by the more-specific
    // child end). Skip when child not shown (its depth-1 parent isn't
    // expanded) — the parent absorbs the rolled total directly.
    for (const node of incomeTree.nodes.values()) {
      if (!node.parentId) continue;
      const r = incomeTree.rolled.get(node.id) ?? 0;
      if (r === 0) continue;
      const childIdx = incomeIdToIdx.get(node.id);
      const parentIdx = incomeIdToIdx.get(node.parentId);
      if (childIdx == null || parentIdx == null) continue;
      pushLink(childIdx, parentIdx, r, colorsByIdx[childIdx]);
    }
    // depth-0 income → hub
    for (const node of incomeTree.nodes.values()) {
      if (node.depth !== 0) continue;
      const r = incomeTree.rolled.get(node.id) ?? 0;
      if (r === 0) continue;
      const idx = incomeIdToIdx.get(node.id);
      if (idx == null) continue;
      pushLink(idx, hubIdx, r, colorsByIdx[idx]);
    }
    // synthetic income (direct) → owner
    for (const [ownerId, directIdx] of incomeDirectOwnerToIdx) {
      const ownerIdx = incomeIdToIdx.get(ownerId);
      const ownerNode = incomeTree.nodes.get(ownerId);
      if (ownerIdx == null || !ownerNode) continue;
      pushLink(directIdx, ownerIdx, ownerNode.ownTotal, colorsByIdx[ownerIdx]);
    }
  }
  if (savingsDrawnIdx !== null) {
    pushLink(savingsDrawnIdx, hubIdx, -surplus, HUB_SAVINGS_DRAWN);
  }
  if (savedIdx !== null) {
    pushLink(hubIdx, savedIdx, surplus, HUB_SAVED);
  }
  if (showExpenses) {
    // hub → depth-0 expenses
    for (const node of expenseTree.nodes.values()) {
      if (node.depth !== 0) continue;
      const r = expenseTree.rolled.get(node.id) ?? 0;
      if (r === 0) continue;
      const idx = expenseIdToIdx.get(node.id);
      if (idx == null) continue;
      pushLink(hubIdx, idx, r, colorsByIdx[idx]);
    }
    // parent → child within expense tree (skipped automatically when child
    // not in expenseIdToIdx because its depth-1 parent is collapsed)
    for (const node of expenseTree.nodes.values()) {
      if (!node.parentId) continue;
      const r = expenseTree.rolled.get(node.id) ?? 0;
      if (r === 0) continue;
      const childIdx = expenseIdToIdx.get(node.id);
      const parentIdx = expenseIdToIdx.get(node.parentId);
      if (childIdx == null || parentIdx == null) continue;
      pushLink(parentIdx, childIdx, r, colorsByIdx[childIdx]);
    }
    // owner → synthetic expense (direct)
    for (const [ownerId, directIdx] of expenseDirectOwnerToIdx) {
      const ownerIdx = expenseIdToIdx.get(ownerId);
      const ownerNode = expenseTree.nodes.get(ownerId);
      if (ownerIdx == null || !ownerNode) continue;
      pushLink(ownerIdx, directIdx, ownerNode.ownTotal, colorsByIdx[ownerIdx]);
    }
  }

  // ─── Expansion: which node indices can be toggled, and which are open ──
  // depth-0 cats with depth-1 children → reveal depth-1 on click
  // depth-1 cats with depth-2 children → reveal depth-2 on click
  const expandableIdxs = new Set<number>();
  const expandedIdxs = new Set<number>();
  for (let i = 0; i < catIdsByIdx.length; i++) {
    const catId = catIdsByIdx[i];
    if (!catId) continue;
    const tree = incomeTree.nodes.has(catId)
      ? incomeTree
      : expenseTree.nodes.has(catId)
        ? expenseTree
        : null;
    if (!tree) continue;
    const node = tree.nodes.get(catId);
    if (!node) continue;
    let canExpand = false;
    if (node.depth === 0 && hasActiveDepth1Children(tree, catId))
      canExpand = true;
    else if (node.depth === 1 && hasActiveDepth2Children(tree, catId))
      canExpand = true;
    if (!canExpand) continue;
    expandableIdxs.add(i);
    if (expandedCatIds.has(catId)) expandedIdxs.add(i);
  }
  function onToggleByIdx(idx: number) {
    const catId = catIdsByIdx[idx];
    if (!catId) return;
    toggleExpanded(catId);
  }
  const expand: ExpandHandlers = {
    expandableIdxs,
    expandedIdxs,
    onToggle: onToggleByIdx,
  };

  // For the "Expand all" button — every cat id at depth 0 or 1 whose subtree
  // has active children. Iterates the trees directly (rather than catIdsByIdx)
  // so a fully-collapsed chart still has access to the full expansion target
  // set.
  const allExpandableCatIds: string[] = [];
  function collectExpandable(tree: Hierarchy) {
    for (const node of tree.nodes.values()) {
      if (node.depth === 0 && hasActiveDepth1Children(tree, node.id))
        allExpandableCatIds.push(node.id);
      else if (node.depth === 1 && hasActiveDepth2Children(tree, node.id))
        allExpandableCatIds.push(node.id);
    }
  }
  if (showIncome) collectExpandable(incomeTree);
  if (showExpenses) collectExpandable(expenseTree);
  const anyExpanded = allExpandableCatIds.some((id) => expandedCatIds.has(id));
  const allExpanded =
    allExpandableCatIds.length > 0 &&
    allExpandableCatIds.every((id) => expandedCatIds.has(id));

  const summaryParts: string[] = [
    `Income ${formatAUD(totalIncome).replace("A$", "$")}`,
    `Expenses ${formatAUD(totalExpense).replace("A$", "$")}`,
    surplus >= 0
      ? `Saved ${formatAUD(surplus).replace("A$", "$")}`
      : `Deficit ${formatAUD(-surplus).replace("A$", "$")}`,
  ];

  const hasContent = links.length > 0;

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Money flow
            </p>
            <div className="flex rounded-md border overflow-hidden text-xs">
              {(["all", "income", "expenses"] as SankeyScope[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => changeScope(s)}
                  className={`px-2.5 py-1 transition-colors capitalize ${
                    scope === s
                      ? "bg-indigo-600 text-white font-medium"
                      : "bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            {allExpandableCatIds.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  anyExpanded ? collapseAll() : expandAll(allExpandableCatIds)
                }
                className="text-xs px-2.5 py-1 border rounded-md hover:bg-muted transition-colors"
                title="Click an outlined parent in the chart to expand its children, or use this to toggle all at once."
              >
                {allExpanded
                  ? "Collapse all"
                  : anyExpanded
                    ? "Collapse all"
                    : "Expand all children"}
              </button>
            )}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <Switch
                size="sm"
                checked={hideTransfers}
                onCheckedChange={(v) => setPref("sankeyHideTransfers", v)}
                aria-label="Hide transfer-typed categories"
              />
              Hide transfers
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            {summaryParts.join(" · ")}
          </p>
        </div>
        {!hasContent ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No {scope === "income" ? "income" : scope === "expenses" ? "expenses" : "transactions"} in this period.
          </p>
        ) : (
          <div
            style={{
              width: "100%",
              // Fit the rest of the viewport (within sane bounds) — Sankey
              // needs a fixed parent height so ResponsiveContainer can lay
              // nodes out vertically. Bands get thinner with more leaves but
              // the chart never overflows the window.
              height: "clamp(360px, calc(100vh - 280px), 720px)",
            }}
          >
            <ResponsiveContainer>
              <Sankey
                data={{ nodes, links }}
                nodeWidth={12}
                nodePadding={16}
                linkCurvature={0.5}
                iterations={64}
                // align="left" keeps each cat at its own depth column
                // instead of pushing collapsed leaves to the right edge —
                // expanding one cat no longer shuffles the others around
                // the chart.
                align="left"
                margin={{ top: 8, right: 140, bottom: 8, left: 140 }}
                node={makeCustomNode(isDark, colorsByIdx, expand)}
                link={makeCustomLink(linkColors)}
              >
                <Tooltip content={<SankeyTooltip />} />
              </Sankey>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
