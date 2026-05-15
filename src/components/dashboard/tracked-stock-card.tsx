"use client";

import useSWR from "swr";
import Link from "next/link";
import { Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartTooltipCard,
  ChartTooltipHeader,
  ChartTooltipRow,
} from "@/components/ui/chart-tooltip";
import { cn } from "@/lib/utils";
import { TREND_UP, TREND_DOWN } from "@/lib/colours";

/** Fetcher that throws on non-2xx so SWR returns `undefined` instead
 * of an error-shaped JSON body that consumers would try to
 * `.filter()` / `.series` against. */
const fetcher = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
};

interface InvestmentRow {
  id: string;
  kind: string;
  symbol: string;
  name: string | null;
  currency: string;
  currentPrice: number | null;
  priorClose: number | null;
}

interface HistoryPoint {
  date: string;
  close: number;
}

interface HistoryResp {
  series: HistoryPoint[];
}

function StockTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload?: HistoryPoint }>;
  currency: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <ChartTooltipCard className="min-w-[8rem]">
      <ChartTooltipHeader title={p.date} />
      <ChartTooltipRow
        label="Close"
        value={`${currency === "USD" ? "US$" : "A$"}${p.close.toFixed(2)}`}
      />
    </ChartTooltipCard>
  );
}

/** Dashboard widget that tracks a single user-picked investment
 * (stock or paper trade). The active selection lives in the layout
 * entry's `config.investmentId`. In edit mode the card surfaces a
 * dropdown of the operator's tracked positions; out of edit mode it
 * renders the symbol + current price + day-change + a 1-month
 * sparkline.
 *
 * Note: the dropdown carries the `widget-cancel-drag` class so the
 * react-grid-layout drag-handler ignores clicks on it (without it,
 * trying to open the select would start a tile drag instead). */
export function TrackedStockCard({
  config,
  editMode,
  onConfigChange,
}: {
  config?: Record<string, unknown>;
  editMode: boolean;
  onConfigChange?: (next: Record<string, unknown>) => void;
}) {
  const investmentId =
    typeof config?.investmentId === "string" ? config.investmentId : null;

  const { data: investmentsData } = useSWR<InvestmentRow[]>(
    "/api/investments",
    fetcher,
    { revalidateOnFocus: false },
  );
  // Defensive cast: if /api/investments is unreachable or returns
  // an error-shaped JSON body, fall back to an empty list rather
  // than calling `.filter()` on `{error: "…"}`.
  const investments: InvestmentRow[] = Array.isArray(investmentsData)
    ? investmentsData
    : [];
  // Only kinds with a meaningful day-to-day price line: outright
  // stocks the operator owns, and paper-trade what-if positions.
  // RSUs and options have their own widgets / lifecycle.
  const trackable = investments.filter(
    (i) => i.kind === "stock" || i.kind === "paper",
  );

  const selected = investmentId
    ? trackable.find((i) => i.id === investmentId) ?? null
    : null;

  const { data: historyData } = useSWR<HistoryResp>(
    selected ? `/api/investments/${selected.id}/history?range=1m` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  const history = historyData?.series ?? [];

  const change =
    selected?.currentPrice != null && selected?.priorClose != null
      ? selected.currentPrice - selected.priorClose
      : null;
  const changePct =
    change != null && selected?.priorClose && selected.priorClose !== 0
      ? (change / selected.priorClose) * 100
      : null;
  const flat = change == null || Math.abs(change) < 0.005;
  const up = change != null && change > 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const tone = flat
    ? "text-muted-foreground"
    : up
      ? "text-emerald-600"
      : "text-red-500";
  const lineColor = flat ? "#94a3b8" : up ? TREND_UP : TREND_DOWN;

  return (
    <Card data-size="sm" className="h-full flex flex-col">
      <CardHeader className="pb-1 shrink-0 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          {selected ? (
            <Link
              href={`/investments?id=${selected.id}`}
              className="hover:text-foreground transition-colors"
            >
              {selected.symbol}
            </Link>
          ) : (
            "Tracked stock"
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col">
        {editMode && (
          <select
            value={investmentId ?? ""}
            onChange={(e) =>
              onConfigChange?.({ investmentId: e.target.value || null })
            }
            className={cn(
              // widget-cancel-drag stops the tile drag from swallowing
              // the click that opens the native picker.
              "widget-cancel-drag mb-2 rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500",
            )}
            aria-label="Pick a stock to track"
          >
            <option value="">— Pick a stock —</option>
            {trackable.length === 0 ? (
              <option disabled value="">
                No tracked positions yet
              </option>
            ) : (
              trackable.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.symbol}
                  {i.kind === "paper" ? " (paper)" : ""}
                  {i.name ? ` — ${i.name}` : ""}
                </option>
              ))
            )}
          </select>
        )}
        {!selected ? (
          <p className="text-xs text-muted-foreground">
            {editMode
              ? "Pick a stock from the dropdown."
              : "No stock configured. Enter edit mode to pick one."}
          </p>
        ) : (
          <>
            <p className="text-2xl font-bold">
              {selected.currentPrice != null
                ? `${selected.currency === "USD" ? "US$" : "A$"}${selected.currentPrice.toFixed(2)}`
                : "—"}
            </p>
            <div className={`flex items-center gap-1 text-xs mt-1 ${tone}`}>
              <Icon className="h-3 w-3" />
              {change != null && changePct != null ? (
                <span>
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(2)} ({changePct >= 0 ? "+" : ""}
                  {changePct.toFixed(2)}%) day
                </span>
              ) : (
                <span>No daily change yet</span>
              )}
            </div>
            <div className="flex-1 min-h-0 mt-2 -mx-1">
              {editMode ? (
                // Suspend recharts mid-edit — its internal redux
                // store fires subscriber loops when the container
                // resizes during a drag (RGL shifts cells as the
                // dragged widget moves), which exceeds React's
                // update-depth limit.
                <div className="h-full flex items-center justify-center">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Chart hidden while editing
                  </p>
                </div>
              ) : history.length >= 2 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history}>
                    <defs>
                      <linearGradient
                        id={`tsGrad-${selected.id}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="5%" stopColor={lineColor} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Tooltip
                      content={
                        <StockTooltip currency={selected.currency} />
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="close"
                      stroke={lineColor}
                      strokeWidth={1.5}
                      fill={`url(#tsGrad-${selected.id})`}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Loading history…
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
