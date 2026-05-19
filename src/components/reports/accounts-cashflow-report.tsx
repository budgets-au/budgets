"use client";

import { Fragment, useEffect, useState } from "react";
import useSWR from "swr";
import { format, parseISO, endOfMonth } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { AccountsCashflowReport } from "@/app/api/reports/accounts-cashflow/route";
import { numFmt } from "@/lib/utils";
import {
  AccountsCellDialog,
  type AccountsCellQuery,
} from "./accounts-cell-dialog";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function monthLabel(m: string): string {
  return format(parseISO(`${m}-01`), "MMM ''yy");
}

type CellMode =
  | "credit"
  | "debit"
  | "net"
  | "transferIn"
  | "transferOut"
  | "balance";

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
  if (mode === "net") {
    // Net (credits − debits) can be either sign; parenthesise negative
    // and tint by direction so a deficit pops at a glance.
    if (value < 0) {
      return {
        text: `(${numFmt.format(Math.abs(value))})`,
        className: "text-rose-600 dark:text-rose-400",
      };
    }
    return {
      text: numFmt.format(value),
      className: "text-emerald-600 dark:text-emerald-400",
    };
  }
  if (mode === "credit") {
    return {
      text: numFmt.format(value),
      className: "text-emerald-600 dark:text-emerald-400",
    };
  }
  if (mode === "transferIn") {
    return {
      text: numFmt.format(value),
      className: "text-sky-600 dark:text-sky-400",
    };
  }
  if (mode === "transferOut") {
    return {
      text: numFmt.format(value),
      className: "text-amber-600 dark:text-amber-400",
    };
  }
  // debit — always positive here (server sends abs)
  return {
    text: numFmt.format(value),
    className: "text-rose-600 dark:text-rose-400",
  };
}

/** Cheap per-month derivation so the UI doesn't have to thread a "net"
 * series through state — credits and debits are already in hand. */
