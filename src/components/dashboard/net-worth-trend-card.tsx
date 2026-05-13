"use client";

import useSWR from "swr";
import { ResponsiveContainer, AreaChart, Area, Tooltip } from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAUD } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TrendResp {
  trend: Array<{ date: string; netWorth: number }>;
  monthLabels: string[];
}

/** Dashboard card showing the 12-month net-worth trajectory as a
 * mini area chart with a current-value + delta-from-start summary
 * line. Hovering the chart surfaces the per-month value. */
export function NetWorthTrendCard() {
  const { data } = useSWR<TrendResp>(
    "/api/dashboard/net-worth-trend",
    fetcher,
    { revalidateOnFocus: false },
  );

  if (!data || data.trend.length < 2) {
    return (
      <Card data-size="sm">
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
    <Card data-size="sm">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Net Worth Trend
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{formatAUD(last)}</p>
        <div className={`flex items-center gap-1 text-xs mt-1 ${tone}`}>
          <Icon className="h-3 w-3" />
          <span>
            {delta >= 0 ? "+" : ""}
            {formatAUD(delta)} ({pctDelta >= 0 ? "+" : ""}
            {pctDelta.toFixed(1)}%) vs 12 mo ago
          </span>
        </div>
        <div className="h-12 mt-2 -mx-1">
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
              <Tooltip
                contentStyle={{
                  fontSize: "11px",
                  padding: "4px 8px",
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                }}
                formatter={(v) => [formatAUD(Number(v)), "Net Worth"]}
                labelStyle={{ display: "none" }}
              />
              <Area
                type="monotone"
                dataKey="netWorth"
                stroke={trendUp ? "#10b981" : "#ef4444"}
                strokeWidth={1.5}
                fill="url(#nwGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
