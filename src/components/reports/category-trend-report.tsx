"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { format, parseISO } from "date-fns";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/state-message";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filter-bar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CategoryDropdown, type CategoryLike } from "@/components/categories/category-dropdown";
import {
  ChartTooltipCard,
  ChartTooltipHeader,
  ChartTooltipRow,
} from "@/components/ui/chart-tooltip";
import { useSwrJson } from "@/hooks/use-swr-json";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { formatAUD, formatAUDShort } from "@/lib/utils";
import type { CategoryTrendResponse } from "@/app/api/reports/category-trend/route";

/** Category-trend report: pick any category (grandparent / parent /
 *  child), pick a group-by granularity, watch the spend shape across
 *  the selected window. Descendants of the chosen category are
 *  rolled up so a grandparent selection shows the whole subtree.
 *
 *  Plots absolute magnitudes so a rising line always means "more
 *  activity" regardless of whether the category is expense- or
 *  income-typed. The average-per-period marker is a dashed
 *  horizontal reference so operators can eyeball whether a spike
 *  is an outlier or a new trend. */
export function CategoryTrendReport({
  from,
  to,
  accountIds,
}: {
  from: string;
  to: string;
  accountIds: string[];
}) {
  const { prefs, setPref } = useDisplayPrefs();

  // Categories list — fetched once per session and cached by SWR so
  // switching between reports doesn't refetch. Matches the pattern
  // every other client picker uses.
  const { data: categories = [] } = useSwrJson<CategoryLike[]>("/api/categories");

  const selectedCategoryId = prefs.categoryTrendCategoryId;
  const groupBy = prefs.categoryTrendGroupBy;

  const accountIdsParam =
    accountIds.length > 0 ? `&accountIds=${accountIds.join(",")}` : "";

  const url = selectedCategoryId
    ? `/api/reports/category-trend?categoryId=${selectedCategoryId}&groupBy=${groupBy}&from=${from}&to=${to}${accountIdsParam}`
    : null;

  const {
    data,
    isLoading,
    error,
    mutate: retry,
  } = useSwrJson<CategoryTrendResponse>(url);

  // Chart-ready dataset. Recharts expects one flat object per data
  // point with named series values. Absolute magnitudes only —
  // signed totals are surfaced in the summary tile below and the
  // hover tooltip, but the line itself needs a consistent "up is
  // more" reading.
  const chartData = useMemo(() => {
    if (!data) return [];
    return data.periods.map((p) => ({
      period: p.period,
      value: Math.abs(p.total),
      count: p.count,
      signedTotal: p.total,
    }));
  }, [data]);

  const summary = useMemo(() => {
    if (!data || data.periods.length === 0) {
      return { total: 0, average: 0, peak: null as null | { period: string; value: number }, count: 0 };
    }
    let total = 0;
    let count = 0;
    let peak: { period: string; value: number } | null = null;
    for (const p of data.periods) {
      const mag = Math.abs(p.total);
      total += mag;
      count += p.count;
      if (!peak || mag > peak.value) peak = { period: p.period, value: mag };
    }
    return {
      total,
      average: total / data.periods.length,
      peak,
      count,
    };
  }, [data]);

  return (
    <div className="space-y-4 print-portrait">
      {/* Controls: category picker + group-by. Keeps the standard
          filter bar's period range in charge of the window; these
          two controls narrow the scope inside that window. */}
      <FilterBar align="start" innerClassName="max-w-5xl mx-auto">
        <div className="min-w-0">
          <label className="text-xs text-muted-foreground block mb-1">
            Category
          </label>
          <CategoryDropdown
            value={selectedCategoryId}
            onChange={(id) => setPref("categoryTrendCategoryId", id)}
            categories={categories}
            placeholder="Pick a category…"
            uncategorisedLabel={null}
            triggerClassName="h-9 min-w-[220px]"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Group by
          </label>
          <SegmentedControl
            ariaLabel="Group by period"
            value={groupBy}
            onChange={(v) => setPref("categoryTrendGroupBy", v)}
            options={[
              { value: "day", label: "Day" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
              { value: "year", label: "Year" },
            ]}
          />
        </div>
      </FilterBar>

      <div className="max-w-5xl mx-auto space-y-4">
        {!selectedCategoryId ? (
          <EmptyState>
            Pick a category above to see its trend across the selected
            window. Grandparent selections roll up the whole subtree;
            leaf selections show just that line.
          </EmptyState>
        ) : isLoading ? (
          <LoadingState label="Loading category trend…" />
        ) : error ? (
          <ErrorState
            label="Couldn't load the category trend."
            onRetry={() => retry()}
          />
        ) : !data || data.periods.length === 0 ? (
          <EmptyState>
            No activity for <strong>{data?.categoryName ?? "this category"}</strong>{" "}
            in the selected window. Widen the date range or pick a
            different category.
          </EmptyState>
        ) : (
          <>
            {/* Summary tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryTile
                label="Total"
                value={formatAUDShort(summary.total)}
                sub={`across ${summary.count} txn${summary.count === 1 ? "" : "s"}`}
              />
              <SummaryTile
                label={`Average / ${groupBy}`}
                value={formatAUDShort(summary.average)}
                sub={`${data.periods.length} ${groupBy}${data.periods.length === 1 ? "" : "s"} with activity`}
              />
              <SummaryTile
                label="Peak period"
                value={
                  summary.peak
                    ? formatAUDShort(summary.peak.value)
                    : "—"
                }
                sub={summary.peak ? formatPeriodLabel(summary.peak.period, groupBy) : ""}
              />
              <SummaryTile
                label="Category"
                value={data.categoryName}
                sub={`${data.categoryType ?? "—"} · ${chartData.length}-point series`}
                valueFont="normal"
              />
            </div>

            {/* Chart */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {data.categoryName}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    · {groupBy === "day" ? "daily" : groupBy === "week" ? "weekly" : groupBy === "month" ? "monthly" : "yearly"} activity
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={340}>
                  <AreaChart
                    data={chartData}
                    margin={{ top: 12, right: 16, bottom: 4, left: 8 }}
                  >
                    <defs>
                      <linearGradient id="cat-trend-fill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="period"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: string) => formatPeriodLabel(v, groupBy)}
                      minTickGap={20}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      width={54}
                      tickFormatter={(v: number) =>
                        v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`
                      }
                    />
                    <Tooltip content={<TrendTooltip groupBy={groupBy} />} />
                    {summary.average > 0 && (
                      <ReferenceLine
                        y={summary.average}
                        stroke="var(--muted-foreground)"
                        strokeDasharray="4 4"
                        label={{
                          value: `avg ${formatAUDShort(summary.average)}`,
                          position: "insideTopRight",
                          fontSize: 10,
                          fill: "var(--muted-foreground)",
                        }}
                      />
                    )}
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#6366f1"
                      strokeWidth={2}
                      fill="url(#cat-trend-fill)"
                      dot={chartData.length <= 40 ? { r: 3, fill: "#6366f1" } : false}
                      activeDot={{ r: 5 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  sub,
  valueFont = "tabular",
}: {
  label: string;
  value: string;
  sub?: string;
  valueFont?: "tabular" | "normal";
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1 py-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span
          className={`text-lg font-semibold ${valueFont === "tabular" ? "tabular-nums" : ""} truncate`}
          title={value}
        >
          {value}
        </span>
        {sub && (
          <span className="text-[11px] text-muted-foreground truncate" title={sub}>
            {sub}
          </span>
        )}
      </CardContent>
    </Card>
  );
}

function TrendTooltip({
  active,
  payload,
  label,
  groupBy,
}: {
  active?: boolean;
  payload?: Array<{
    value?: number;
    payload?: { count?: number; signedTotal?: number };
  }>;
  label?: string;
  groupBy: "day" | "week" | "month" | "year";
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0];
  const raw = p.payload;
  const value = Number(p.value ?? 0);
  const signed = Number(raw?.signedTotal ?? value);
  const count = Number(raw?.count ?? 0);
  return (
    <ChartTooltipCard>
      <ChartTooltipHeader
        title={typeof label === "string" ? formatPeriodLabel(label, groupBy) : String(label ?? "")}
      />
      <ChartTooltipRow
        label="Amount"
        value={formatAUD(signed)}
        tone={signed >= 0 ? "positive" : "negative"}
      />
      <ChartTooltipRow
        label="Transactions"
        value={String(count)}
        tone="muted"
      />
    </ChartTooltipCard>
  );
}

/** Turn a raw SQL period key ("2026-08", "2026-08-15", "2026-W33",
 *  "2026") into something readable for tooltips + x-axis ticks. */
function formatPeriodLabel(period: string, groupBy: "day" | "week" | "month" | "year"): string {
  try {
    if (groupBy === "day") {
      return format(parseISO(period), "d MMM ''yy");
    }
    if (groupBy === "month") {
      return format(parseISO(`${period}-01`), "MMM ''yy");
    }
    if (groupBy === "year") {
      return period;
    }
    // week: "YYYY-Wnn" — strftime uses %W (weeks starting Monday, first
    // week may be zero-length). Keep the raw form; it's short and
    // unambiguous.
    return period.replace(/^(\d{4})-W(\d{2})$/, "W$2 '$1");
  } catch {
    return period;
  }
}
