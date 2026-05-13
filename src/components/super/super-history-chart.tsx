"use client";

import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { formatAUD } from "@/lib/utils";
import { formatFy } from "@/lib/tax/fy";
import {
  ChartTooltipCard,
  ChartTooltipHeader,
  ChartTooltipRow,
} from "@/components/ui/chart-tooltip";

function SuperTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string | number; value?: number; color?: string }>;
  label?: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const fy = typeof label === "number" ? formatFy(label) : String(label ?? "");
  return (
    <ChartTooltipCard>
      <ChartTooltipHeader title={fy} />
      {payload.map((row) => {
        const v =
          typeof row.value === "number" && Number.isFinite(row.value)
            ? formatAUD(row.value)
            : "—";
        return (
          <ChartTooltipRow
            key={String(row.name)}
            label={String(row.name)}
            value={v}
            swatch={row.color}
          />
        );
      })}
    </ChartTooltipCard>
  );
}

interface ChartYear {
  fyEndYear: number;
  /** Per-fund balances keyed by fund name (empty string = unnamed). */
  byFund: Map<string, number>;
  totalIncrease: number | null;
}

const FUND_COLOURS = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#8b5cf6", // violet
  "#ef4444", // red
];
const INCREASE_COLOUR = "#22c55e";

const fundDataKey = (fund: string) => `fund::${fund}`;
const fundLabel = (fund: string) => fund || "Unnamed";

function compactAUD(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `$${Math.round(v / 1000)}k`;
  return `$${Math.round(v)}`;
}

export function SuperHistoryChart({
  years,
  fundColumns,
}: {
  years: ChartYear[];
  fundColumns: string[];
}) {
  const isDark = useDarkMode();

  if (years.length < 2) return null;

  const data = years.map((y) => {
    const row: Record<string, number | string | null> = {
      year: y.fyEndYear,
      increase: y.totalIncrease,
    };
    for (const fund of fundColumns) {
      row[fundDataKey(fund)] = y.byFund.get(fund) ?? 0;
    }
    return row;
  });

  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <defs>
            {fundColumns.map((fund, i) => {
              const c = FUND_COLOURS[i % FUND_COLOURS.length];
              return (
                <linearGradient
                  key={fund}
                  id={`super-fund-${i}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={c} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={c} stopOpacity={0.05} />
                </linearGradient>
              );
            })}
            <linearGradient id="super-increase" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={INCREASE_COLOUR} stopOpacity={0.45} />
              <stop offset="100%" stopColor={INCREASE_COLOUR} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={isDark ? "#334155" : "#e2e8f0"}
          />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(y: number) => formatFy(y)}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => compactAUD(v)}
            width={56}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 10, fill: INCREASE_COLOUR }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => compactAUD(v)}
            width={48}
          />
          <Tooltip content={<SuperTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
          {fundColumns.map((fund, i) => (
            <Area
              key={fund}
              yAxisId="left"
              type="monotone"
              dataKey={fundDataKey(fund)}
              stackId="balance"
              stroke={FUND_COLOURS[i % FUND_COLOURS.length]}
              strokeWidth={1.5}
              fill={`url(#super-fund-${i})`}
              name={fundLabel(fund)}
              isAnimationActive={false}
            />
          ))}
          <Area
            yAxisId="right"
            type="monotone"
            dataKey="increase"
            stroke={INCREASE_COLOUR}
            strokeWidth={2}
            fill="url(#super-increase)"
            connectNulls={false}
            name="Increase"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
