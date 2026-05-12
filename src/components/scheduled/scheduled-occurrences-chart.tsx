"use client";

import { useMemo } from "react";
import { useDarkMode } from "@/hooks/use-dark-mode";
import {
  ComposedChart,
  Bar,
  Cell,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { format, parseISO } from "date-fns";
import { formatAUD } from "@/lib/utils";

// Tracks `.dark` on <html> so chart fills (which Recharts wants as plain
// strings, not CSS variables) can flip with the theme. MutationObserver
// catches the runtime toggle from ThemeToggle without a full page reload.
// Theme-aware overlay colours rely on the `dark` class on <html> being in
// sync with the actual theme. Imported from the shared hook so any chart
// can flip its colour values without each one rolling its own observer.

export interface ChartSegment {
  /** Stable id for the segment (the schedule's id). */
  id: string;
  /** Short label shown in the legend (e.g. "$228.26 from Jan 2026"). */
  label: string;
  /** Colour for matched bars in this segment. Missed bars always render grey. */
  color: string;
  /** Expected amount for this segment. Used in tooltips for missed bars. */
  expectedAmount: number;
  /** Optional lower bound for range-mode schedules. When set, matched
   * transactions whose magnitude lands in [amountMin, expectedAmount] are
   * "in range" and don't get rendered with a variance bar. */
  amountMin?: number;
  /** Transfer-typed schedules render forecast bars in muted yellow to set them
   * apart from regular expense/income forecasts. */
  isTransfer?: boolean;
  matched: { date: string; amount: number; color?: string }[];
  missed: { date: string; amount: number }[];
  /** Forecasted future occurrences — bar shows the forecast amount, lighter shade. */
  forecast?: { date: string; amount: number }[];
}

const FORECAST_COLOUR_LIGHT = "#94a3b8"; // slate-400 — light theme
const FORECAST_COLOUR_DARK = "#475569"; // slate-600 — needs to be darker to recede on the dark plot background
const MISSED_COLOUR = "#ef4444"; // red-500, rendered at ~40% opacity for "muted"
// Mid-tone hues so the bar frame + hatch read on both light and dark plot
// backgrounds. Pattern strokes (below) get an additional `stroke-opacity`
// so the diagonal lines composite onto the background instead of laying
// down a solid colour that vanishes on whichever theme is too close to it.
const OVER_COLOUR = "#ef4444"; // red-500
const UNDER_COLOUR = "#94a3b8"; // slate-400
const GAP_COLOUR = "#94a3b8";   // slate-400 — unused-budget portion, hatched like under
const HATCH_STROKE_OPACITY = 0.55;

function formatPeriod(days: number): string {
  if (days < 1.5) return "1 day";
  if (days < 10) return `${Math.round(days)} days`;
  if (days < 25) return `${(days / 7).toFixed(1)} weeks`;
  if (days < 75) return `${Math.round(days)} days`;
  if (days < 300) return `${(days / 30.44).toFixed(1)} months`;
  return `${(days / 365.25).toFixed(1)} years`;
}

interface OccurrencePoint {
  /** Optional per-bar override for the base segment colour. Set by the
   * caller when bars within one segment should render in different
   * colours (e.g. each budget period in a distinct lineage-rank colour). */
  baseColor?: string;
  date: string;
  /** Total bar height = max(actual, expected) for matched, otherwise the
   * single relevant amount. Kept for tooltip / averaging. */
  amount: number;
  /** Bottom segment of the stacked bar (the "agreed" portion). Carries the
   * segment colour. */
  baseAmount: number;
  /** Top segment of the stacked bar — variance for matched rows, the full
   * expected for missed rows, zero otherwise. */
  deltaAmount: number;
  /** What the delta segment represents — drives its colour. */
  deltaKind: "none" | "over" | "under" | "gap" | "missed";
  segmentId: string;
  segmentLabel: string;
  segmentColor: string;
  expected: number;
  /** Bank's actual amount on the matched txn; equal to `expected` for
   * non-matched rows. Surfaced in the tooltip. */
  actual: number;
  status: "matched" | "missed" | "forecast";
  isTransfer: boolean;
  /** Linear-regression value at this point's index — drives the trend
   * Line series. Same value is set on every point so the line draws
   * from edge to edge regardless of matched vs missed vs forecast. */
  trend?: number;
}

export function ScheduledOccurrencesChart({
  segments,
  onBarClick,
}: {
  segments: ChartSegment[];
  onBarClick?: (date: string) => void;
}) {
  const isDark = useDarkMode();
  const forecastColour = isDark ? FORECAST_COLOUR_DARK : FORECAST_COLOUR_LIGHT;
  const data = useMemo<OccurrencePoint[]>(() => {
    const points: OccurrencePoint[] = [];
    for (const seg of segments) {
      const isTransfer = !!seg.isTransfer;
      const expected = Math.abs(seg.expectedAmount);
      const rangeMin = seg.amountMin != null ? Math.abs(seg.amountMin) : null;
      for (const m of seg.matched) {
        const actual = Math.abs(m.amount);
        const baseColor = m.color;
        // Range schedules budget up to max — render an "unused budget" gap
        // segment whenever actual lands below max. Non-range schedules fall
        // through here too but matcher tolerance means actual is essentially
        // expected, so the variance is usually invisible.
        const isRange = rangeMin !== null;
        let baseAmount = actual;
        let deltaAmount = 0;
        let deltaKind: OccurrencePoint["deltaKind"] = "none";
        if (actual > expected + 0.005) {
          baseAmount = expected;
          deltaAmount = actual - expected;
          deltaKind = "over";
        } else if (actual < expected - 0.005) {
          baseAmount = actual;
          deltaAmount = expected - actual;
          deltaKind = isRange ? "gap" : "under";
        }
        points.push({
          date: m.date,
          amount: Math.max(actual, expected),
          baseAmount,
          deltaAmount,
          deltaKind,
          segmentId: seg.id,
          segmentLabel: seg.label,
          segmentColor: seg.color,
          baseColor,
          expected,
          actual,
          status: "matched",
          isTransfer,
        });
      }
      for (const m of seg.missed) {
        const expectedHere = Math.abs(m.amount);
        points.push({
          date: m.date,
          amount: expectedHere,
          baseAmount: 0,
          deltaAmount: expectedHere,
          deltaKind: "missed",
          segmentId: seg.id,
          segmentLabel: seg.label,
          segmentColor: seg.color,
          expected: expectedHere,
          actual: 0,
          status: "missed",
          isTransfer,
        });
      }
      for (const f of seg.forecast ?? []) {
        const fc = Math.abs(f.amount);
        points.push({
          date: f.date,
          amount: fc,
          baseAmount: fc,
          deltaAmount: 0,
          deltaKind: "none",
          segmentId: seg.id,
          segmentLabel: seg.label,
          segmentColor: seg.color,
          expected: fc,
          actual: fc,
          status: "forecast",
          isTransfer,
        });
      }
    }
    points.sort((a, b) => (a.date < b.date ? -1 : 1));

    // Trend over MATCHED actuals only (missed/forecast excluded so they
    // don't bias the curve). Centered moving average — follows the
    // swings in the data instead of collapsing to a single straight
    // line like a linear regression would. Window of 5 for longer series
    // (smoother), 3 for shorter (more responsive). Trend is assigned
    // only to matched points; connectNulls on the <Line> joins them
    // across any intermediate missed/forecast bars so the line still
    // reads as one continuous curve.
    const matchedIdx: number[] = [];
    const matchedY: number[] = [];
    for (let i = 0; i < points.length; i++) {
      if (points[i].status === "matched") {
        matchedIdx.push(i);
        matchedY.push(points[i].actual);
      }
    }
    if (matchedIdx.length >= 2) {
      const n = matchedIdx.length;
      const windowSize = n >= 8 ? 5 : 3;
      const half = Math.floor(windowSize / 2);
      for (let k = 0; k < n; k++) {
        const lo = Math.max(0, k - half);
        const hi = Math.min(n - 1, k + half);
        let sum = 0;
        for (let j = lo; j <= hi; j++) sum += matchedY[j];
        points[matchedIdx[k]].trend = sum / (hi - lo + 1);
      }
    }
    return points;
  }, [segments]);

  // Average of matched (actual) bars only — missed and forecasted don't count.
  const matchedAverage = useMemo(() => {
    const matched = data.filter((p) => p.status === "matched");
    if (matched.length === 0) return null;
    return matched.reduce((s, p) => s + p.actual, 0) / matched.length;
  }, [data]);

  // Average gap (in days) between consecutive matched occurrences.
  const matchedAveragePeriodDays = useMemo(() => {
    const dates = data
      .filter((p) => p.status === "matched")
      .map((p) => parseISO(p.date).getTime())
      .sort((a, b) => a - b);
    if (dates.length < 2) return null;
    let total = 0;
    for (let i = 1; i < dates.length; i++) total += dates[i] - dates[i - 1];
    return total / (dates.length - 1) / (24 * 60 * 60 * 1000);
  }, [data]);

  if (data.length === 0) {
    return (
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Occurrences
        </p>
        <p className="text-xs text-muted-foreground py-3">No occurrences to chart.</p>
      </div>
    );
  }

  const showSegmentLegend = segments.length > 1;
  const hasTransferForecast = data.some((p) => p.status === "forecast" && p.isTransfer);
  const hasNonTransferForecast = data.some((p) => p.status === "forecast" && !p.isTransfer);

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        Occurrences
      </p>
      <div style={{ width: "100%", height: 160 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <pattern
                id="over-hatch"
                patternUnits="userSpaceOnUse"
                width="6"
                height="6"
                patternTransform="rotate(45)"
              >
                <line
                  x1="0" y1="0" x2="0" y2="6"
                  stroke={OVER_COLOUR}
                  strokeOpacity={HATCH_STROKE_OPACITY}
                  strokeWidth="2"
                />
              </pattern>
              <pattern
                id="under-hatch"
                patternUnits="userSpaceOnUse"
                width="6"
                height="6"
                patternTransform="rotate(45)"
              >
                <line
                  x1="0" y1="0" x2="0" y2="6"
                  stroke={UNDER_COLOUR}
                  strokeOpacity={HATCH_STROKE_OPACITY}
                  strokeWidth="2"
                />
              </pattern>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(d) => format(parseISO(d), "d MMM")}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              domain={[0, (max: number) => Math.ceil(max * 1.1)]}
              tickFormatter={(v: number) =>
                v === 0
                  ? "$0"
                  : v >= 1000
                  ? `$${(v / 1000).toFixed(1)}k`
                  : `$${Math.round(v)}`
              }
              width={48}
            />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
              labelFormatter={(d) => format(parseISO(String(d)), "d MMM yyyy")}
              formatter={(_value, name, item) => {
                const p = item?.payload as OccurrencePoint | undefined;
                if (!p) return ["—", String(name ?? "")];
                if (name === "deltaAmount") {
                  // Suppress the variance row for non-matched / no-delta cases
                  // so the tooltip stays compact.
                  if (p.deltaKind === "missed") {
                    return [formatAUD(p.expected), `Expected · ${p.segmentLabel}`];
                  }
                  if (p.deltaKind === "over") {
                    return [`+${formatAUD(p.deltaAmount).replace("A$", "$")}`, "Over expected"];
                  }
                  if (p.deltaKind === "gap") {
                    return [`−${formatAUD(p.deltaAmount).replace("A$", "$")}`, "Under max"];
                  }
                  if (p.deltaKind === "under") {
                    return [`−${formatAUD(p.deltaAmount).replace("A$", "$")}`, "Under expected"];
                  }
                  return [null, null] as unknown as [string, string];
                }
                // baseAmount row
                if (p.status === "forecast") {
                  return [formatAUD(p.amount), `Forecast · ${p.segmentLabel}`];
                }
                if (p.status === "matched") {
                  return [formatAUD(p.actual), `Actual · ${p.segmentLabel}`];
                }
                return [null, null] as unknown as [string, string];
              }}
              labelStyle={{ fontSize: 11 }}
              contentStyle={{ fontSize: 12, padding: "4px 8px" }}
            />
            {matchedAverage !== null && (
              <ReferenceLine
                y={matchedAverage}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{
                  value: `avg ${formatAUD(matchedAverage).replace("A$", "$")}`,
                  position: "right",
                  fill: "#f59e0b",
                  fontSize: 10,
                }}
              />
            )}
            {/* Base segment — full bar for matched (when no variance) or
                forecast, the "agreed" portion under the cap when over, the
                actual when under. Missed rows have base=0. */}
            <Bar
              dataKey="baseAmount"
              stackId="bar"
              cursor={onBarClick ? "pointer" : undefined}
              onClick={(payload: { payload?: OccurrencePoint } | undefined) => {
                const date = payload?.payload?.date;
                if (date && onBarClick) onBarClick(date);
              }}
            >
              {data.map((p, i) => {
                const fill =
                  p.status === "matched"
                    ? p.baseColor ?? p.segmentColor
                    : p.status === "forecast"
                    ? forecastColour
                    : "transparent";
                const opacity =
                  p.status === "matched" ? 0.85 : p.status === "forecast" ? 0.7 : 0;
                // No top radius when there's a delta segment stacked above.
                const topRadius = p.deltaAmount > 0 ? 0 : 2;
                return (
                  <Cell
                    key={`b-${i}`}
                    fill={fill}
                    fillOpacity={opacity}
                    radius={[topRadius, topRadius, 0, 0] as unknown as number}
                  />
                );
              })}
            </Bar>
            {/* Delta segment — sits on top of the base. Over = overage in
                orange; Under = shortfall in faded slate; Missed = full
                expected in muted red; None = invisible. */}
            <Bar
              dataKey="deltaAmount"
              stackId="bar"
              radius={[2, 2, 0, 0]}
              cursor={onBarClick ? "pointer" : undefined}
              onClick={(payload: { payload?: OccurrencePoint } | undefined) => {
                const date = payload?.payload?.date;
                if (date && onBarClick) onBarClick(date);
              }}
            >
              {data.map((p, i) => {
                let fill: string;
                let opacity: number;
                let stroke: string | undefined;
                let strokeWidth: number | undefined;
                if (p.deltaKind === "over") {
                  fill = "url(#over-hatch)";
                  opacity = 1;
                  stroke = OVER_COLOUR;
                  strokeWidth = 1.5;
                } else if (p.deltaKind === "gap") {
                  fill = "url(#under-hatch)";
                  opacity = 1;
                  stroke = GAP_COLOUR;
                  strokeWidth = 1.5;
                } else if (p.deltaKind === "under") {
                  fill = "url(#under-hatch)";
                  opacity = 1;
                  stroke = UNDER_COLOUR;
                  strokeWidth = 1.5;
                } else if (p.deltaKind === "missed") {
                  fill = MISSED_COLOUR;
                  opacity = 0.4;
                } else {
                  fill = "transparent";
                  opacity = 0;
                }
                return (
                  <Cell
                    key={`d-${i}`}
                    fill={fill}
                    fillOpacity={opacity}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                  />
                );
              })}
            </Bar>
            {/* Trend line over the matched actuals only. Two layers:
                a translucent grey border directly under the red so it
                reads as a 1px grey edge around a 2px red line — clean
                outline rather than a soft halo. Hidden when there
                aren't at least 2 matched points. */}
            <Line
              type="monotone"
              dataKey="trend"
              stroke={isDark ? "#000000" : "#ffffff"}
              strokeWidth={2.5}
              strokeOpacity={0.5}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              connectNulls
              legendType="none"
            />
            <Line
              type="monotone"
              dataKey="trend"
              stroke="#dc2626"
              strokeWidth={1}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              connectNulls
              legendType="none"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-1 flex-wrap">
        {showSegmentLegend ? (
          segments.map((s) => (
            <span key={s.id} className="flex items-center gap-1">
              <span
                className="inline-block w-3 h-2 rounded-sm"
                style={{ backgroundColor: s.color, opacity: 0.85 }}
              />
              {s.label}
            </span>
          ))
        ) : (
          <span className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-2 rounded-sm"
              style={{ backgroundColor: segments[0]?.color ?? "#6366f1", opacity: 0.85 }}
            />
            Matched
          </span>
        )}
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-3 h-2 rounded-sm"
            style={{ backgroundColor: MISSED_COLOUR, opacity: 0.4 }}
          />
          Missed
        </span>
        {data.some((p) => p.deltaKind === "over") && (
          <span className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-2 rounded-sm"
              style={{
                border: `1px solid ${OVER_COLOUR}`,
                backgroundImage: `repeating-linear-gradient(45deg, ${OVER_COLOUR} 0 1.5px, transparent 1.5px 4px)`,
              }}
            />
            Over expected
          </span>
        )}
        {data.some((p) => p.deltaKind === "gap") && (
          <span className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-2 rounded-sm"
              style={{
                border: `1px solid ${GAP_COLOUR}`,
                backgroundImage: `repeating-linear-gradient(45deg, ${GAP_COLOUR} 0 1.5px, transparent 1.5px 4px)`,
              }}
            />
            Under max
          </span>
        )}
        {data.some((p) => p.deltaKind === "under") && (
          <span className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-2 rounded-sm"
              style={{
                border: `1px solid ${UNDER_COLOUR}`,
                backgroundImage: `repeating-linear-gradient(45deg, ${UNDER_COLOUR} 0 1.5px, transparent 1.5px 4px)`,
              }}
            />
            Under expected
          </span>
        )}
        {(hasNonTransferForecast || hasTransferForecast) && (
          <span className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-2 rounded-sm"
              style={{ backgroundColor: forecastColour, opacity: 0.7 }}
            />
            Forecast
          </span>
        )}
        {matchedAverage !== null && (
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0 border-t border-dashed" style={{ borderColor: "#f59e0b" }} />
            Avg amount {formatAUD(matchedAverage).replace("A$", "$")}
          </span>
        )}
        {matchedAveragePeriodDays !== null && (
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0 border-t border-dotted" style={{ borderColor: "#f59e0b" }} />
            Avg period {formatPeriod(matchedAveragePeriodDays)}
          </span>
        )}
      </div>
    </div>
  );
}
