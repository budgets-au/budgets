"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  ResponsiveContainer,
  ComposedChart,
  XAxis,
  YAxis,
  Scatter,
  Line,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { parseISO, format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartTooltipCard,
  ChartTooltipHeader,
  ChartTooltipRow,
} from "@/components/ui/chart-tooltip";
import { CategoryDropdown } from "@/components/categories/category-dropdown";
import { formatAUD, formatDate } from "@/lib/utils";
import { chartGridStroke } from "@/lib/colours";
import { Switch } from "@/components/ui/switch";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { rollingMean } from "@/lib/reports/rolling-mean";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface PointRow {
  id: string;
  /** Transaction date, "YYYY-MM-DD". */
  date: string;
  /** Absolute amount (always positive — sign is encoded as kind). */
  amount: number;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
}

interface ScatterResp {
  points: PointRow[];
  capped: boolean;
}

/** Transaction scatter — one dot per transaction.
 *
 * X: transaction date (numeric epoch for proper continuous scale)
 * Y: absolute amount (linear or log via the toggle)
 * Colour: category colour (falls back to indigo when uncategorised)
 *
 * Smoothing line overlay: a 14-day rolling mean of amounts,
 * sorted by date. Implemented client-side via
 * `src/lib/reports/rolling-mean.ts` so we don't pull in d3 or
 * a LOESS dependency. */
