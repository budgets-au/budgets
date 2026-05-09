"use client";

import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import Link from "next/link";
import { formatAUD, amountClass } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface InvestmentRow {
  kind: string;
  currency: string;
  costBasis: number;
  currentValue: number;
  totalReturnAbs: number;
}

export function StocksSummaryCard() {
  const { data: rows = [], isLoading } = useSWR<InvestmentRow[]>(
    "/api/investments",
    fetcher,
  );

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

  return (
    <Card data-size="sm">
      <CardHeader className="pb-1">
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
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
