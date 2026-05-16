"use client";

import { Fragment, useEffect, useState } from "react";
import useSWR from "swr";
import { format, parseISO } from "date-fns";
import { ChevronDown, ChevronRight, Printer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { AccountsCashflowReport } from "@/app/api/reports/accounts-cashflow/route";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const numFmt = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });

function monthLabel(m: string): string {
  return format(parseISO(`${m}-01`), "MMM ''yy");
}

type CellMode = "credit" | "debit" | "balance";

function formatCell(value: number | undefined, mode: CellMode): {
  text: string;
  className: string;
} {
  if (value === undefined || value === 0) {
    return { text: "—", className: "text-muted-foreground" };
  }
  if (mode === "balance") {
    if (value < 0) {
      return {
        text: `(${numFmt.format(Math.abs(value))})`,
        className: "text-rose-600 dark:text-rose-400",
      };
    }
    return {
      text: numFmt.format(value),
      className: "text-foreground",
    };
  }
  if (mode === "credit") {
    return {
      text: numFmt.format(value),
      className: "text-emerald-600 dark:text-emerald-400",
    };
  }
  // debit — always positive here (server sends abs)
  return {
    text: numFmt.format(value),
    className: "text-rose-600 dark:text-rose-400",
  };
}

export function AccountsCashflowReport({
  from,
  to,
  accountIds,
}: {
  from: string;
  to: string;
  accountIds: string[];
}) {
  const accountIdsParam =
    accountIds.length > 0 ? `&accountIds=${accountIds.join(",")}` : "";
  const { data, isLoading } = useSWR<AccountsCashflowReport>(
    `/api/reports/accounts-cashflow?from=${from}&to=${to}${accountIdsParam}`,
    fetcher,
  );

  // Default to expanded so the operator sees the credit/debit/balance
  // detail immediately; click an account header to collapse it. Stored
  // as a Set of collapsed ids (so a fresh load = all expanded).
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    setCollapsedIds(new Set());
  }, [from, to, accountIds.join(",")]);

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
    );
  }
  if (!data || data.accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No active accounts in this view.
      </p>
    );
  }

  const months = data.months;
  const accounts = data.accounts;
  const totals = data.totals;

  function toggle(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const anyCollapsed = accounts.some((a) => collapsedIds.has(a.id));
  function collapseAll() {
    setCollapsedIds(new Set(accounts.map((a) => a.id)));
  }
  function expandAll() {
    setCollapsedIds(new Set());
  }

  return (
    <Card data-print-area>
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Account balance over time
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Credits in, debits out, and closing balance per month for
              each active account. Expand a row to see the three series;
              the bottom row totals across accounts.
            </p>
          </div>
          <div className="flex items-center gap-2 print:hidden" data-print-hide>
            {accounts.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={anyCollapsed ? expandAll : collapseAll}
              >
                {anyCollapsed ? (
                  <>
                    <ChevronDown className="h-3.5 w-3.5 mr-1" /> Expand all
                  </>
                ) : (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 mr-1" /> Collapse all
                  </>
                )}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-1.5" /> Print
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium sticky left-0 bg-muted/40 z-10">
                  Account / Metric
                </th>
                {months.map((m) => (
                  <th
                    key={m}
                    className="px-3 py-2 text-right font-medium tabular-nums"
                  >
                    {monthLabel(m)}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium border-l">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {accounts.map((a) => {
                const isCollapsed = collapsedIds.has(a.id);
                const Chev = isCollapsed ? ChevronRight : ChevronDown;
                return (
                  <Fragment key={a.id}>
                    {/* Account header row — name + colour swatch, expand
                        handle. No data in the month columns; the
                        sub-rows below own credit/debit/balance. */}
                    <tr
                      className="bg-muted/20 hover:bg-muted/30 cursor-pointer font-medium"
                      onClick={() => toggle(a.id)}
                    >
                      <td className="px-3 py-1.5 sticky left-0 bg-muted/20 z-10">
                        <span className="inline-flex items-center gap-2">
                          <Chev className="h-3.5 w-3.5 text-muted-foreground" />
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: a.color }}
                          />
                          <span>{a.name}</span>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {a.type}
                          </span>
                        </span>
                      </td>
                      {months.map((m) => (
                        <td
                          key={m}
                          className="px-3 py-1.5 text-right tabular-nums text-muted-foreground"
                        />
                      ))}
                      <td className="px-3 py-1.5 text-right tabular-nums border-l text-muted-foreground" />
                    </tr>
                    {!isCollapsed && (
                      <>
                        <MetricRow
                          label="Credits"
                          mode="credit"
                          months={months}
                          values={a.creditByMonth}
                          total={a.totalCredit}
                        />
                        <MetricRow
                          label="Debits"
                          mode="debit"
                          months={months}
                          values={a.debitByMonth}
                          total={a.totalDebit}
                        />
                        <MetricRow
                          label="Balance"
                          mode="balance"
                          months={months}
                          values={a.balanceByMonth}
                          /* Closing balance is a snapshot, not a sum —
                             show the last month's value in the Total
                             column rather than a meaningless sum across
                             months. */
                          total={a.closingBalance}
                          totalIsSnapshot
                        />
                      </>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 bg-muted/40 font-semibold">
                <td
                  className="px-3 py-2 sticky left-0 bg-muted/40 z-10"
                  colSpan={1}
                >
                  All accounts
                </td>
                {months.map((m) => (
                  <td key={m} className="px-3 py-2 text-right tabular-nums" />
                ))}
                <td className="px-3 py-2 text-right tabular-nums border-l" />
              </tr>
              <MetricRow
                label="Credits"
                mode="credit"
                months={months}
                values={totals.creditByMonth}
                total={totals.totalCredit}
                tfoot
              />
              <MetricRow
                label="Debits"
                mode="debit"
                months={months}
                values={totals.debitByMonth}
                total={totals.totalDebit}
                tfoot
              />
              <MetricRow
                label="Balance"
                mode="balance"
                months={months}
                values={totals.balanceByMonth}
                total={totals.closingBalance}
                totalIsSnapshot
                tfoot
              />
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricRow({
  label,
  mode,
  months,
  values,
  total,
  totalIsSnapshot,
  tfoot,
}: {
  label: string;
  mode: CellMode;
  months: string[];
  values: Record<string, number>;
  total: number;
  totalIsSnapshot?: boolean;
  tfoot?: boolean;
}) {
  const totalCell = formatCell(total, mode);
  // The Total column is misleading for a snapshot metric (balance),
  // so we show the closing-balance value but skip the per-mode tint.
  const totalClass = totalIsSnapshot ? "text-foreground" : totalCell.className;
  const rowBg = tfoot ? "bg-muted/30" : "";
  return (
    <tr className={`hover:bg-muted/20 ${rowBg}`}>
      <td
        className={`px-3 py-1 pl-9 text-xs text-muted-foreground sticky left-0 z-10 ${
          tfoot ? "bg-muted/30" : "bg-background"
        }`}
      >
        {label}
      </td>
      {months.map((m) => {
        const cell = formatCell(values[m], mode);
        return (
          <td
            key={m}
            className={`px-3 py-1 text-right tabular-nums ${cell.className}`}
          >
            {cell.text}
          </td>
        );
      })}
      <td
        className={`px-3 py-1 text-right tabular-nums font-semibold border-l ${totalClass}`}
      >
        {total === 0 ? "—" : totalCell.text}
      </td>
    </tr>
  );
}
