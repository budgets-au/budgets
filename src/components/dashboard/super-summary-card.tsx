"use client";

import { useSwrJson } from "@/hooks/use-swr-json";
import { ResponsiveContainer, BarChart, Bar, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PiggyBank } from "lucide-react";
import Link from "next/link";
import { formatAUD, amountClass } from "@/lib/utils";
import { TREND_UP, TREND_DOWN } from "@/lib/colours";


interface SuperRow {
  fyEndYear: number;
  balance: string;
  person: "self" | "partner";
}

// Issue #97: see `net-worth-trend-card.tsx` for the editMode rationale.
export function SuperSummaryCard({ editMode }: { editMode?: boolean } = {}) {
  // Combined household super: both self + partner snapshots.
  const { data: rows = [], isLoading } = useSwrJson<SuperRow[]>("/api/super");

  // Each person's snapshots sit on independent FY timelines — partner data
  // can lag self by a year. Group by person, then take each person's latest
  // FY balance (summed across funds within that FY) and add across persons.
  // Grouping by FY first would silently drop whichever person hasn't filed
  // the most recent FY yet.
  const byPerson = new Map<string, Map<number, number>>();
  for (const r of rows) {
    let m = byPerson.get(r.person);
    if (!m) {
      m = new Map();
      byPerson.set(r.person, m);
    }
    m.set(r.fyEndYear, (m.get(r.fyEndYear) ?? 0) + parseFloat(r.balance));
  }

  let latestBalance: number | null = null;
  let priorBalance: number | null = null;
  let latestFyEndYear: number | null = null;
  let allPersonsHavePrior = true;
  for (const yearMap of byPerson.values()) {
    const years = Array.from(yearMap.keys()).sort((a, b) => b - a);
    if (years.length === 0) continue;
    latestBalance = (latestBalance ?? 0) + (yearMap.get(years[0]) ?? 0);
    if (latestFyEndYear == null || years[0] > latestFyEndYear) {
      latestFyEndYear = years[0];
    }
    if (years.length >= 2) {
      priorBalance = (priorBalance ?? 0) + (yearMap.get(years[1]) ?? 0);
    } else {
      allPersonsHavePrior = false;
    }
  }
  const latest = latestFyEndYear != null ? { fyEndYear: latestFyEndYear } : null;
  const yoy =
    latestBalance != null && priorBalance != null && allPersonsHavePrior
      ? latestBalance - priorBalance
      : null;
  const yoyPct =
    yoy != null && priorBalance && priorBalance > 0 ? yoy / priorBalance : null;

  // Per-FY household totals (sum across persons) for the bar chart at
  // the bottom of the tile. Bars are the natural shape here — one
  // snapshot per FY makes ~3-6 discrete data points; a line would
  // imply between-FY interpolation that doesn't exist in the data.
  const householdByFy = new Map<number, number>();
  for (const yearMap of byPerson.values()) {
    for (const [year, value] of yearMap) {
      householdByFy.set(year, (householdByFy.get(year) ?? 0) + value);
    }
  }
  const history = Array.from(householdByFy.entries())
    .sort(([a], [b]) => a - b)
    .map(([fyEndYear, value]) => ({ fyEndYear, value }));
  const barColor = yoy != null && yoy < 0 ? TREND_DOWN : TREND_UP;

  return (
    <Card data-size="sm" className="h-full flex flex-col">
      <CardHeader className="pb-1 shrink-0">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <PiggyBank className="h-3.5 w-3.5" />
          <Link
            href="/superannuation"
            className="hover:text-foreground transition-colors"
          >
            Super
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !latest ? (
          <>
            <p className="text-2xl font-bold">—</p>
            <p className="text-xs text-muted-foreground mt-1">
              No snapshots yet
            </p>
          </>
        ) : (
          <>
            <p className="text-2xl font-bold">{formatAUD(latestBalance ?? 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              FY{String(latest.fyEndYear - 1).slice(2)}/
              {String(latest.fyEndYear).slice(2)}
              {yoy != null && (
                <>
                  {" · "}
                  <span className={amountClass(yoy)}>
                    {yoy >= 0 ? "+" : ""}
                    {formatAUD(yoy).replace("A$", "$")}
                  </span>
                  {yoyPct != null && (
                    <span> ({(yoyPct * 100).toFixed(1)}% YoY)</span>
                  )}
                </>
              )}
            </p>
            {/* Household-total bars, one per FY snapshot. Shape only —
                tile is too short to host a useful axis. The tone
                tracks the latest YoY delta (down = red, up/flat =
                green) so the colour reinforces the headline change. */}
            {history.length >= 2 && (
              <div className="flex-1 min-h-0 -mx-1 mt-1">
                {editMode ? (
                  <div className="h-full flex items-center justify-center">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Chart hidden while editing
                    </p>
                  </div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={history}
                    margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                  >
                    {/* Bars start from 0, but axis is hidden — `domain`
                        keeps the smallest snapshot from collapsing into
                        nothing when later years dominate. */}
                    <YAxis hide domain={["dataMin * 0.95", "dataMax * 1.05"]} />
                    <Bar
                      dataKey="value"
                      fill={barColor}
                      radius={[2, 2, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
