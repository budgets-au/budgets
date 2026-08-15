"use client";

import { format, parseISO } from "date-fns";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/state-message";
import { useSwrJson } from "@/hooks/use-swr-json";
import {
  amountClass,
  formatAUDShort,
  MONEY_NEGATIVE_CLASS,
  MONEY_POSITIVE_CLASS,
} from "@/lib/utils";
import type { CashflowReport as CashflowData } from "@/app/api/reports/cashflow/route";
import { RankedList, type RankedRow } from "./_shared/ranked-list";
import {
  topMovers,
  streaksOverPlan,
  newThisMonth,
  fastestGrowing,
} from "./_shared/anomaly-calcs";

/** Trend / Anomaly report — four ranked panels answering "what's
 *  shifted lately?":
 *  1. Top movers vs 3-month rolling average (income + expenses).
 *  2. Streaks over plan ≥ 2 months (expenses only — over-income is
 *     a good thing).
 *  3. New this month — categories that had $0 in the prior 3
 *     months but non-zero now.
 *  4. Fastest-accelerating expense spend by 3-month growth rate.
 *
 *  All four views compute client-side from a single cashflow fetch.
 *  The window this consumes needs ≥ 4 months of report data for the
 *  rolling comparisons to be meaningful; shorter periods show empty
 *  panels with a hint. */
export function AnomaliesReport({
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
  const {
    data: cashflow,
    isLoading,
    error,
    mutate: retry,
  } = useSwrJson<CashflowData>(
    `/api/reports/cashflow?from=${from}&to=${to}&hideTransfers=true${accountIdsParam}`,
  );

  if (isLoading) {
    return <LoadingState label="Loading trend + anomaly surface…" />;
  }
  if (error) {
    return (
      <ErrorState
        label="Couldn’t load the anomalies report."
        onRetry={() => retry()}
      />
    );
  }
  if (!cashflow || cashflow.months.length === 0) {
    return <EmptyState>No data for this period.</EmptyState>;
  }

  const months = cashflow.months;
  const lastMonth = months[months.length - 1];
  const lastMonthLabel = format(parseISO(`${lastMonth}-01`), "MMM ''yy");
  const insufficientData = months.length < 4;

  const allCats = [...cashflow.income, ...cashflow.expenses];
  const movers = topMovers(allCats, months, 5);
  const streaks = streaksOverPlan(cashflow.expenses, months, 5);
  const newRows = newThisMonth(allCats, months, 5);
  const growing = fastestGrowing(cashflow.expenses, months, 5);

  const moverRows: RankedRow[] = movers.map((m) => ({
    id: m.categoryId,
    label: m.displayName,
    hint: `avg ${formatAUDShort(m.rollingAvg)} → ${formatAUDShort(m.currentMonth)}`,
    metric: `${m.delta > 0 ? "+" : "−"}${formatAUDShort(Math.abs(m.delta))}`,
    metricClass: m.delta > 0 ? MONEY_NEGATIVE_CLASS : MONEY_POSITIVE_CLASS,
  }));

  const streakRows: RankedRow[] = streaks.map((s) => ({
    id: s.categoryId,
    label: s.displayName,
    hint: `${s.streakLength} months over plan`,
    metric: `+${formatAUDShort(s.totalOverspend)}`,
    metricClass: MONEY_NEGATIVE_CLASS,
    badge: `${s.streakLength}×`,
    badgeClass: "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400",
  }));

  const newRowsView: RankedRow[] = newRows.map((n) => ({
    id: n.categoryId,
    label: n.displayName,
    hint: "$0 in the prior 3 months",
    metric: formatAUDShort(n.currentMonth),
    metricClass: amountClass(n.currentMonth),
  }));

  const growingRows: RankedRow[] = growing.map((g) => ({
    id: g.categoryId,
    label: g.displayName,
    hint: `${formatAUDShort(g.threeMonthsAgo)} → ${formatAUDShort(g.currentMonth)}`,
    metric: `+${(g.growthPct * 100).toFixed(0)}%`,
    metricClass: MONEY_NEGATIVE_CLASS,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-3 print-portrait">
      {insufficientData && (
        <p className="rounded-md border border-border/50 bg-muted/30 p-2 text-xs text-muted-foreground">
          Trend detection needs at least 4 months of data — widen the
          date range to fill the panels.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <RankedList
          title="Top movers"
          description={`How ${lastMonthLabel} compares to the trailing 3-month average.`}
          rows={moverRows}
          emptyMessage={
            insufficientData
              ? "Waiting on more months of data."
              : "Everything is tracking within 3-month norms."
          }
        />
        <RankedList
          title="Streaks over plan"
          description="Expense categories that have been over their scheduled + budget plan for 2 or more months running."
          rows={streakRows}
          emptyMessage={
            insufficientData
              ? "Waiting on more months of data."
              : "No categories are on a running overspend streak."
          }
        />
        <RankedList
          title="New this month"
          description="Categories with $0 in the prior 3 months but activity in the current month."
          rows={newRowsView}
          emptyMessage={
            insufficientData
              ? "Waiting on more months of data."
              : "No brand-new category activity this month."
          }
        />
        <RankedList
          title="Fastest-accelerating expenses"
          description="Where spend has grown the most from 3 months ago."
          rows={growingRows}
          emptyMessage={
            insufficientData
              ? "Waiting on more months of data."
              : "No categories have accelerated meaningfully."
          }
        />
      </div>
    </div>
  );
}
