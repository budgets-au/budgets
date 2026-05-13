"use client";

import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Crosshair } from "lucide-react";
import Link from "next/link";
import { formatAUD, amountClass } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface InvestmentRow {
  kind: string;
  currency: string;
  costBasis: number;
  currentValue: number;
  totalReturnAbs: number;
  expiryDate: string | null;
}

/** Summary of every option-kind investment (stock options, LTI
 * performance rights, etc). Mirrors the StocksSummaryCard shape —
 * per-currency totals so AUD + USD don't FX-add silently — and adds
 * a count of options whose expiry is within the next 30 days as a
 * quick "what's about to expire" signal. */
export function OptionsSummaryCard() {
  const { data: rows = [], isLoading } = useSWR<InvestmentRow[]>(
    "/api/investments",
    fetcher,
  );

  const options = rows.filter((r) => r.kind === "option");
  const totals = new Map<string, { cost: number; value: number; ret: number }>();
  for (const r of options) {
    const cur = totals.get(r.currency) ?? { cost: 0, value: 0, ret: 0 };
    cur.cost += r.costBasis;
    cur.value += r.currentValue;
    cur.ret += r.totalReturnAbs;
    totals.set(r.currency, cur);
  }
  const entries = Array.from(totals.entries());

  // "Expiring soon" = positions whose expiry_date is within 30 days
  // from today. Useful at-a-glance signal independent of P&L.
  const now = Date.now();
  const horizonMs = 30 * 24 * 60 * 60 * 1000;
  const expiringSoon = options.filter((r) => {
    if (!r.expiryDate) return false;
    const t = Date.parse(r.expiryDate);
    return Number.isFinite(t) && t - now <= horizonMs && t - now >= 0;
  }).length;

  return (
    <Card data-size="sm" className="h-full">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <Crosshair className="h-3.5 w-3.5" />
          <Link
            href="/investments"
            className="hover:text-foreground transition-colors"
          >
            Options
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <>
            <p className="text-2xl font-bold">—</p>
            <p className="text-xs text-muted-foreground mt-1">No options tracked</p>
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
                {expiringSoon > 0 && (
                  <p className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400 mt-1">
                    {expiringSoon} expiring ≤30d
                  </p>
                )}
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
            {expiringSoon > 0 && (
              <p className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400">
                {expiringSoon} expiring ≤30d
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
