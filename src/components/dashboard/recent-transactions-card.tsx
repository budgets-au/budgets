"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAUD, amountClass, formatDate } from "@/lib/utils";
import type { RecentTransactionRow } from "@/lib/dashboard/recent-transactions";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ApiPayload {
  rows: RecentTransactionRow[];
}

/** Same row height as the upcoming widget so the two cards visually
 * line up when placed side-by-side. */
const ROW_HEIGHT_PX = 32;

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
  const { data } = useSWR<ApiPayload>(
    "/api/dashboard/recent-transactions",
    fetcher,
  );
  const rows = data?.rows ?? [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
          Recent transactions
        </CardTitle>
        <Link
          href="/transactions"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          See all →
        </Link>
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0">
        <div ref={contentRef} className="h-full overflow-hidden">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No transactions yet.
            </p>
          ) : (
            <ul className="divide-y">
              {visibleRows.map((row) => {
                const target = parseISO(row.date);
                const amt = parseFloat(row.amount);
                return (
                  <li key={row.id}>
                    <Link
                      href={`/transactions?accountId=${row.accountId}`}
                      className="grid items-center gap-3 px-4 py-1.5 text-sm hover:bg-muted/60 transition-colors"
                      style={{
                        gridTemplateColumns:
                          "auto auto minmax(0, 1fr) auto",
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
                        {row.payee ?? row.description ?? "—"}
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
