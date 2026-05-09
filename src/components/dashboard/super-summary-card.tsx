"use client";

import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PiggyBank } from "lucide-react";
import Link from "next/link";
import { formatAUD, amountClass } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface SuperRow {
  fyEndYear: number;
  balance: string;
  person: "self" | "partner";
}

export function SuperSummaryCard() {
  // Combined household super: both self + partner snapshots.
  const { data: rows = [], isLoading } = useSWR<SuperRow[]>("/api/super", fetcher);

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

  return (
    <Card data-size="sm">
      <CardHeader className="pb-1">
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
      <CardContent>
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
