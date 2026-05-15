"use client";

import useSWR from "swr";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import Link from "next/link";
import { formatAUD, amountClass } from "@/lib/utils";
import { TREND_UP, TREND_DOWN } from "@/lib/colours";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface InvestmentRow {
  kind: string;
  currency: string;
  costBasis: number;
  currentValue: number;
  totalReturnAbs: number;
}

interface TrendResp {
  series: { date: string; value: number }[];
}

export function StocksSummaryCard() {
  const { data: rows = [], isLoading } = useSWR<InvestmentRow[]>(
    "/api/investments",
    fetcher,
  );
  const { data: trend } = useSWR<TrendResp>(
    "/api/dashboard/stocks-trend?range=1m",
    fetcher,
    { revalidateOnFocus: false },
  );
  const history = trend?.series ?? [];

  const stocks = rows.filter((r) => r.kind === "stock");
  // Per-currency totals so AUD + USD don't FX-add silently.
  const totals = new Map<string, { cost: number; value: number; ret: number }>();
  for (const r of stocks) {
    const cur = totals.get(r.currency) ?? { cost: 0, value: 0, ret: 0 };
    cur.cost += r.costBasis;
    cur.value += r.currentValue;
    cur.ret += r.totalReturnAbs;
    totals.set(r.currency, cur);
  }
  const entries = Array.from(totals.entries());

  // Sparkline tone follows the first-to-last delta of the
  // aggregated-value series. Multi-currency mixing means the *axis
  // value* isn't a dollar number, but the *shape* still tells the
  // operator whether the book is up or down over the window.
  const trendStart = history[0]?.value;
  const trendEnd = history[history.length - 1]?.value;
  const trendUp =
    trendStart != null && trendEnd != null ? trendEnd >= trendStart : true;
  const lineColor = trendUp ? TREND_UP : TREND_DOWN;

  return (
    <Card data-size="sm" className="h-full flex flex-col">
      <CardHeader className="pb-1 shrink-0">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" />
          <Link
            href="/investments"
            className="hover:text-foreground transition-colors"
          >
            Stocks
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <>
            <p className="text-2xl font-bold">—</p>
            <p className="text-xs text-muted-foreground mt-1">No stocks tracked</p>
          </>
        ) : entries.length === 1 ? (
          (() => {
            const [currency, t] = entries[0];
            const pct = t.cost > 0 ? t.ret / t.cost : null;
            return (
              <>
                <p className="text-2xl font-bold">{formatAUD(t.value)}</p>
                <p
                  className={`text-xs mt-1 ${
                    t.ret >= 0 ? "text-emerald-600" : "text-red-500"
                  }`}
                >
                  <span className={amountClass(t.ret)}>
                    {t.ret >= 0 ? "+" : ""}
                    {formatAUD(t.ret).replace("A$", "$")}
                  </span>{" "}
                  {pct != null && (
                    <span className="text-muted-foreground">
                      ({(pct * 100).toFixed(1)}% · {currency})
                    </span>
                  )}
                </p>
              </>
            );
          })()
        ) : (
          <div className="space-y-1">
            {entries.map(([currency, t]) => {
              const pct = t.cost > 0 ? t.ret / t.cost : null;
              return (
                <div key={currency}>
                  <p className="text-lg font-bold leading-none">
                    {formatAUD(t.value)}
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground align-middle">
                      {currency}
                    </span>
                  </p>
                  <p className={`text-xs ${amountClass(t.ret)}`}>
                    {t.ret >= 0 ? "+" : ""}
                    {formatAUD(t.ret).replace("A$", "$")}
                    {pct != null && (
                      <span className="ml-1 text-muted-foreground">
                        ({(pct * 100).toFixed(1)}%)
                      </span>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        )}
        {/* 1-month aggregated-value sparkline. Sits at the bottom of
        the tile and fills whatever vertical room is left. The
        sparkline is a shape indicator only — at multi-currency books
        the y-axis is local-currency-mixed, not a dollar number — so
        we deliberately omit axes / tooltip / numeric labels. */}
        {history.length >= 2 && (
          <div className="flex-1 min-h-0 -mx-1 mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <defs>
                  <linearGradient
                    id="stocksTrendGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor={lineColor}
                      stopOpacity={0.3}
                    />
                    <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={lineColor}
                  strokeWidth={1.5}
                  fill="url(#stocksTrendGrad)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
