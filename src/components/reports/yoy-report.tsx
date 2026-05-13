"use client";

import useSWR from "swr";
import { useMemo, useState } from "react";
import { subYears, format } from "date-fns";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAUD } from "@/lib/utils";
import {
  startOfFinancialYear,
  endOfFinancialYear,
  financialYearLabel,
} from "@/lib/financial-year";
import type {
  CashflowReport as CashflowData,
  CashflowCategory,
} from "@/app/api/reports/cashflow/route";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const iso = (d: Date) => format(d, "yyyy-MM-dd");

interface YoYRow {
  id: string;
  name: string;
  parentName: string | null;
  type: "income" | "expense";
  thisYear: number;
  lastYear: number;
  delta: number;
  pctDelta: number;
}

/** Year-over-year category-totals comparison for the Reports page.
 * Pulls cashflow for the current and previous Australian financial
 * year in parallel, joins by category id, and shows the deltas.
 * Sorted by the absolute delta (biggest movers first) so the
 * categories the user actually wants to investigate sit at the top.
 *
 * Account filter from the page level is respected; transfer
 * categories follow the same hideTransfers param the cashflow tab
 * uses so the comparison is apples-to-apples. */
export function YoYReport({
  accountIds,
  hideTransfers,
}: {
  accountIds: string[];
  hideTransfers: boolean;
}) {
  const [scope, setScope] = useState<"expense" | "income" | "all">("expense");

  const now = new Date();
  const thisFY = {
    from: iso(startOfFinancialYear(now)),
    to: iso(endOfFinancialYear(now)),
    label: financialYearLabel(now),
  };
  const lastFYAnchor = subYears(now, 1);
  const lastFY = {
    from: iso(startOfFinancialYear(lastFYAnchor)),
    to: iso(endOfFinancialYear(lastFYAnchor)),
    label: financialYearLabel(lastFYAnchor),
  };

  const accountIdsParam =
    accountIds.length > 0 ? `&accountIds=${accountIds.join(",")}` : "";

  const { data: thisData, isLoading: lt } = useSWR<CashflowData>(
    `/api/reports/cashflow?from=${thisFY.from}&to=${thisFY.to}&hideTransfers=${hideTransfers}${accountIdsParam}`,
    fetcher,
  );
  const { data: lastData, isLoading: ll } = useSWR<CashflowData>(
    `/api/reports/cashflow?from=${lastFY.from}&to=${lastFY.to}&hideTransfers=${hideTransfers}${accountIdsParam}`,
    fetcher,
  );

  const rows: YoYRow[] = useMemo(() => {
    if (!thisData || !lastData) return [];
    function flat(d: CashflowData): Map<string, CashflowCategory & { type: "income" | "expense" }> {
      const m = new Map<string, CashflowCategory & { type: "income" | "expense" }>();
      for (const c of d.income) m.set(c.id, { ...c, type: "income" });
      for (const c of d.expenses) m.set(c.id, { ...c, type: "expense" });
      return m;
    }
    const thisFlat = flat(thisData);
    const lastFlat = flat(lastData);
    const ids = new Set([...thisFlat.keys(), ...lastFlat.keys()]);
    const out: YoYRow[] = [];
    for (const id of ids) {
      const a = thisFlat.get(id);
      const b = lastFlat.get(id);
      const type = (a ?? b)!.type;
      if (scope !== "all" && type !== scope) continue;
      const thisYear = a?.total ?? 0;
      const lastYear = b?.total ?? 0;
      if (thisYear === 0 && lastYear === 0) continue;
      const delta = thisYear - lastYear;
      const pctDelta =
        lastYear !== 0
          ? (delta / Math.abs(lastYear)) * 100
          : thisYear !== 0
            ? Infinity
            : 0;
      out.push({
        id,
        name: (a ?? b)!.name,
        parentName: (a ?? b)!.parentName ?? null,
        type,
        thisYear,
        lastYear,
        delta,
        pctDelta,
      });
    }
    // Sort by absolute delta (biggest movers first) — that's the
    // shape an operator actually scans the table for.
    out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    return out;
  }, [thisData, lastData, scope]);

  if (lt || ll) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Loading year-over-year comparison…
      </p>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">
          Year over year — {thisFY.label} vs {lastFY.label}
        </CardTitle>
        <div className="flex rounded-md border overflow-hidden text-xs">
          {(["expense", "income", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`px-2.5 py-1 capitalize transition-colors ${
                scope === s
                  ? "bg-indigo-600 text-white font-medium"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {s === "all" ? "Both" : s + "s"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No category activity in either year for the current selection.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/50 border-b text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-3 py-2 font-medium">Category</th>
                  <th className="text-right px-3 py-2 font-medium">
                    {lastFY.label}
                  </th>
                  <th className="text-right px-3 py-2 font-medium">
                    {thisFY.label}
                  </th>
                  <th className="text-right px-3 py-2 font-medium">Δ</th>
                  <th className="text-right px-3 py-2 font-medium">Δ%</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.slice(0, 50).map((r) => {
                  // For expense rows the sign convention is reversed —
                  // spending MORE is a positive delta but a "bad" one;
                  // arrow tone flips accordingly.
                  const expense = r.type === "expense";
                  const moreSpend = expense && r.delta < 0; // amounts are negative; more spend = larger negative
                  const lessSpend = expense && r.delta > 0;
                  const moreIncome = !expense && r.delta > 0;
                  const lessIncome = !expense && r.delta < 0;
                  const Icon = Math.abs(r.delta) < 1
                    ? Minus
                    : r.delta > 0
                      ? ArrowUp
                      : ArrowDown;
                  const tone =
                    Math.abs(r.delta) < 1
                      ? "text-muted-foreground"
                      : moreSpend || lessIncome
                        ? "text-red-500"
                        : lessSpend || moreIncome
                          ? "text-emerald-600"
                          : "text-muted-foreground";
                  return (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <span className="text-sm">{r.name}</span>
                        {r.parentName && (
                          <span className="text-[10px] text-muted-foreground ml-2">
                            in {r.parentName}
                          </span>
                        )}
                      </td>
                      <td className="text-right px-3 py-1.5 tabular-nums text-muted-foreground">
                        {formatAUD(r.lastYear)}
                      </td>
                      <td className="text-right px-3 py-1.5 tabular-nums">
                        {formatAUD(r.thisYear)}
                      </td>
                      <td className={`text-right px-3 py-1.5 tabular-nums ${tone}`}>
                        <span className="inline-flex items-center gap-1 justify-end">
                          <Icon className="h-3 w-3" />
                          {formatAUD(Math.abs(r.delta))}
                        </span>
                      </td>
                      <td className={`text-right px-3 py-1.5 tabular-nums text-xs ${tone}`}>
                        {Number.isFinite(r.pctDelta)
                          ? `${r.pctDelta >= 0 ? "+" : ""}${r.pctDelta.toFixed(0)}%`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > 50 && (
              <p className="text-xs text-muted-foreground py-2 text-center">
                Showing top 50 of {rows.length} categories by Δ magnitude.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
