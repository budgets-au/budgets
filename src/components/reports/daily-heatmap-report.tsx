"use client";

import useSWR from "swr";
import { useMemo } from "react";
import Link from "next/link";
import { parseISO, format, addDays, startOfWeek } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAUD, cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface DayRow {
  date: string; // "YYYY-MM-DD"
  total: number; // absolute, expense + income summed
  count: number;
}
interface DailySpendResp {
  days: DayRow[];
}

/** GitHub-contributions-style heatmap of daily spend.
 *
 * 7 rows (Mon–Sun) × N weeks, each cell is one day. Colour
 * intensity = total absolute spend that day, scaled `sqrt` so a
 * single big day doesn't drown the dimmer ones to invisibility.
 * Hover → tooltip with date / amount / transaction count. Click
 * → `/transactions?from=<date>&to=<date>` so the operator can
 * audit that day's rows.
 *
 * No Recharts component needed — straight Tailwind grid of
 * `<button>`s with `bg-indigo-500/{n}` opacity tiers. */
export function DailyHeatmapReport({
  from,
  to,
  accountIds,
  hideTransfers,
}: {
  from: string;
  to: string;
  accountIds: string[];
  hideTransfers: boolean;
}) {
  const params = new URLSearchParams({ from, to });
  if (accountIds.length > 0) params.set("accountIds", accountIds.join(","));
  if (hideTransfers) params.set("hideTransfers", "true");
  const url = `/api/reports/daily-spend?${params}`;
  const { data, isLoading } = useSWR<DailySpendResp>(url, fetcher);

  // Build a dense day grid: every calendar day from `from` to `to`
  // (filled with zeros for inactive days), then chunk into weeks
  // aligned on Monday so the heatmap rows are stable across
  // re-renders.
  const cells = useMemo(() => buildGrid(from, to, data?.days ?? []), [
    from,
    to,
    data?.days,
  ]);
  const maxTotal = useMemo(
    () => Math.max(...(data?.days.map((d) => d.total) ?? [0]), 0),
    [data?.days],
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Daily spend heatmap</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            Loading…
          </p>
        ) : cells.weeks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            No transactions in the selected window.
          </p>
        ) : (
          <div className="overflow-x-auto pb-2">
            <div className="inline-grid grid-flow-col gap-[3px]" style={{ gridTemplateRows: "repeat(7, minmax(0, 14px))" }}>
              {cells.weeks.map((week, wi) =>
                week.map((cell, di) => {
                  if (!cell) {
                    return (
                      <div
                        key={`${wi}-${di}-empty`}
                        className="w-[14px] h-[14px]"
                      />
                    );
                  }
                  const intensity = cell.total > 0 && maxTotal > 0
                    ? Math.min(1, Math.sqrt(cell.total / maxTotal))
                    : 0;
                  const tier = bucket(intensity);
                  return (
                    <Link
                      key={cell.date}
                      href={`/transactions?from=${cell.date}&to=${cell.date}${
                        accountIds.length > 0
                          ? `&accountIds=${accountIds.join(",")}`
                          : ""
                      }`}
                      className={cn(
                        "w-[14px] h-[14px] rounded-sm transition-colors border border-transparent",
                        tier === 0 && "bg-muted",
                        tier === 1 && "bg-indigo-500/15",
                        tier === 2 && "bg-indigo-500/30",
                        tier === 3 && "bg-indigo-500/55",
                        tier === 4 && "bg-indigo-500/80",
                        "hover:border-indigo-400",
                      )}
                      title={`${cell.date} · ${formatAUD(cell.total)} · ${cell.count} txn${cell.count === 1 ? "" : "s"}`}
                    />
                  );
                }),
              )}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>Less</span>
              {[0, 1, 2, 3, 4].map((t) => (
                <span
                  key={t}
                  className={cn(
                    "w-[14px] h-[14px] rounded-sm",
                    t === 0 && "bg-muted",
                    t === 1 && "bg-indigo-500/15",
                    t === 2 && "bg-indigo-500/30",
                    t === 3 && "bg-indigo-500/55",
                    t === 4 && "bg-indigo-500/80",
                  )}
                />
              ))}
              <span>More</span>
              <span className="ml-4">
                Peak day: {formatAUD(maxTotal)}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Bucket a 0..1 intensity into one of five tiers. sqrt-scaled
 * upstream so the distribution doesn't pile everything into the
 * lowest tier when the max-day is much larger than the rest. */
function bucket(x: number): 0 | 1 | 2 | 3 | 4 {
  if (x <= 0) return 0;
  if (x < 0.25) return 1;
  if (x < 0.5) return 2;
  if (x < 0.75) return 3;
  return 4;
}

/** Build the heatmap grid for [from..to]. Returns weeks as
 * columns (left-to-right = oldest-to-newest) each containing 7
 * cells (Mon..Sun, top-to-bottom) or `null` for "before from /
 * after to" padding cells. */
function buildGrid(
  from: string,
  to: string,
  days: DayRow[],
): { weeks: (DayRow | null)[][] } {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const start = parseISO(from);
  const end = parseISO(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { weeks: [] };
  }
  // Align the first column to Monday so all rows line up.
  const weekStart = startOfWeek(start, { weekStartsOn: 1 });
  const weeks: (DayRow | null)[][] = [];
  let cursor = weekStart;
  while (cursor <= end) {
    const week: (DayRow | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(cursor, i);
      if (day < start || day > end) {
        week.push(null);
        continue;
      }
      const iso = format(day, "yyyy-MM-dd");
      week.push(byDate.get(iso) ?? { date: iso, total: 0, count: 0 });
    }
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }
  return { weeks };
}

