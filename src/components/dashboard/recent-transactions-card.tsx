"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { parseISO } from "date-fns";
import { StickyNote } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAUD, amountClass, formatDate } from "@/lib/utils";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import type { RecentTransactionRow } from "@/lib/dashboard/recent-transactions";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ApiPayload {
  rows: RecentTransactionRow[];
}

/** Same row height as the upcoming widget when notes are off so the
 * two cards visually line up when placed side-by-side. When notes
 * are on, rows extend to a two-line layout — ~48 px each — and the
 * dynamic row-count calc widens to match. */
const ROW_HEIGHT_PX = 32;
const ROW_HEIGHT_WITH_NOTES_PX = 48;

function relativeWord(today: Date, target: Date): string {
  const ms = today.getTime() - target.getTime();
  const days = Math.round(ms / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 14) return "Last week";
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return formatDate(target);
}

/** Most-recent transactions card. Modelled on UpcomingSchedulesCard —
 * SWR-fetched payload, ResizeObserver-driven dynamic row count, same
 * row height + grid rhythm so the two cards rhyme visually. Each
 * row deep-links into the transactions page filtered to its account
 * so the operator can drill in. */
export function RecentTransactionsCard() {
  const { prefs, setPref } = useDisplayPrefs();
  const showNotes = prefs.dashboardRecentShowNotes;
  const { data } = useSWR<ApiPayload>(
    "/api/dashboard/recent-transactions",
    fetcher,
  );
  const rows = data?.rows ?? [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const [maxRows, setMaxRows] = useState<number>(rows.length);

  const rowHeight = showNotes ? ROW_HEIGHT_WITH_NOTES_PX : ROW_HEIGHT_PX;
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      setMaxRows(Math.max(0, Math.floor(h / rowHeight)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [rowHeight]);

  const visibleRows = rows.slice(0, maxRows);

  return (
    <Card data-size="sm" className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-1 flex flex-row items-center justify-between shrink-0 gap-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Recent transactions
        </CardTitle>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPref("dashboardRecentShowNotes", !showNotes)}
            aria-pressed={showNotes}
            title={showNotes ? "Hide notes" : "Show notes"}
            className={`inline-flex items-center gap-1 rounded text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 transition-colors ${
              showNotes
                ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <StickyNote className="h-3 w-3" />
            Notes
          </button>
          <Link
            href="/transactions"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            See all →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0">
        <div ref={contentRef} className="h-full overflow-hidden">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No transactions yet.
            </p>
          ) : (
            // Single grid container (not per-row) so columns
            // auto-size to the widest content across ALL rows. Each
            // <li> + <Link> uses grid-cols-subgrid to inherit the
            // parent's tracks — keeps <Link> semantics while giving
            // table-style column alignment that per-row grids
            // can't.
            <ul
              className="divide-y grid gap-x-3"
              style={{
                gridTemplateColumns:
                  "auto auto minmax(0, 1fr) auto",
              }}
            >
              {visibleRows.map((row) => {
                const target = parseISO(row.date);
                const amt = parseFloat(row.amount);
                return (
                  <li
                    key={row.id}
                    className="col-span-full grid grid-cols-subgrid items-center hover:bg-muted/60 transition-colors"
                  >
                    <Link
                      href={`/transactions?accountId=${row.accountId}`}
                      className="col-span-full grid grid-cols-subgrid items-center text-sm"
                    >
                      <span className="pl-4 py-1.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {relativeWord(today, target)}
                      </span>
                      <span className="py-1.5 hidden sm:flex justify-start min-w-0">
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
                      <span className="py-1.5 min-w-0 flex flex-col leading-tight">
                        <span className="font-medium truncate">
                          {row.payee ?? row.description ?? "—"}
                        </span>
                        {showNotes && row.notes && (
                          <span className="text-[10px] text-muted-foreground italic truncate">
                            {row.notes}
                          </span>
                        )}
                      </span>
                      <span
                        className={`pr-4 py-1.5 tabular-nums font-medium whitespace-nowrap text-right ${amountClass(amt)}`}
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
