"use client";

import useSWR from "swr";
import Link from "next/link";
import { Repeat } from "lucide-react";
import { addDays, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { colourForFrequency, freqLabel } from "@/lib/schedule-colours";
import { formatAUD, amountClass, formatDate } from "@/lib/utils";
import type { UpcomingScheduleRow } from "@/lib/dashboard/upcoming-schedules";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ApiPayload {
  rows: UpcomingScheduleRow[];
  horizonDays: number;
}

function relativeWord(today: Date, target: Date): string {
  const ms = target.getTime() - today.getTime();
  const days = Math.round(ms / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `In ${days} days`;
  if (days < 14) return "Next week";
  if (days < 30) return `In ${Math.floor(days / 7)} weeks`;
  return formatDate(target);
}

/** Next-30-days upcoming scheduled occurrences. Backed by
 * /api/dashboard/upcoming which expands recurrences server-side and
 * filters out anything that already has a matching posted txn. */
export function UpcomingSchedulesCard() {
  const { data } = useSWR<ApiPayload>("/api/dashboard/upcoming", fetcher);
  const rows = data?.rows ?? [];
  const horizonDays = data?.horizonDays ?? 30;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <Card data-size="sm" className="h-full">
      <CardHeader className="pb-1 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Upcoming
        </CardTitle>
        <Link
          href="/scheduled"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          See all →
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nothing due in the next {horizonDays} days.
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((row, i) => {
              const target = parseISO(row.date);
              const amt = parseFloat(row.amount);
              return (
                <li key={`${row.scheduledId}-${row.date}-${i}`}>
                  <Link
                    href={`/scheduled?id=${row.scheduledId}`}
                    className="grid items-center gap-3 px-4 py-1.5 text-sm hover:bg-muted/60 transition-colors"
                    style={{
                      gridTemplateColumns:
                        "90px 90px minmax(0, 1fr) 110px 90px",
                    }}
                  >
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-white text-[10px] font-medium whitespace-nowrap justify-self-start"
                      style={{ backgroundColor: colourForFrequency(row.frequency) }}
                    >
                      <Repeat className="h-2.5 w-2.5" aria-hidden="true" />
                      {freqLabel(row.frequency, row.interval)}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {relativeWord(today, target)}
                    </span>
                    <span className="font-medium truncate min-w-0">
                      {row.payee ?? "—"}
                    </span>
                    <span className="hidden sm:flex justify-start min-w-0">
                      {row.accountName && (
                        <span
                          className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap truncate max-w-full"
                          style={{
                            backgroundColor: row.accountColor ?? "#94a3b8",
                          }}
                        >
                          {row.accountName}
                        </span>
                      )}
                    </span>
                    <span
                      className={`tabular-nums font-medium whitespace-nowrap text-right ${amountClass(amt)}`}
                    >
                      {formatAUD(amt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
