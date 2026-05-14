"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { colourForFrequency, freqLabel } from "@/lib/schedule-colours";
import { formatAUD, amountClass, formatDate } from "@/lib/utils";
import type { UpcomingScheduleRow } from "@/lib/dashboard/upcoming-schedules";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ApiPayload {
  rows: UpcomingScheduleRow[];
  horizonDays: number;
}

/** Approximate per-row height in pixels. py-1.5 (12px) + ~20px
 * for the text line + 1px divider ≈ 33px; round down to 32 so a
 * row that almost fits never gets pre-clipped. */
const ROW_HEIGHT_PX = 32;

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
 * filters out anything that already has a matching posted txn.
 *
 * The card slices the API's rows to whatever count fits its
 * rendered height — resize the widget tile up to show more, or
 * down to show fewer. The API hands back up to 50 rows so even a
 * generous resize doesn't run out of items. */
export function UpcomingSchedulesCard() {
  const { data } = useSWR<ApiPayload>("/api/dashboard/upcoming", fetcher);
  const rows = data?.rows ?? [];
  const horizonDays = data?.horizonDays ?? 30;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Dynamically size the visible row count based on the card's
  // measured inner-content height. Starts at the full row count so
  // the first paint isn't an empty list; ResizeObserver tightens it
  // after the layout settles.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [maxRows, setMaxRows] = useState<number>(rows.length);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      setMaxRows(Math.max(0, Math.floor(h / ROW_HEIGHT_PX)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visibleRows = rows.slice(0, maxRows);

  return (
    <Card data-size="sm" className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-1 flex flex-row items-center justify-between shrink-0">
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
      <CardContent className="p-0 flex-1 min-h-0">
        <div ref={contentRef} className="h-full overflow-hidden">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nothing due in the next {horizonDays} days.
            </p>
          ) : (
            <ul className="divide-y">
              {visibleRows.map((row, i) => {
                const target = parseISO(row.date);
                const amt = parseFloat(row.amount);
                return (
                  <li
                    key={`${row.scheduledId}-${row.date}-${i}`}
                    className="relative"
                  >
                    {/* Frequency colour now reads as a thin left-edge
                    highlight rather than a full pill — that frees the
                    payee column to span the rest of the row right up
                    to the account + amount cluster, which was the
                    point. Accessible name preserved on the bar so the
                    frequency info isn't lost to sighted-only callers. */}
                    <span
                      aria-label={freqLabel(row.frequency, row.interval)}
                      className="absolute left-0 inset-y-1 w-1 rounded-r-sm"
                      style={{
                        backgroundColor: colourForFrequency(row.frequency),
                      }}
                    />
                    <Link
                      href={`/scheduled?id=${row.scheduledId}`}
                      className="grid items-center gap-3 pl-4 pr-4 py-1.5 text-sm hover:bg-muted/60 transition-colors"
                      style={{
                        gridTemplateColumns:
                          "90px auto minmax(0, 1fr) auto",
                      }}
                    >
                      <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {relativeWord(today, target)}
                      </span>
                      <span className="hidden sm:flex justify-start min-w-0 shrink-0">
                        {row.accountName && (
                          <span
                            className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap truncate max-w-[8rem]"
                            style={{
                              backgroundColor: row.accountColor ?? "#94a3b8",
                            }}
                          >
                            {row.accountName}
                          </span>
                        )}
                      </span>
                      <span className="font-medium truncate min-w-0">
                        {row.payee ?? "—"}
                      </span>
                      <span
                        className={`tabular-nums font-medium whitespace-nowrap text-right shrink-0 ${amountClass(amt)}`}
                      >
                        {formatAUD(amt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
