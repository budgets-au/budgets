"use client";

import { useSwrJson } from "@/hooks/use-swr-json";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Beaker } from "lucide-react";
import Link from "next/link";
import { formatAUD, amountClass } from "@/lib/utils";


interface InvestmentRow {
  kind: string;
  currency: string;
  costBasis: number;
  currentValue: number;
  totalReturnAbs: number;
}

/** "Paper trades" — hypothetical what-if positions the user added
 * without actually buying. Same per-currency totals as the stocks
 * widget, with the position count exposed (the value of paper
 * trading is "what if I had bought N positions?" so showing the N
 * matters). */
export function PaperTradeSummaryCard() {
  const { data: rows = [], isLoading } = useSwrJson<InvestmentRow[]>(
    "/api/investments",
  );

  const papers = rows.filter((r) => r.kind === "paper");
  const totals = new Map<string, { cost: number; value: number; ret: number }>();
  for (const r of papers) {
    const cur = totals.get(r.currency) ?? { cost: 0, value: 0, ret: 0 };
    cur.cost += r.costBasis;
    cur.value += r.currentValue;
    cur.ret += r.totalReturnAbs;
    totals.set(r.currency, cur);
  }
  const entries = Array.from(totals.entries());
  const positionCount = papers.length;

  return (
    <Card data-size="sm" className="h-full">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <Beaker className="h-3.5 w-3.5" />
          <Link
            href="/investments"
            className="hover:text-foreground transition-colors"
          >
            Paper trades
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <>
            <p className="text-2xl font-bold">—</p>
            <p className="text-xs text-muted-foreground mt-1">No paper trades</p>
          </>
        ) : entries.length === 1 ? (
          (() => {
            const [currency, t] = entries[0];
            const pct = t.cost > 0 ? t.ret / t.cost : null;
            return (
              <>
                <p className="text-2xl font-bold">{formatAUD(t.value)}</p>
                <p className={`text-xs mt-1 ${amountClass(t.ret)}`}>
                  {t.ret >= 0 ? "+" : ""}
                  {formatAUD(t.ret).replace("A$", "$")}
                  {pct != null && (
                    <span className="ml-1 text-muted-foreground">
                      ({(pct * 100).toFixed(1)}% · {currency})
                    </span>
                  )}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                  {positionCount} position{positionCount === 1 ? "" : "s"}
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
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {positionCount} position{positionCount === 1 ? "" : "s"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
