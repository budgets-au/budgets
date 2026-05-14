"use client";

import useSWR from "swr";
import { ResponsiveContainer, AreaChart, Area, Tooltip } from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartTooltipCard,
  ChartTooltipHeader,
  ChartTooltipRow,
} from "@/components/ui/chart-tooltip";
import { formatAUD } from "@/lib/utils";

function NetWorthTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { label: string; netWorth: number } }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <ChartTooltipCard className="min-w-[10rem]">
      <ChartTooltipHeader title={p.label} />
      <ChartTooltipRow label="Net Worth" value={formatAUD(p.netWorth)} />
    </ChartTooltipCard>
  );
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TrendResp {
  trend: Array<{ date: string; netWorth: number }>;
  monthLabels: string[];
}

/** Dashboard card showing the 12-month net-worth trajectory as a
 * mini area chart with a current-value + delta-from-start summary
 * line. Hovering the chart surfaces the per-month value.
 *
 * In dashboard edit-mode the chart is replaced with a static
 * "Chart hidden while editing" placeholder. Recharts 3.x's
 * ResponsiveContainer drives an internal react-redux store that
 * keeps firing subscriber notifications when the container resizes
 * mid-drag (RGL shifts every cell as the dragged widget moves) —
 * that's what was producing React error #185 "Maximum update depth
 * exceeded" the moment any widget was dragged onto a layout that
 * contained this card. */
export function NetWorthTrendCard({ editMode }: { editMode?: boolean } = {}) {
  const { data } = useSWR<TrendResp>(
    "/api/dashboard/net-worth-trend",
    fetcher,
    { revalidateOnFocus: false },
  );

  if (!data || data.trend.length < 2) {
    return (
      <Card data-size="sm" className="h-full">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Net Worth Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Building history…</p>
        </CardContent>
      </Card>
    );
  }

  const first = data.trend[0].netWorth;
  const last = data.trend[data.trend.length - 1].netWorth;
  const delta = last - first;
  const pctDelta = first !== 0 ? (delta / Math.abs(first)) * 100 : 0;
  const trendUp = delta > 0;
  const flat = Math.abs(delta) < 1;
  const Icon = flat ? Minus : trendUp ? TrendingUp : TrendingDown;
  const tone = flat
    ? "text-muted-foreground"
    : trendUp
      ? "text-emerald-600"
      : "text-red-500";

  // Build the chart data with the month label paired in for tooltip.
  const chartData = data.trend.map((p, i) => ({
    label: data.monthLabels[i],
    netWorth: p.netWorth,
  }));

  return (
    <Card data-size="sm" className="h-full flex flex-col">
      <CardHeader className="pb-1 shrink-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Net Worth Trend
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col">
        <p className="text-2xl font-bold">{formatAUD(last)}</p>
        <div className={`flex items-center gap-1 text-xs mt-1 ${tone}`}>
          <Icon className="h-3 w-3" />
          <span>
            {delta >= 0 ? "+" : ""}
            {formatAUD(delta)} ({pctDelta >= 0 ? "+" : ""}
            {pctDelta.toFixed(1)}%) vs 12 mo ago
          </span>
        </div>
        <div className="flex-1 min-h-0 mt-2 -mx-1">
          {editMode ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Chart hidden while editing
              </p>
            </div>
          ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={trendUp ? "#10b981" : "#ef4444"}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor={trendUp ? "#10b981" : "#ef4444"}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <Tooltip content={<NetWorthTooltip />} />
              <Area
                type="monotone"
                dataKey="netWorth"
                stroke={trendUp ? "#10b981" : "#ef4444"}
                strokeWidth={1.5}
                fill="url(#nwGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
