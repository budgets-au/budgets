"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { ResponsiveContainer, Treemap } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { formatAUD } from "@/lib/utils";
import { CATEGORICAL_PALETTE } from "@/lib/colours";
import type {
  CashflowReport as CashflowData,
  CashflowCategory,
} from "@/app/api/reports/cashflow/route";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** Treemap report: category hierarchy at a glance.
 *
 * Rectangles are sized by absolute spend (or income — toggle).
 * Hierarchy: grandparent → parent → leaf, mirroring the
 * cashflow-report join. Colour is picked from
 * `CATEGORICAL_PALETTE`, indexed by the grandparent's position in
 * the rolled-up ranking so siblings of a grandparent share a hue
 * family but with subtle leaf-level distinction (different luma
 * tier handled by Recharts' built-in shading).
 *
 * Reuses the existing `/api/reports/cashflow` payload — no new
 * endpoint. The envelope-report's hierarchy-build pattern is the
 * template (cats may reference parents/grandparents that don't
 * themselves carry a row; synthesise the missing ancestors so the
 * tree is complete).
 *
 * Click-to-drill: clicking a non-leaf rectangle re-roots the tree
 * at that node. "← Back" returns to the top. State is local
 * (no URL persistence) — re-open the tab to reset. */
export function TreemapReport({
  from,
  to,
  accountIds,
  hideTransfers: _hideTransfers,
}: {
  from: string;
  to: string;
  accountIds: string[];
  /** Threaded through for prop-signature parity with the other
   * report tabs; the cashflow API never paid attention to it
   * and the reports already filter via the per-tab eye / exclude
   * UI elsewhere. */
  hideTransfers: boolean;
}) {
  const [scope, setScope] = useState<"expenses" | "income">("expenses");
  const [drillId, setDrillId] = useState<string | null>(null);

  const url = `/api/reports/cashflow?from=${from}&to=${to}${
    accountIds.length > 0 ? `&accountIds=${accountIds.join(",")}` : ""
  }`;
  const { data, isLoading } = useSWR<CashflowData>(url, fetcher);

  const cats: CashflowCategory[] = useMemo(() => {
    if (!data) return [];
    return scope === "expenses" ? data.expenses : data.income;
  }, [data, scope]);

  const tree = useMemo(() => buildTreemapTree(cats), [cats]);
  const totalOfRoot = useMemo(() => {
    if (drillId == null) {
      return tree.roots.reduce((s, n) => s + n.value, 0);
    }
    const n = tree.byId.get(drillId);
    return n?.value ?? 0;
  }, [tree, drillId]);

  // Recharts Treemap takes a flat-nested structure with `children`
  // arrays. We build it from the drilldown's current root.
  const treemapData = useMemo(() => {
    const root = drillId == null ? tree.roots : [tree.byId.get(drillId)!];
    return root.map((n) => toTreemapNode(n));
  }, [tree, drillId]);

  const drillNode = drillId != null ? tree.byId.get(drillId) : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 gap-2">
        <CardTitle className="text-base">
          {scope === "expenses" ? "Expenses" : "Income"} treemap
          {drillNode ? <> · {drillNode.name}</> : null}
        </CardTitle>
        <div className="flex items-center gap-2">
          {drillId != null && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDrillId(null)}
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />
              Back
            </Button>
          )}
          <div
            role="tablist"
            aria-label="Treemap scope"
            className="inline-flex items-center gap-0.5 rounded-md border bg-muted/30 p-0.5"
          >
            {(["expenses", "income"] as const).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={scope === s}
                onClick={() => {
                  setScope(s);
                  setDrillId(null);
                }}
                className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded transition-colors ${
                  scope === s
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            Loading…
          </p>
        ) : treemapData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            No {scope} in the selected window.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              Total: {formatAUD(totalOfRoot)}
              {drillNode && (
                <span>
                  {" "}· {((totalOfRoot / sumRoots(tree.roots)) * 100).toFixed(
                    1,
                  )}
                  % of all {scope}
                </span>
              )}
              {" · click a rectangle to drill in"}
            </p>
            <div style={{ width: "100%", height: 500 }}>
              <ResponsiveContainer width="100%" height="100%">
                <Treemap
                  data={treemapData}
                  dataKey="value"
                  isAnimationActive={false}
                  content={
                    <TreemapTile
                      onDrill={(id, hasChildren) => {
                        if (hasChildren) setDrillId(id);
                      }}
                      totalValue={totalOfRoot}
                    />
                  }
                />
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Recharts' TreemapDataType requires `[key: string]: unknown` so
// it can route arbitrary data fields through to custom tile
// renderers. We satisfy that by extending it on the runtime
// shape — TmNode stays a clean concrete type, the index signature
// is just for Recharts' generics.
interface TmNode extends Record<string, unknown> {
  id: string;
  name: string;
  value: number;
  /** Stable indigo / palette index used by all descendants for
   * colour-family consistency. */
  paletteIndex: number;
  children: TmNode[];
}

function sumRoots(roots: TmNode[]): number {
  return roots.reduce((s, n) => s + n.value, 0);
}

function buildTreemapTree(cats: CashflowCategory[]): {
  roots: TmNode[];
  byId: Map<string, TmNode>;
} {
  // Same shape as envelope-report's buildTree but produces TmNode
  // with `children` (Recharts wants nested arrays).
  const nodes = new Map<
    string,
    {
      id: string;
      name: string;
      ownTotal: number;
      parentId: string | null;
    }
  >();
  for (const c of cats) {
    nodes.set(c.id, {
      id: c.id,
      name: c.name,
      ownTotal: Math.abs(c.total),
      parentId: c.parentId,
    });
    if (c.parentId && !nodes.has(c.parentId)) {
      nodes.set(c.parentId, {
        id: c.parentId,
        name: c.parentName ?? "?",
        ownTotal: 0,
        parentId: c.grandparentId,
      });
    }
    if (c.grandparentId && !nodes.has(c.grandparentId)) {
      nodes.set(c.grandparentId, {
        id: c.grandparentId,
        name: c.grandparentName ?? "?",
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

  const byId = new Map<string, TmNode>();
  function build(id: string, paletteIndex: number): TmNode {
    const n = nodes.get(id)!;
    const kids = childrenOf.get(id) ?? [];
    // Build children first so their values sum into ours.
    const children = kids.map((cid) => build(cid, paletteIndex));
    const childSum = children.reduce((s, c) => s + c.value, 0);
    const value = n.ownTotal + childSum;
    const tm: TmNode = {
      id: n.id,
      name: n.name,
      value,
      paletteIndex,
      children,
    };
    byId.set(id, tm);
    return tm;
  }

  // Sort roots descending by their rolled total so the palette
  // colours pick a deterministic order regardless of insertion.
  const rootIds = Array.from(nodes.values())
    .filter((n) => !n.parentId)
    .map((n) => n.id);
  const tempByTotal = rootIds.map((id) => {
    const kids = childrenOf.get(id) ?? [];
    const own = nodes.get(id)?.ownTotal ?? 0;
    // approximate roll-up for sort
    function approxSum(rid: string): number {
      const cids = childrenOf.get(rid) ?? [];
      let s = nodes.get(rid)?.ownTotal ?? 0;
      for (const cid of cids) s += approxSum(cid);
      return s;
    }
    return { id, total: own + kids.reduce((s, k) => s + approxSum(k), 0) };
  });
  tempByTotal.sort((a, b) => b.total - a.total);
  const roots: TmNode[] = tempByTotal.map(({ id }, i) =>
    build(id, i % CATEGORICAL_PALETTE.length),
  );
  return { roots, byId };
}

function toTreemapNode(n: TmNode): TmNode {
  // Recharts wants children as plain objects with `name`, value
  // key (matches our `dataKey="value"`), optional `children`.
  return {
    ...n,
    children: n.children.map(toTreemapNode),
  };
}

/** Custom tile renderer so we can colour by paletteIndex with a
 * depth-aware luma tweak (deeper = darker), draw the label
 * legibly, and route clicks through to drill-down. */
interface TileProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: TmNode;
  depth?: number;
  onDrill: (id: string, hasChildren: boolean) => void;
  totalValue: number;
}

function TreemapTile(props: TileProps) {
  const { x = 0, y = 0, width = 0, height = 0, payload, depth = 0 } = props;
  if (!payload) return null;
  const colour = CATEGORICAL_PALETTE[payload.paletteIndex];
  // Depth 0 darker, depth 1+ lighter — gives the hierarchy a
  // subtle inside-out shading. Recharts calls TreemapTile for
  // every node in the tree (depths 1..N where N is max depth);
  // depth 0 is the synthetic root container Recharts inserts.
  const opacity = depth <= 1 ? 1 : 0.75;
  const showLabel = width > 56 && height > 24;
  const hasChildren = (payload.children?.length ?? 0) > 0;
  return (
    <g
      onClick={() => props.onDrill(payload.id, hasChildren)}
      style={{ cursor: hasChildren ? "pointer" : "default" }}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={colour}
        fillOpacity={opacity}
        stroke="rgba(0,0,0,0.25)"
        strokeWidth={1}
      />
      {showLabel && (
        <>
          <text
            x={x + 6}
            y={y + 16}
            fill="white"
            fontSize={11}
            fontWeight={600}
            style={{ pointerEvents: "none" }}
          >
            {payload.name}
          </text>
          <text
            x={x + 6}
            y={y + 30}
            fill="rgba(255,255,255,0.85)"
            fontSize={10}
            style={{ pointerEvents: "none" }}
          >
            {formatAUD(payload.value)}
          </text>
        </>
      )}
    </g>
  );
}