function netSeries(
  credit: Record<string, number>,
  debit: Record<string, number>,
  months: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of months) {
    out[m] = (credit[m] ?? 0) - (debit[m] ?? 0);
  }
  return out;
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

  // Drill-through popup state — mirrors the Cashflow report's
  // CellOpenerContext pattern but the accounts-cashflow shape is
  // small enough to thread setCellQuery directly as a prop instead
  // of wrapping in a Context.
  const [cellQuery, setCellQuery] = useState<AccountsCellQuery | null>(null);

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
    <Card data-print-area className="print-landscape">
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
            {/* Print lives on the page-level Reports toolbar (next
                to the global profile chip) — no second one here. */}
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
                          accountId={a.id}
                          accountName={a.name}
                          periodFrom={from}
                          periodTo={to}
                          openCell={setCellQuery}
                        />
                        <MetricRow
                          label="Debits"
                          mode="debit"
                          months={months}
                          values={a.debitByMonth}
                          total={a.totalDebit}
                          accountId={a.id}
                          accountName={a.name}
                          periodFrom={from}
                          periodTo={to}
                          openCell={setCellQuery}
                        />
                        <MetricRow
                          label="Net (credits − debits)"
                          mode="net"
                          months={months}
                          values={netSeries(a.creditByMonth, a.debitByMonth, months)}
                          total={a.totalCredit - a.totalDebit}
                          accountId={a.id}
                          accountName={a.name}
                          periodFrom={from}
                          periodTo={to}
                          openCell={setCellQuery}
                        />
                        {a.transferInBy.map((cp) => (
                          <MetricRow
                            key={`in-${cp.counterpartyId ?? "external"}`}
                            label={`Transfer in from ${cp.counterpartyName}`}
                            swatch={cp.counterpartyColor}
                            mode="transferIn"
                            months={months}
                            values={cp.byMonth}
                            total={cp.total}
                            accountId={a.id}
                            accountName={a.name}
                            counterpartyId={cp.counterpartyId}
                            periodFrom={from}
                            periodTo={to}
                            openCell={setCellQuery}
                          />
                        ))}
                        {a.transferOutBy.map((cp) => (
                          <MetricRow
                            key={`out-${cp.counterpartyId ?? "external"}`}
                            label={`Transfer out to ${cp.counterpartyName}`}
                            swatch={cp.counterpartyColor}
                            mode="transferOut"
                            months={months}
                            values={cp.byMonth}
                            total={cp.total}
                            accountId={a.id}
                            accountName={a.name}
                            counterpartyId={cp.counterpartyId}
                            periodFrom={from}
                            periodTo={to}
                            openCell={setCellQuery}
                          />
                        ))}
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
                          accountId={a.id}
                          accountName={a.name}
                          periodFrom={from}
                          periodTo={to}
                          openCell={setCellQuery}
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
                periodFrom={from}
                periodTo={to}
                openCell={setCellQuery}
              />
              <MetricRow
                label="Debits"
                mode="debit"
                months={months}
                values={totals.debitByMonth}
                total={totals.totalDebit}
                tfoot
                periodFrom={from}
                periodTo={to}
                openCell={setCellQuery}
              />
              <MetricRow
                label="Net (credits − debits)"
                mode="net"
                months={months}
                values={netSeries(totals.creditByMonth, totals.debitByMonth, months)}
                total={totals.totalCredit - totals.totalDebit}
                tfoot
                periodFrom={from}
                periodTo={to}
                openCell={setCellQuery}
              />
              <MetricRow
                label="Transfer in"
                mode="transferIn"
                months={months}
                values={totals.transferInByMonth}
                total={totals.totalTransferIn}
                tfoot
                periodFrom={from}
                periodTo={to}
                openCell={setCellQuery}
              />
              <MetricRow
                label="Transfer out"
                mode="transferOut"
                months={months}
                values={totals.transferOutByMonth}
                total={totals.totalTransferOut}
                tfoot
                periodFrom={from}
                periodTo={to}
                openCell={setCellQuery}
              />
              <MetricRow
                label="Balance"
                mode="balance"
                months={months}
                values={totals.balanceByMonth}
                total={totals.closingBalance}
                totalIsSnapshot
                tfoot
                periodFrom={from}
                periodTo={to}
                openCell={setCellQuery}
              />
            </tfoot>
          </table>
        </div>
      </CardContent>
      <AccountsCellDialog
        query={cellQuery}
        onClose={() => setCellQuery(null)}
      />
    </Card>
  );
}

/** Build the AccountsCellQuery payload for a single cell. Returns
 *  null when the cell shouldn't open the popup — e.g. a zero value,
 *  a Balance cell (closing-balance snapshot, not a sum), or any cell
 *  whose underlying filter wouldn't tell the user anything useful. */
function buildCellQuery(opts: {
  mode: CellMode;
  slice: string | "total";
  periodFrom: string;
  periodTo: string;
  accountId?: string;
  accountName?: string;
  rowLabel: string;
  counterpartyId?: string | null;
}): AccountsCellQuery | null {
  const {
    mode,
    slice,
    periodFrom,
    periodTo,
    accountId,
    accountName,
    rowLabel,
    counterpartyId,
  } = opts;
  // Balance cells are closing-balance snapshots, not sums of the
  // transactions in the window — opening the popup would land on a
  // list that doesn't add up to the displayed number.
  if (mode === "balance") return null;
  // Resolve the date window: a specific month → that month's first
  // and last day; "total" → the whole report range.
  let from: string;
  let to: string;
  let rangeLabel: string;
  if (slice === "total") {
    from = periodFrom;
    to = periodTo;
    rangeLabel = `${format(parseISO(periodFrom), "MMM yyyy")} – ${format(parseISO(periodTo), "MMM yyyy")}`;
  } else {
    const start = parseISO(`${slice}-01`);
    from = `${slice}-01`;
    to = format(endOfMonth(start), "yyyy-MM-dd");
    rangeLabel = format(start, "MMM ''yy");
  }
  const accountPart = accountName ?? "All accounts";
  return {
    mode: mode as Exclude<CellMode, "balance">,
    from,
    to,
    rangeLabel,
    displayName: `${accountPart} · ${rowLabel}`,
    accountId,
    counterpartyId,
  };
}

