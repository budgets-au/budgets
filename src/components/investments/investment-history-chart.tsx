"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
} from "recharts";
import { format, parseISO } from "date-fns";
import { formatAUD } from "@/lib/utils";
import { chartGridStroke, TREND_UP } from "@/lib/colours";
import {
  ChartTooltipCard,
  ChartTooltipHeader,
  ChartTooltipRow,
} from "@/components/ui/chart-tooltip";

function HistoryTooltip({
  active,
  payload,
  label,
  mode,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartPoint }>;
  label?: string;
  mode: "price" | "value";
  currency: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <ChartTooltipCard>
      <ChartTooltipHeader
        title={label ? format(parseISO(String(label)), "d MMM yyyy") : ""}
      />
      {mode === "price" ? (
        <ChartTooltipRow label="Price" value={`${currency} ${p.close.toFixed(2)}`} />
      ) : (
        <ChartTooltipRow label={`Value (${currency})`} value={formatAUD(p.value)} />
      )}
    </ChartTooltipCard>
  );
}

interface ChartPoint {
  date: string;
  close: number;
  value: number;
}

interface DividendEvent {
  date: string;
  perShare: number;
  totalAmount: number;
}

interface VestMarker {
  date: string;
  label: string;
}

function useDarkMode(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function InvestmentHistoryChart({
  series,
  dividends,
  vests,
  currency,
  purchaseDate,
  mode = "value",
}: {
  series: ChartPoint[];
  dividends: DividendEvent[];
  vests: VestMarker[];
  currency: string;
  /** Trade / grant date — rendered as a vertical marker so the user can see
   * when the position started, even though the chart range is now driven
   * purely by the range picker. Dividends on/after this date colour green
   * (received); dividends before stay amber (informational). */
  purchaseDate?: string;
  /** "value" plots quantity × close (total holding worth); "price" plots
   * the per-share close. Both modes share the same x-axis + range; only
   * the y series and tooltip change. */
  mode?: "value" | "price";
}) {
  const isDark = useDarkMode();

  if (series.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-3">No price history yet.</p>
    );
  }

  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke(isDark)} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(d) => format(parseISO(d), "d MMM")}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            domain={[(min: number) => Math.floor(min * 0.95), (max: number) => Math.ceil(max * 1.05)]}
            tickFormatter={(v: number) =>
              v >= 1000 ? `${currency} ${(v / 1000).toFixed(1)}k` : `${currency} ${Math.round(v)}`
            }
            width={64}
          />
          <Tooltip
            cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3" }}
            content={<HistoryTooltip mode={mode} currency={currency} />}
          />
          <Line
            type="monotone"
            dataKey={mode === "price" ? "close" : "value"}
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {purchaseDate && (
            <ReferenceLine
              x={purchaseDate}
              stroke="#6366f1"
              strokeDasharray="3 3"
              strokeWidth={1}
              label={{
                value: "Bought",
                position: "top",
                fill: "#6366f1",
                fontSize: 9,
              }}
            />
          )}
          {vests.map((v) => (
            <ReferenceLine
              key={`vest-${v.date}`}
              x={v.date}
              stroke={TREND_UP}
              strokeDasharray="2 2"
              strokeWidth={1}
              label={{
                value: v.label,
                position: "top",
                fill: TREND_UP,
                fontSize: 9,
              }}
            />
          ))}
          {dividends.map((d) => {
            const point = series.find((p) => p.date === d.date) ?? series[series.length - 1];
            const received = purchaseDate ? d.date >= purchaseDate : false;
            const colour = received ? TREND_UP : "#f59e0b";
            return (
              <ReferenceDot
                key={`div-${d.date}`}
                x={d.date}
                y={mode === "price" ? point.close : point.value}
                r={4}
                fill={colour}
                stroke="#fff"
                strokeWidth={1}
                label={{
                  value: `${currency} ${d.perShare.toFixed(2)}`,
                  position: "top",
                  fill: colour,
                  fontSize: 9,
                  offset: 8,
                }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
