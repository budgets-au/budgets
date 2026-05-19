"use client";

import { useMemo, useState } from "react";
import { useSwrJson } from "@/hooks/use-swr-json";
import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  ChartTooltipCard,
  ChartTooltipHeader,
  ChartTooltipRow,
} from "@/components/ui/chart-tooltip";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { formatAUD } from "@/lib/utils";
import type { AccountsCashflowReport } from "@/app/api/reports/accounts-cashflow/route";


const EXTERNAL_ID = "__external__";
const EXTERNAL_COLOR_LIGHT = "#94a3b8";
const EXTERNAL_COLOR_DARK = "#475569";

interface AccountRow {
  id: string;
  name: string;
  color: string | null;
  isArchived: boolean | number;
}

interface FlowLink {
  sourceAccountId: string;
  targetAccountId: string;
  value: number;
}

type NodeColumn = "left" | "middle" | "right";

interface SankeyNodeDatum {
  name: string;
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

interface CustomLinkProps {
  sourceX?: number;
  sourceY?: number;
  targetX?: number;
  targetY?: number;
  sourceControlX?: number;
  targetControlX?: number;
  linkWidth?: number;
  index?: number;
}

function FlowTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    name?: string | number;
    value?: number;
    payload?: {
      source?: { name?: string };
      target?: { name?: string };
      name?: string;
    };
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
        title={
          isLink
            ? `${source} → ${target}`
            : String(inner?.name ?? row.name ?? "")
        }
      />
      <ChartTooltipRow label="Flow" value={formatAUD(Number(row.value ?? 0))} />
    </ChartTooltipCard>
  );
}