function MetricRow({
  label,
  swatch,
  mode,
  months,
  values,
  total,
  totalIsSnapshot,
  tfoot,
  accountId,
  accountName,
  counterpartyId,
  periodFrom,
  periodTo,
  openCell,
}: {
  label: string;
  /** Optional small colour dot rendered next to the label — used by
   *  the per-counterparty transfer rows to show which account the
   *  money came from / went to. */
  swatch?: string | null;
  mode: CellMode;
  months: string[];
  values: Record<string, number>;
  total: number;
  totalIsSnapshot?: boolean;
  tfoot?: boolean;
  /** When set, the cells open a drill-down popup scoped to this
   *  account. Omit for the all-accounts footer (the resulting view
   *  spans all visible accounts via the default account filter). */
  accountId?: string;
  /** Display name of the account for the popup title. Omit on the
   *  all-accounts footer to render "All accounts" instead. */
  accountName?: string;
  /** Per-counterparty constraint. uuid → drill to the OTHER leg's
   *  account; null → External bucket (no paired leg); undefined →
   *  not a per-counterparty row (no constraint). */
  counterpartyId?: string | null;
  /** Report-window bounds, used by the "Total" column's query builder
   *  and as fallback when no month is selected. */
  periodFrom: string;
  periodTo: string;
  /** Open the cell drill-through popup. */
  openCell: (q: AccountsCellQuery) => void;
}) {
  const totalCell = formatCell(total, mode);
  // The Total column is misleading for a snapshot metric (balance),
  // so we show the closing-balance value but skip the per-mode tint.
  const totalClass = totalIsSnapshot ? "text-foreground" : totalCell.className;
  const rowBg = tfoot ? "bg-muted/30" : "";
  const renderCellContent = (
    text: string,
    cellClass: string,
    query: AccountsCellQuery | null,
  ) => {
    if (!query || text === "—") {
      return <span className={cellClass}>{text}</span>;
    }
    return (
      <button
        type="button"
        onClick={() => openCell(query)}
        className={`${cellClass} hover:underline hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer bg-transparent border-0 p-0 font-inherit text-inherit text-right tabular-nums`}
      >
        {text}
      </button>
    );
  };
  return (
    <tr className={`hover:bg-muted/20 ${rowBg}`}>
      <td
        className={`px-3 py-1 pl-9 text-xs text-muted-foreground sticky left-0 z-10 ${
          tfoot ? "bg-muted/30" : "bg-background"
        }`}
      >
        {swatch ? (
          <span
            className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
            style={{ backgroundColor: swatch }}
          />
        ) : null}
        {label}
      </td>
      {months.map((m) => {
        const cell = formatCell(values[m], mode);
        const query = buildCellQuery({
          mode,
          slice: m,
          periodFrom,
          periodTo,
          accountId,
          accountName,
          rowLabel: label,
          counterpartyId,
        });
        return (
          <td
            key={m}
            className={`px-3 py-1 text-right tabular-nums ${cell.className}`}
          >
            {renderCellContent(cell.text, "", query)}
          </td>
        );
      })}
      <td
        className={`px-3 py-1 text-right tabular-nums font-semibold border-l ${totalClass}`}
      >
        {renderCellContent(
          total === 0 ? "—" : totalCell.text,
          "",
          // Balance's "Total" is a closing-balance snapshot, not a
          // sum of transactions — clicking it would land on a list
          // that wouldn't add up to the displayed number. Skip the
          // popup there. Every other metric: open the whole-period
          // filtered view.
          totalIsSnapshot
            ? null
            : buildCellQuery({
                mode,
                slice: "total",
                periodFrom,
                periodTo,
                accountId,
                accountName,
                rowLabel: label,
                counterpartyId,
              }),
        )}
      </td>
    </tr>
  );
}
