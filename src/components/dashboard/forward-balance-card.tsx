"use client";

import { useMemo } from "react";
import { addDays, addMonths, format, parseISO } from "date-fns";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartTooltipCard,
  ChartTooltipHeader,
  ChartTooltipRow,
} from "@/components/ui/chart-tooltip";
import { useSwrJson } from "@/hooks/use-swr-json";
import { cn, formatAUD } from "@/lib/utils";
import type { Account } from "@/db/schema";
import { CalendarClock } from "lucide-react";

/** Response shape from `/api/cashflow` — the same endpoint the
 *  calendar page's chart uses. Only the fields the widget actually
 *  reads. */
interface CashflowApi {
  perAccount: Array<{
    id: string;
    name: string;
    color: string;
    daily: Array<{ date: string; balance: number }>;
  }>;
}

type Period = "30d" | "3m" | "6m" | "12m" | "24m";
const PERIOD_LABELS: Record<Period, string> = {
  "30d": "30 days",
  "3m": "3 months",
  "6m": "6 months",
  "12m": "12 months",
  "24m": "24 months",
};
/** How far to look BACK from today. The widget extends the window a
 *  short way forward too so the operator sees the projection tail
 *  from scheduled transactions (see the divider at "tomorrow"). */
const PERIOD_LOOKBACK: Record<Period, number> = {
  "30d": 15,
  "3m": 45,
  "6m": 90,
  "12m": 180,
  "24m": 365,
};
const PERIOD_LOOKAHEAD: Record<Period, number> = {
  "30d": 15,
  "3m": 45,
  "6m": 90,
  "12m": 180,
  "24m": 365,
};

/** Dashboard widget: the main forward-balance chart from the
 *  Calendar page, scoped to a chosen set of accounts and a period.
 *  Deliberately drops the pan/zoom overview + day-selection
 *  bindings — those are calendar-page-specific and don't fit a
 *  drag-resize widget tile. If the operator wants finer control
 *  they can jump to /calendar via the header link. */
