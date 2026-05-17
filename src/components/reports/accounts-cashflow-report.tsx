"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { format, parseISO, endOfMonth } from "date-fns";
import { ChevronDown, ChevronRight, Printer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { AccountsCashflowReport } from "@/app/api/reports/accounts-cashflow/route";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const numFmt = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });

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
                          accountId={a.id}
                          periodFrom={from}
                          periodTo={to}
                        />
                        <MetricRow
                          label="Debits"
                          mode="debit"
                          months={months}
                          values={a.debitByMonth}
                          total={a.totalDebit}
                          accountId={a.id}
                          periodFrom={from}
                          periodTo={to}
                        />
                        <MetricRow
                          label="Net (credits − debits)"
                          mode="net"
                          months={months}
                          values={netSeries(a.creditByMonth, a.debitByMonth, months)}
                          total={a.totalCredit - a.totalDebit}
                          accountId={a.id}
                          periodFrom={from}
                          periodTo={to}
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
                            counterpartyId={cp.counterpartyId}
                            periodFrom={from}
                            periodTo={to}
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
                            counterpartyId={cp.counterpartyId}
                            periodFrom={from}
                            periodTo={to}
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
                          periodFrom={from}
                          periodTo={to}
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
              />
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** Build a /transactions URL for a single cell. The slice param
 *  picks which month (a "YYYY-MM" string) or the whole period
 *  ("total"). Returns null when the cell shouldn't be a link —
 *  e.g. a zero value or the snapshot Total column on the Balance
 *  row (where the number is a closing-balance, not a sum of
 *  transactions). */
function buildCellHref(opts: {
  mode: CellMode;
  slice: string | "total";
  periodFrom: string;
  periodTo: string;
  accountId?: string;
  /** Counterparty constraint for the per-counterparty transfer rows.
   *  Use the account's uuid for a known counterparty, `null` for the
   *  External bucket (transfers with no paired leg recorded), or
   *  `undefined` for non-per-counterparty rows (no constraint). */
  counterpartyId?: string | null;
}): string | null {
  const { mode, slice, periodFrom, periodTo, accountId, counterpartyId } = opts;
  // Balance cells are closing-balance snapshots, not sums of the
  // transactions in the window — clicking them would land on a list
  // that doesn't add up to the displayed number. Unlinked at every
  // slice (the Total column was already unlinked via the
  // `totalIsSnapshot` short-circuit at the call site).
  if (mode === "balance") return null;
  // Resolve the date window: a specific month → that month's first
  // and last day; "total" → the whole report range.
  let from: string;
  let to: string;
  if (slice === "total") {
    from = periodFrom;
    to = periodTo;
  } else {
    const start = parseISO(`${slice}-01`);
    from = `${slice}-01`;
    to = format(endOfMonth(start), "yyyy-MM-dd");
  }
  const params = new URLSearchParams();
  params.set("from", from);
  params.set("to", to);
  if (accountId) params.set("accountIds", accountId);
  // Metric → filter mapping. Credits and Debits filter by amount
  // sign; transfer rows additionally restrict to paired/categorised
  // transfers via `transfersFilter=only` so the user sees only the
  // matched legs. Net doesn't add a metric filter; the
  // account-window slice is the relevant lens.
  if (mode === "credit") params.set("direction", "in");
  else if (mode === "debit") params.set("direction", "out");
  else if (mode === "transferIn") {
    params.set("direction", "in");
    params.set("transfersFilter", "only");
  } else if (mode === "transferOut") {
    params.set("direction", "out");
    params.set("transfersFilter", "only");
  }
  // Per-counterparty rows: constrain to the OTHER leg's account so
  // the resulting list sums to the clicked cell (rather than to
  // every transfer in the direction). `null` is the External bucket
  // — transfers with no paired leg recorded. `undefined` skips this
  // entirely.
  if (counterpartyId === null) {
    params.set("transferPairAccountId", "external");
  } else if (counterpartyId !== undefined) {
    params.set("transferPairAccountId", counterpartyId);
  }
  return `/transactions?${params.toString()}`;
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
  counterpartyId,
  periodFrom,
  periodTo,
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
  /** When set, the cells become drill-down links scoped to this
   *  account. Omit for the all-accounts footer (the resulting URLs
   *  span all visible accounts via the default account filter). */
  accountId?: string;
  /** Per-counterparty constraint. uuid → drill to the OTHER leg's
   *  account; null → External bucket (no paired leg); undefined →
   *  not a per-counterparty row (no constraint). */
  counterpartyId?: string | null;
  /** Report-window bounds, used by the "Total" column's URL builder
   *  and as fallback when no month is selected. */
  periodFrom: string;
  periodTo: string;
}) {
  const totalCell = formatCell(total, mode);
  // The Total column is misleading for a snapshot metric (balance),
  // so we show the closing-balance value but skip the per-mode tint.
  const totalClass = totalIsSnapshot ? "text-foreground" : totalCell.className;
  const rowBg = tfoot ? "bg-muted/30" : "";
  const renderCellContent = (
    text: string,
    cellClass: string,
    href: string | null,
  ) => {
    if (!href || text === "—") {
      return <span className={cellClass}>{text}</span>;
    }
    return (
      <Link
        href={href}
        className={`${cellClass} hover:underline hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors`}
      >
        {text}
      </Link>
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
        const href = buildCellHref({
          mode,
          slice: m,
          periodFrom,
          periodTo,
          accountId,
          counterpartyId,
        });
        return (
          <td
            key={m}
            className={`px-3 py-1 text-right tabular-nums ${cell.className}`}
          >
            {renderCellContent(cell.text, "", href)}
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
          // link there. Every other metric: link to the whole-period
          // filtered view.
          totalIsSnapshot
            ? null
            : buildCellHref({
                mode,
                slice: "total",
                periodFrom,
                periodTo,
                accountId,
                counterpartyId,
              }),
        )}
      </td>
    </tr>
  );
}