export function ScatterReport({
  from,
  to,
  accountIds,
  // hideTransfers prop is legacy — see comment on similar reports.
}: {
  from: string;
  to: string;
  accountIds: string[];
  hideTransfers: boolean;
}) {
  const [yScale, setYScale] = useState<"linear" | "log">("linear");
  const [kind, setKind] = useState<"expense" | "income" | "all">("expense");
  const [rootCategoryId, setRootCategoryId] = useState<string | null>(null);
  const isDark = useDarkMode();
  const { prefs, setPref } = useDisplayPrefs();
  const hideTransfers = prefs.scatterHideTransfers;

  // Categories pulled in for the drill-down picker. SWR dedupes
  // against the same /api/categories fetch other reports do.
  const { data: allCategories = [] } = useSWR<
    { id: string; name: string; parentId: string | null; type: string }[]
  >("/api/categories", fetcher, { revalidateOnFocus: false });

  const params = new URLSearchParams({ from, to, kind });
  if (accountIds.length > 0) params.set("accountIds", accountIds.join(","));
  if (hideTransfers) params.set("hideTransfers", "true");
  if (rootCategoryId) params.set("rootCategoryId", rootCategoryId);
  const url = `/api/reports/transactions-points?${params}`;
  const { data, isLoading } = useSWR<ScatterResp>(url, fetcher);

  const points = data?.points ?? [];

  // Recharts wants numeric x for a continuous scale; encode the
  // date as an epoch-day so the spacing is honest.
  const scatterData = useMemo(
    () =>
      points.map((p) => ({
        x: parseISO(p.date).getTime(),
        y: p.amount,
        id: p.id,
        date: p.date,
        categoryName: p.categoryName,
        fill: p.categoryColor ?? "#6366f1",
      })),
    [points],
  );

  const trendData = useMemo(() => {
    if (scatterData.length === 0) return [];
    const sorted = [...scatterData].sort((a, b) => a.x - b.x);
    return rollingMean(
      sorted.map((p) => ({ x: p.x, y: p.y })),
      14,
    );
  }, [scatterData]);

  const xMin = scatterData.length > 0
    ? Math.min(...scatterData.map((p) => p.x))
    : parseISO(from).getTime();
  const xMax = scatterData.length > 0
    ? Math.max(...scatterData.map((p) => p.x))
    : parseISO(to).getTime();

  return (
    <Card>
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">
            Transaction scatter
          </CardTitle>
          <div className="flex items-center gap-2">
            <Pillbar
              value={kind}
              options={[
                ["expense", "Expense"],
                ["income", "Income"],
                ["all", "All"],
              ]}
              onChange={setKind}
            />
            <Pillbar
              value={yScale}
              options={[
                ["linear", "Linear"],
                ["log", "Log"],
              ]}
              onChange={setYScale}
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <Switch
                size="sm"
                checked={hideTransfers}
                onCheckedChange={(v) => setPref("scatterHideTransfers", v)}
                aria-label="Hide transfer-typed transactions"
              />
              Hide transfers
            </label>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Filter to:</span>
          <CategoryDropdown
            value={rootCategoryId}
            onChange={setRootCategoryId}
            categories={allCategories}
            placeholder="All categories"
            uncategorisedLabel={null}
            triggerClassName="h-7 min-w-[180px]"
          />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            Loading…
          </p>
        ) : scatterData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            No transactions in the selected window.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              {scatterData.length.toLocaleString()} transactions ·{" "}
              {kind} · {yScale === "log" ? "log" : "linear"} scale ·
              white line is a 14-day rolling mean
              {data?.capped && (
                <span className="text-amber-600 dark:text-amber-400">
                  {" "}· result capped at 5 000 rows
                </span>
              )}
            </p>
            <div style={{ width: "100%", height: 500 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={scatterData}
                  margin={{ top: 12, right: 24, bottom: 16, left: 8 }}
                >
                  <CartesianGrid stroke={chartGridStroke(isDark)} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={[xMin, xMax]}
                    tickFormatter={(v) => format(v, "MMM d")}
                    tick={{ fontSize: 10 }}
                    minTickGap={32}
                  />
                  <YAxis
                    dataKey="y"
                    type="number"
                    scale={yScale === "log" ? "log" : "linear"}
                    domain={yScale === "log" ? [0.5, "dataMax"] : [0, "dataMax"]}
                    allowDataOverflow={yScale === "log"}
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) =>
                      v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`
                    }
                  />
                  <Tooltip
                    content={
                      <ScatterTooltip allPoints={scatterData} />
                    }
                    cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3" }}
                    isAnimationActive={false}
                  />
                  <Scatter
                    name="Transactions"
                    data={scatterData}
                    isAnimationActive={false}
                    fill="#6366f1"
                  >
                    {/* Recharts can't yet take a per-cell fill on Scatter
                        the same way Pie does; we set fill on the data
                        items via the `fill` field which Scatter respects
                        as a prop on each shape (since 2.7). */}
                  </Scatter>
                  <Line
                    type="monotone"
                    dataKey="y"
                    data={trendData.map((p) => ({ x: p.x, y: p.y }))}
                    stroke={isDark ? "#ffffff" : "#1e293b"}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    name="14-day mean"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Pillbar<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (next: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex items-center gap-0.5 rounded-md border bg-muted/30 p-0.5"
    >
      {options.map(([k, label]) => (
        <button
          key={k}
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded transition-colors ${
            value === k
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

interface ScatterPointPayload {
  x?: number;
  date?: string;
  y?: number;
  categoryName?: string | null;
  fill?: string;
}

interface RechartsTooltipEntry {
  name?: string;
  dataKey?: string;
  payload?: ScatterPointPayload;
}

const MAX_TOOLTIP_ROWS = 12;

/** Tooltip that shows every point sharing the hovered date, not just
 *  the one Recharts thinks is "closest". With dozens of transactions
 *  on a single day, the default behaviour surfaces a random one and
 *  the cursor's vertical guideline highlights a column the tooltip
 *  doesn't describe. This version derives the hovered timestamp from
 *  the active payload and lists every scatter point at that x.
 *  Capped at MAX_TOOLTIP_ROWS to avoid a tooltip that scrolls the
 *  screen on a busy day. */
function ScatterTooltip({
  active,
  payload,
  allPoints,
}: {
  active?: boolean;
  payload?: RechartsTooltipEntry[];
  allPoints: Array<{
    x: number;
    y: number;
    date: string;
    categoryName: string | null;
    fill: string;
  }>;
}) {
  if (!active || !payload?.length) return null;
  // Pick any entry whose payload looks like a scatter point — the
  // line-series entry's `.payload` lacks the scatter fields. Either
  // way we only need the x-coordinate.
  const scatterEntry = payload.find(
    (p) => p.payload != null && "categoryName" in p.payload,
  );
  const hoveredX = scatterEntry?.payload?.x;
  if (typeof hoveredX !== "number") return null;
  const dateLabel = scatterEntry?.payload?.date
    ? formatDate(scatterEntry.payload.date)
    : "";
  // Equality on the numeric timestamp is safe: scatterData seeds
  // these from `parseISO(date).getTime()` so same-day points share
  // the exact same value.
  const sameDay = allPoints
    .filter((p) => p.x === hoveredX)
    .sort((a, b) => b.y - a.y);
  if (sameDay.length === 0) return null;
  const visible = sameDay.slice(0, MAX_TOOLTIP_ROWS);
  const hiddenCount = sameDay.length - visible.length;
  const dayTotal = sameDay.reduce((s, p) => s + p.y, 0);
  return (
    <ChartTooltipCard>
      <ChartTooltipHeader title={dateLabel} />
      {visible.map((p, i) => (
        <ChartTooltipRow
          key={i}
          label={p.categoryName ?? "Uncategorised"}
          value={formatAUD(p.y)}
          swatch={p.fill}
        />
      ))}
      {hiddenCount > 0 && (
        <ChartTooltipRow
          label={`+${hiddenCount} more`}
          value=""
        />
      )}
      {sameDay.length > 1 && (
        <ChartTooltipRow
          label={<span className="font-semibold">Total</span>}
          value={formatAUD(dayTotal)}
        />
      )}
    </ChartTooltipCard>
  );
}