export function ForwardBalanceCard({
  config,
  editMode,
  onConfigChange,
}: {
  config?: Record<string, unknown>;
  editMode: boolean;
  onConfigChange?: (next: Record<string, unknown>) => void;
}) {
  const accountIds: string[] = Array.isArray(config?.accountIds)
    ? (config.accountIds as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
  const period: Period =
    typeof config?.period === "string" &&
    (["30d", "3m", "6m", "12m", "24m"] as string[]).includes(
      config.period as string,
    )
      ? (config.period as Period)
      : "3m";

  // Include archived accounts in the picker so a pinned closed CC
  // (with a running balance the operator still wants to see) stays
  // reachable. Filter at the request layer stays as-is: passing an
  // archived id to /api/cashflow already resolves.
  const { data: accountsData } = useSwrJson<Account[]>(
    "/api/accounts?includeArchived=true",
    { revalidateOnFocus: false },
  );
  const accounts = Array.isArray(accountsData) ? accountsData : [];

  // Compute window from period preset relative to today. Uses local
  // date so the chart's today-divider lands on the operator's
  // wall-clock day.
  const today = new Date();
  const from = format(addDays(today, -PERIOD_LOOKBACK[period]), "yyyy-MM-dd");
  const to = format(addDays(today, PERIOD_LOOKAHEAD[period]), "yyyy-MM-dd");
  const todayISO = format(today, "yyyy-MM-dd");
  const tomorrowISO = format(addDays(today, 1), "yyyy-MM-dd");

  // Build the /api/cashflow URL. Empty accountIds → server-side
  // default is "all accounts". `select` normalises `perAccount` so
  // the widget only holds onto what it renders (avoids the whole
  // `daily` payload).
  const p = new URLSearchParams({ from, to });
  if (accountIds.length > 0) p.set("accountIds", accountIds.join(","));
  const url = `/api/cashflow?${p}`;
  const { data, isLoading } = useSwrJson<CashflowApi>(url);

  const perAccount = data?.perAccount ?? [];

  // Wide-format dataset — one row per date, one column per account
  // (keyed `a_<id>`). Recharts plots one Area per column.
  const chartData = useMemo(() => {
    if (perAccount.length === 0) return [];
    const dates = new Set<string>();
    for (const a of perAccount) for (const d of a.daily) dates.add(d.date);
    const orderedDates = [...dates].sort();
    return orderedDates.map((iso) => {
      const row: Record<string, number | string> = {
        rawDate: iso,
        date: format(parseISO(iso), "d MMM"),
      };
      for (const a of perAccount) {
        row[`a_${a.id}`] = a.daily.find((d) => d.date === iso)?.balance ?? 0;
      }
      return row;
    });
  }, [perAccount]);

  // Today divider — anchor at tomorrow's column so "projected" reads
  // as everything to the right of today's actual bar.
  const todayLabel = chartData.find((r) => r.rawDate === tomorrowISO)?.date as
    | string
    | undefined;

  // Fraction (%) of the horizontal extent where today sits. Feeds
  // the per-account gradient step — realised (left of today) at full
  // fill opacity, projected (right) muted. Null when today is off-
  // window.
  const todayFractionPct = useMemo<number | null>(() => {
    if (chartData.length === 0) return null;
    const idx = chartData.findIndex(
      (r) => (r.rawDate as string) >= todayISO,
    );
    if (idx === -1) return 100;
    return (idx / Math.max(1, chartData.length - 1)) * 100;
  }, [chartData, todayISO]);

  // Y-axis — round outward to a nice step so ticks land on human-
  // readable numbers. Simplified version of the calendar's yDomain
  // calculation. Falls back to Recharts' auto when the domain is
  // degenerate.
  const yDomain = useMemo<[number, number] | ["auto", "auto"]>(() => {
    if (chartData.length === 0 || perAccount.length === 0)
      return ["auto", "auto"];
    let min = Infinity;
    let max = -Infinity;
    for (const row of chartData) {
      for (const a of perAccount) {
        const v = row[`a_${a.id}`];
        if (typeof v === "number") {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }
    if (!isFinite(min) || !isFinite(max)) return ["auto", "auto"];
    if (min === max) {
      const pad = Math.max(10, Math.abs(min) * 0.1);
      return [min - pad, max + pad];
    }
    const step = Math.pow(10, Math.floor(Math.log10((max - min) / 5)));
    return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
  }, [chartData, perAccount]);

  // No `data-size` on the Card: ui/card.tsx only implements
  // `data-[size=sm]`, so the `lg` this used to carry was a silent
  // no-op — the default scale is what it rendered at all along.
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-1 shrink-0 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5" />
          Forward balance · {PERIOD_LABELS[period]}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col gap-2">
        {editMode && (
          <div className="widget-cancel-drag flex flex-wrap gap-2 items-center">
            <div className="flex items-center gap-1 rounded-md border overflow-hidden text-xs">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() =>
                    onConfigChange?.({ accountIds, period: p })
                  }
                  className={cn(
                    "px-2 py-1 transition-colors",
                    period === p
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                  aria-pressed={period === p}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer rounded-md border px-2 py-1 text-muted-foreground hover:bg-muted select-none">
                Accounts · {accountIds.length === 0 ? "All" : accountIds.length}
              </summary>
              <div className="mt-1 max-h-40 overflow-y-auto rounded-md border p-2 space-y-1 bg-popover shadow-sm">
                <label className="flex items-center gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={accountIds.length === 0}
                    onChange={() =>
                      onConfigChange?.({ accountIds: [], period })
                    }
                  />
                  <span className="font-medium">All accounts</span>
                </label>
                <div className="border-t border-border/60 my-1" />
                {accounts.map((a) => {
                  const checked = accountIds.includes(a.id);
                  return (
                    <label
                      key={a.id}
                      className="flex items-center gap-2 text-[11px]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? accountIds.filter((x) => x !== a.id)
                            : [...accountIds, a.id];
                          onConfigChange?.({
                            accountIds: next,
                            period,
                          });
                        }}
                      />
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ backgroundColor: a.color }}
                        aria-hidden="true"
                      />
                      <span>{a.name}</span>
                      {a.isArchived && (
                        <span className="text-muted-foreground">(hidden)</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </details>
          </div>
        )}
        <div className="flex-1 min-h-0">
          {/* Chart hidden while editing: same rationale as
              net-worth-trend / account-summary — recharts 3.x's
              internal store can cascade React #185 during an RGL
              drag if a ResponsiveContainer is animating below. */}
          {editMode ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Chart hidden while editing
              </p>
            </div>
          ) : isLoading ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
              Loading…
            </div>
          ) : chartData.length === 0 || perAccount.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
              No data for this window.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  {todayFractionPct !== null &&
                    perAccount.map((a) => {
                      const stopAt = `${todayFractionPct}%`;
                      return (
                        <linearGradient
                          key={`fbGrad-${a.id}`}
                          id={`fbGrad-${a.id}`}
                          x1="0"
                          y1="0"
                          x2="1"
                          y2="0"
                        >
                          <stop offset="0%" stopColor={a.color} stopOpacity={0.22} />
                          <stop offset={stopAt} stopColor={a.color} stopOpacity={0.22} />
                          <stop offset={stopAt} stopColor={a.color} stopOpacity={0.03} />
                          <stop offset="100%" stopColor={a.color} stopOpacity={0.03} />
                        </linearGradient>
                      );
                    })}
                </defs>
                <CartesianGrid stroke="var(--border)" strokeWidth={1} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval={Math.max(0, Math.floor(chartData.length / 6))}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatYTick}
                  domain={yDomain}
                  width={44}
                />
                <Tooltip content={<FBChartTooltip />} />
                {todayLabel && (
                  <ReferenceLine
                    x={todayLabel}
                    stroke="var(--muted-foreground)"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    ifOverflow="hidden"
                    label={{
                      value: "Projected",
                      position: "insideTopRight",
                      fontSize: 10,
                      fill: "var(--muted-foreground)",
                    }}
                  />
                )}
                <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />
                {perAccount.map((a) => (
                  <Area
                    key={a.id}
                    type="monotone"
                    dataKey={`a_${a.id}`}
                    name={a.name}
                    stroke={a.color}
                    strokeWidth={2}
                    fill={
                      todayFractionPct !== null
                        ? `url(#fbGrad-${a.id})`
                        : a.color
                    }
                    fillOpacity={todayFractionPct !== null ? 1 : 0.08}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function formatYTick(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) {
    const m = v / 1_000_000;
    return `$${Math.abs(m) >= 10 ? m.toFixed(0) : m.toFixed(1)}m`;
  }
  if (abs >= 1_000) {
    const k = v / 1_000;
    return `$${Math.abs(k) >= 10 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `$${Math.round(v)}`;
}

function FBChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload
    .filter((p) => p.name && typeof p.value === "number")
    .sort((a, b) => (b.value as number) - (a.value as number));
  return (
    <ChartTooltipCard>
      <ChartTooltipHeader title={label ?? ""} />
      {rows.map((r, i) => (
        <ChartTooltipRow
          key={i}
          label={r.name ?? ""}
          value={formatAUD(r.value as number)}
          swatch={r.color}
        />
      ))}
    </ChartTooltipCard>
  );
}
