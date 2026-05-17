"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

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
  sideByIdx: ("source" | "target")[],
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
    const side = sideByIdx[index] ?? "target";
    const isSource = side === "source";
    const labelX = isSource ? x - 6 : x + width + 6;
    const textAnchor: "start" | "end" = isSource ? "end" : "start";
    const labelFill = isDark ? "#e2e8f0" : "#0f172a";
    const subFill = isDark ? "#94a3b8" : "#64748b";
    const name = labelsByIdx[index] ?? "";
    // Each node's `value` is computed by Recharts as the larger of incoming
    // or outgoing flow — for the split-by-side layout we use here, each
    // node has flow only on one side so this is just that side's total.
    const valueText = formatAUD(
      Number((props.payload?.value ?? 0)) || 0,
    ).replace("A$", "$");
    const textY = y + height / 2 + 4;
    const APPROX_CHAR_PX = 6.5;
    const labelWidthEst = name.length * APPROX_CHAR_PX;
    const valueGap = 8;
    const valueX = isSource
      ? labelX - labelWidthEst - valueGap
      : labelX + labelWidthEst + valueGap;
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={Math.max(2, height)}
          fill={fill}
          fillOpacity={0.95}
        />
        <text
          x={labelX}
          y={textY}
          textAnchor={textAnchor}
          fontSize={11}
          fontWeight={500}
          fill={labelFill}
        >
          {name}
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
  const accountIdsParam =
    accountIds.length > 0 ? `&accountIds=${accountIds.join(",")}` : "";
  const { data, isLoading } = useSWR<AccountsCashflowReport>(
    `/api/reports/accounts-cashflow?from=${from}&to=${to}${accountIdsParam}`,
    fetcher,
  );
  // The picker shows every non-archived account, not just the ones the
  // sidebar filter has restricted the report to — letting the operator
  // pivot to a specific account without first clearing the sidebar.
  const { data: allAccounts = [] } = useSWR<AccountRow[]>(
    `/api/accounts`,
    fetcher,
  );
  const isDark = useDarkMode();

  const [rootAccountId, setRootAccountId] = useState<string>("all");
  const [hideExternal, setHideExternal] = useState(false);

  // Build the raw link list once (per data change) before applying the
  // root / hide-external filters — flow direction is captured by the
  // sender's `transferOutBy[]`. Iterating receivers' `transferInBy[]`
  // would double-count every internal pair.
  const rawLinks: FlowLink[] = useMemo(() => {
    if (!data) return [];
    const out: FlowLink[] = [];
    for (const a of data.accounts) {
      for (const cp of a.transferOutBy) {
        if (cp.total <= 0) continue;
        out.push({
          sourceAccountId: a.id,
          targetAccountId: cp.counterpartyId ?? EXTERNAL_ID,
          value: cp.total,
        });
      }
    }
    return out;
  }, [data]);

  // Lookup table for every account that might be referenced — sidebar
  // filter restricts the report to visible accounts, but the OTHER end
  // of a transfer can be any account (including archived). Use the
  // accountsCashflowReport's account rows + supplement with /api/accounts
  // for any missing counterparties.
  const accountMeta = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const a of allAccounts) {
      map.set(a.id, { name: a.name, color: a.color ?? "#94a3b8" });
    }
    // Override with the cashflow report's accounts in case any colour
    // differs (the report sometimes adds visual styling). Same shape.
    if (data) {
      for (const a of data.accounts) {
        map.set(a.id, { name: a.name, color: a.color });
      }
    }
    return map;
  }, [allAccounts, data]);

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

  // Apply filters (root account + hide external) to the raw link list.
  let links = rawLinks;
  if (hideExternal) {
    links = links.filter(
      (l) =>
        l.sourceAccountId !== EXTERNAL_ID && l.targetAccountId !== EXTERNAL_ID,
    );
  }
  if (rootAccountId !== "all") {
    links = links.filter(
      (l) =>
        l.sourceAccountId === rootAccountId ||
        l.targetAccountId === rootAccountId,
    );
  }

  // Pickable accounts for the dropdown: every non-archived account from
  // /api/accounts. Sorted by name for stable scanning.
  const pickerAccounts = [...allAccounts]
    .filter((a) => !a.isArchived)
    .sort((x, y) => x.name.localeCompare(y.name));

  const hasContent = links.length > 0;

  // Build the Sankey datum. Each account that appears as a source gets
  // a left-column node; each account that appears as a target gets a
  // right-column node. Splitting by side prevents Recharts from drawing
  // cycles when A → B and B → A both exist in the window.
  const nodes: SankeyNodeDatum[] = [];
  const colorsByIdx: string[] = [];
  const labelsByIdx: string[] = [];
  const sideByIdx: ("source" | "target")[] = [];
  const sourceIdxByAccount = new Map<string, number>();
  const targetIdxByAccount = new Map<string, number>();

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

  function ensureSourceNode(id: string): number {
    const existing = sourceIdxByAccount.get(id);
    if (existing != null) return existing;
    const meta = metaFor(id);
    const i = nodes.length;
    nodes.push({ name: meta.name });
    colorsByIdx.push(meta.color);
    labelsByIdx.push(meta.name);
    sideByIdx.push("source");
    sourceIdxByAccount.set(id, i);
    return i;
  }
  function ensureTargetNode(id: string): number {
    const existing = targetIdxByAccount.get(id);
    if (existing != null) return existing;
    const meta = metaFor(id);
    const i = nodes.length;
    nodes.push({ name: meta.name });
    colorsByIdx.push(meta.color);
    labelsByIdx.push(meta.name);
    sideByIdx.push("target");
    targetIdxByAccount.set(id, i);
    return i;
  }

  const sankeyLinks: SankeyLinkDatum[] = [];
  const linkColors: string[] = [];
  for (const l of links) {
    const sIdx = ensureSourceNode(l.sourceAccountId);
    const tIdx = ensureTargetNode(l.targetAccountId);
    sankeyLinks.push({ source: sIdx, target: tIdx, value: l.value });
    // Tint each ribbon with the SOURCE account's colour — reads as
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
            <div className="flex items-center gap-1.5">
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
            No transfers in the selected window.
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
                margin={{ top: 8, right: 160, bottom: 8, left: 160 }}
                node={makeCustomNode(isDark, colorsByIdx, labelsByIdx, sideByIdx)}
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