function makeCustomNode(
  isDark: boolean,
  colorsByIdx: string[],
  labelsByIdx: string[],
  colByIdx: NodeColumn[],
) {
  const fillDefault = isDark ? EXTERNAL_COLOR_DARK : EXTERNAL_COLOR_LIGHT;
  return function CustomNode(props: CustomNodeProps) {
    const { x, y, width, height, index } = props;
    if (
      x == null ||
      y == null ||
      width == null ||
      height == null ||
      index == null
    ) {
      return null;
    }
    const fill = colorsByIdx[index] ?? fillDefault;
    const col = colByIdx[index] ?? "right";
    // Left-col nodes get labels in the left margin; right-col nodes get
    // labels in the right margin; middle (root) node sits above the
    // rectangle so the labels don't collide with the ribbons converging
    // on it from both sides.
    const isLeft = col === "left";
    const isMiddle = col === "middle";
    const labelX = isMiddle
      ? x + width / 2
      : isLeft
        ? x - 6
        : x + width + 6;
    const textAnchor: "start" | "middle" | "end" = isMiddle
      ? "middle"
      : isLeft
        ? "end"
        : "start";
    const labelFill = isDark ? "#e2e8f0" : "#0f172a";
    const subFill = isDark ? "#94a3b8" : "#64748b";
    const name = labelsByIdx[index] ?? "";
    const valueText = formatAUD(
      Number(props.payload?.value ?? 0) || 0,
    ).replace("A$", "$");
    const APPROX_CHAR_PX = 6.5;
    const labelWidthEst = name.length * APPROX_CHAR_PX;
    const valueGap = 8;
    const labelY = isMiddle ? y - 8 : y + height / 2 + 4;
    const valueY = isMiddle ? y + height + 12 : labelY;
    const valueX = isMiddle
      ? x + width / 2
      : isLeft
        ? labelX - labelWidthEst - valueGap
        : labelX + labelWidthEst + valueGap;
    const valueAnchor: "start" | "middle" | "end" = isMiddle
      ? "middle"
      : textAnchor;
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={Math.max(2, height)}
          fill={fill}
          fillOpacity={0.95}
          stroke={isMiddle ? "#6366f1" : "none"}
          strokeWidth={isMiddle ? 2 : 0}
        />
        <text
          x={labelX}
          y={labelY}
          textAnchor={textAnchor}
          fontSize={isMiddle ? 12 : 11}
          fontWeight={isMiddle ? 600 : 500}
          fill={isMiddle ? "#6366f1" : labelFill}
        >
          {name}
        </text>
        <text
          x={valueX}
          y={valueY}
          textAnchor={valueAnchor}
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

export function TransferFlowReport({
  from,
  to,
  accountIds,
}: {
  from: string;
  to: string;
  accountIds: string[];
}) {
  const [rootAccountId, setRootAccountId] = useState<string>("all");
  const [hideExternal, setHideExternal] = useState(false);

  // Data fetch:
  //   "all" mode  → sidebar account filter applies (multi-account view).
  //   root mode   → fetch ONLY the root account, ignoring sidebar — the
  //                 view is about that account's own perspective and
  //                 the sidebar's role is secondary. Root's
  //                 transferInBy/transferOutBy carry every counterparty
  //                 (including non-filtered & archived accounts), so a
  //                 single fetch is enough.
  const fetchAccountIdsParam =
    rootAccountId !== "all"
      ? `&accountIds=${rootAccountId}`
      : accountIds.length > 0
        ? `&accountIds=${accountIds.join(",")}`
        : "";
  const { data, isLoading } = useSwrJson<AccountsCashflowReport>(
    `/api/reports/accounts-cashflow?from=${from}&to=${to}${fetchAccountIdsParam}`,
  );
  // The picker shows every non-archived account, not just the ones the
  // sidebar filter has restricted the report to — letting the operator
  // pivot to a specific account without first clearing the sidebar.
  const { data: allAccounts = [] } = useSwrJson<AccountRow[]>(
    `/api/accounts`,
  );
  const isDark = useDarkMode();

  // Lookup table for every account that might be referenced. The cashflow
  // payload may be narrow (a single root account) so /api/accounts is the
  // authoritative name/color source for counterparties.
  const accountMeta = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const a of allAccounts) {
      map.set(a.id, { name: a.name, color: a.color ?? "#94a3b8" });
    }
    if (data) {
      // Add each filtered account by id (current view's primary
      // sources/destinations).
      for (const a of data.accounts) {
        map.set(a.id, { name: a.name, color: a.color });
      }
      // The counterparty breakdowns on each account already carry the
      // OTHER end's name + color — server resolves them from a full
      // accounts scan that INCLUDES archived rows. So an archived
      // account showing up as a counterparty here gets a proper label
      // even though /api/accounts (non-archived default) skipped it.
      for (const a of data.accounts) {
        for (const cp of a.transferInBy) {
          if (cp.counterpartyId == null) continue;
          if (map.has(cp.counterpartyId)) continue;
          map.set(cp.counterpartyId, {
            name: cp.counterpartyName,
            color: cp.counterpartyColor ?? "#94a3b8",
          });
        }
        for (const cp of a.transferOutBy) {
          if (cp.counterpartyId == null) continue;
          if (map.has(cp.counterpartyId)) continue;
          map.set(cp.counterpartyId, {
            name: cp.counterpartyName,
            color: cp.counterpartyColor ?? "#94a3b8",
          });
        }
      }
    }
    return map;
  }, [allAccounts, data]);

  // Build links from the cashflow payload. In "all" mode we walk every
  // filtered account's outbound list, plus inbound from counterparties
  // NOT in the filter (so a non-filtered account paying a filtered one
  // still shows up — same convention the Accounts report uses for its
  // per-counterparty transfer rows). In root mode the root's own in/out
  // arrays carry every leg directly; no dedupe needed because root is
  // the only account we walked.
  const rawLinks: FlowLink[] = useMemo(() => {
    if (!data) return [];
    const out: FlowLink[] = [];
    if (rootAccountId !== "all") {
      const root = data.accounts.find((a) => a.id === rootAccountId);
      if (!root) return [];
      for (const cp of root.transferInBy) {
        if (cp.total <= 0) continue;
        out.push({
          sourceAccountId: cp.counterpartyId ?? EXTERNAL_ID,
          targetAccountId: root.id,
          value: cp.total,
        });
      }
      for (const cp of root.transferOutBy) {
        if (cp.total <= 0) continue;
        out.push({
          sourceAccountId: root.id,
          targetAccountId: cp.counterpartyId ?? EXTERNAL_ID,
          value: cp.total,
        });
      }
      return out;
    }
    const filteredIds = new Set(data.accounts.map((a) => a.id));
    for (const a of data.accounts) {
      for (const cp of a.transferOutBy) {
        if (cp.total <= 0) continue;
        out.push({
          sourceAccountId: a.id,
          targetAccountId: cp.counterpartyId ?? EXTERNAL_ID,
          value: cp.total,
        });
      }
      for (const cp of a.transferInBy) {
        if (cp.total <= 0) continue;
        // If the other end IS in the filter, that account's own
        // transferOutBy already captured this leg above — skip to
        // avoid double-counting. External (counterpartyId == null) is
        // always kept since External has no out-list of its own.
        if (cp.counterpartyId !== null && filteredIds.has(cp.counterpartyId))
          continue;
        out.push({
          sourceAccountId: cp.counterpartyId ?? EXTERNAL_ID,
          targetAccountId: a.id,
          value: cp.total,
        });
      }
    }
    return out;
  }, [data, rootAccountId]);

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

  // Apply hide-external to the raw links.
  let links = rawLinks;
  if (hideExternal) {
    links = links.filter(
      (l) =>
        l.sourceAccountId !== EXTERNAL_ID && l.targetAccountId !== EXTERNAL_ID,
    );
  }

  const pickerAccounts = [...allAccounts]
    .filter((a) => !a.isArchived)
    .sort((x, y) => x.name.localeCompare(y.name));

  const isRootMode = rootAccountId !== "all";
  const hasContent = links.length > 0;

  // Node layout depends on mode:
  //   all  → split each participating account into a left "source"
  //          node + a right "destination" node so cycles (A→B and
  //          B→A in the same window) lay out cleanly left-to-right.
  //   root → 3 columns: left = sources flowing into root,
  //          middle = root itself (a single shared node — both target
  //          of left-side links AND source of right-side links so the
  //          ribbons converge then diverge), right = destinations.
  const nodes: SankeyNodeDatum[] = [];
  const colorsByIdx: string[] = [];
  const labelsByIdx: string[] = [];
  const colByIdx: NodeColumn[] = [];
  const leftIdxByAccount = new Map<string, number>();
  const rightIdxByAccount = new Map<string, number>();
  let rootIdx = -1;

  function metaFor(id: string): { name: string; color: string } {
    if (id === EXTERNAL_ID) {
      return {
        name: "External",
        color: isDark ? EXTERNAL_COLOR_DARK : EXTERNAL_COLOR_LIGHT,
      };
    }
    return (
      accountMeta.get(id) ?? {
        name: "Unknown",
        color: isDark ? EXTERNAL_COLOR_DARK : EXTERNAL_COLOR_LIGHT,
      }
    );
  }
  function pushNode(id: string, col: NodeColumn): number {
    const meta = metaFor(id);
    const i = nodes.length;
    nodes.push({ name: meta.name });
    colorsByIdx.push(meta.color);
    labelsByIdx.push(meta.name);
    colByIdx.push(col);
    return i;
  }
  function ensureLeftNode(id: string): number {
    const existing = leftIdxByAccount.get(id);
    if (existing != null) return existing;
    const i = pushNode(id, "left");
    leftIdxByAccount.set(id, i);
    return i;
  }
  function ensureRightNode(id: string): number {
    const existing = rightIdxByAccount.get(id);
    if (existing != null) return existing;
    const i = pushNode(id, "right");
    rightIdxByAccount.set(id, i);
    return i;
  }
  function ensureRootNode(id: string): number {
    if (rootIdx >= 0) return rootIdx;
    rootIdx = pushNode(id, "middle");
    return rootIdx;
  }

  const sankeyLinks: SankeyLinkDatum[] = [];
  const linkColors: string[] = [];
  for (const l of links) {
    let sIdx: number;
    let tIdx: number;
    if (isRootMode) {
      if (l.sourceAccountId === rootAccountId) {
        sIdx = ensureRootNode(rootAccountId);
        tIdx = ensureRightNode(l.targetAccountId);
      } else if (l.targetAccountId === rootAccountId) {
        sIdx = ensureLeftNode(l.sourceAccountId);
        tIdx = ensureRootNode(rootAccountId);
      } else {
        continue;
      }
    } else {
      sIdx = ensureLeftNode(l.sourceAccountId);
      tIdx = ensureRightNode(l.targetAccountId);
    }
    sankeyLinks.push({ source: sIdx, target: tIdx, value: l.value });
    // Tint each ribbon by the SOURCE account's colour — reads as
    // "this account paid out X".
    linkColors.push(colorsByIdx[sIdx]);
  }

  const totalFlow = links.reduce((s, l) => s + l.value, 0);

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Money between accounts
            </p>
            <div className="flex items-center gap-1.5 print:hidden">
              <label className="text-xs text-muted-foreground">Root</label>
              <Select
                value={rootAccountId}
                onValueChange={(v) => setRootAccountId((v ?? "all") as string)}
              >
                <SelectTrigger size="sm" className="min-w-[12rem]">
                  <SelectValue placeholder="All accounts">
                    {rootAccountId === "all"
                      ? "All accounts"
                      : (accountMeta.get(rootAccountId)?.name ?? "All accounts")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {pickerAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: a.color ?? "#94a3b8" }}
                        />
                        {a.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <Switch
                size="sm"
                checked={hideExternal}
                onCheckedChange={(next) => setHideExternal(next)}
              />
              Hide external
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            {hasContent
              ? `${links.length} flow${links.length === 1 ? "" : "s"} · ${formatAUD(totalFlow).replace("A$", "$")} moved`
              : ""}
          </p>
        </div>
        {!hasContent ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {isRootMode
              ? "No transfers in or out of this account in the selected window."
              : "No transfers in the selected window."}
          </p>
        ) : (
          <div
            style={{
              width: "100%",
              height: "clamp(360px, calc(100vh - 280px), 720px)",
            }}
          >
            <ResponsiveContainer>
              <Sankey
                data={{ nodes, links: sankeyLinks }}
                nodeWidth={12}
                nodePadding={16}
                linkCurvature={0.5}
                iterations={64}
                align="left"
                margin={{ top: 28, right: 160, bottom: 28, left: 160 }}
                node={makeCustomNode(isDark, colorsByIdx, labelsByIdx, colByIdx)}
                link={makeCustomLink(linkColors)}
              >
                <Tooltip content={<FlowTooltip />} />
              </Sankey>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
