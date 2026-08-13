"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO, endOfMonth } from "date-fns";
import { Eye, EyeOff, ChevronUp, ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { FilterBar } from "@/components/ui/filter-bar";
import { TableScroller } from "@/components/ui/table-scroller";
import { useSwrJson } from "@/hooks/use-swr-json";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { amountClass, formatAUDShort } from "@/lib/utils";
import type {
  CashflowReport as CashflowData,
  CashflowCategory,
} from "@/app/api/reports/cashflow/route";
import { CashflowCellDialog, type CashflowCellQuery } from "./cashflow-cell-dialog";

/** Standalone Category report. Formerly a one-line wrapper around
 *  CashflowReport with `monthAxis={false}`, which dragged in the full
 *  per-month table chrome only to hide the columns. This version owns
 *  its layout: a page-width max (~3xl for the narrow-column table +
 *  slack) that shrinks responsively on narrower viewports, sticky
 *  filter bar + thead, and a flat sorted table per section (Income /
 *  Expenses). Hierarchy is dropped intentionally — for a summary
 *  view, "biggest lines first" reads better than a rigid tree. Use
 *  the Cashflow tab when hierarchy matters. */
export function CategoryReport({
  from,
  to,
  accountIds,
}: {
  from: string;
  to: string;
  accountIds: string[];
}) {
  const { prefs, setPref } = useDisplayPrefs();

  const showCounts = prefs.cashflowShowCounts;
  const showAvg = prefs.cashflowShowAvg;
  const planMode = prefs.cashflowPlanMode ?? "off";
  const showPlan = planMode !== "off";
  const showDiff = planMode === "diff";
  const showHidden = prefs.cashflowShowHidden;
  const excludedIds = prefs.cashflowExcludedCatIds;
  const hideTransfers = prefs.cashflowHideTransfers;

  type SortKey = "total" | "avg" | "counts" | "plan" | "diff" | "name";
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [cellQuery, setCellQuery] = useState<CashflowCellQuery | null>(null);

  const accountIdsParam = accountIds.length > 0 ? `&accountIds=${accountIds.join(",")}` : "";
  const { data, isLoading } = useSwrJson<CashflowData>(
    `/api/reports/cashflow?from=${from}&to=${to}&hideTransfers=${hideTransfers}${accountIdsParam}`,
  );

  const excludedSet = useMemo(() => new Set(excludedIds), [excludedIds]);

  function toggleHide(catId: string) {
    setPref(
      "cashflowExcludedCatIds",
      excludedIds.includes(catId)
        ? excludedIds.filter((x) => x !== catId)
        : [...excludedIds, catId],
    );
  }

  function clickSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Sensible default direction per column type.
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Loading category summary…
      </p>
    );
  }
  if (!data || data.months.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No data for this period.
      </p>
    );
  }

  const { months, income, expenses } = data;
  const monthsCount = months.length;

  // Enrich each cat with its display path + convenience fields for
  // sorting and rendering. Hidden cats stay in the list; they're
  // filtered by section based on `showHidden`.
  interface Row {
    id: string;
    name: string;
    parentName: string | null;
    grandparentName: string | null;
    displayName: string;
    total: number;
    counts: number;
    plan: number;
    diff: number;
    isHidden: boolean;
  }
  function enrich(cat: CashflowCategory): Row {
    const displayName = [cat.grandparentName, cat.parentName, cat.name]
      .filter(Boolean)
      .join(" › ");
    const plan = cat.budgetTotal + cat.scheduledTotal;
    return {
      id: cat.id,
      name: cat.name,
      parentName: cat.parentName,
      grandparentName: cat.grandparentName,
      displayName,
      total: cat.total,
      counts: cat.totalCount,
      plan,
      // For expenses, a positive `total` overspend against plan
      // reads as "over" — but signs on Cashflow keep expenses
      // negative. Diff below is signed: positive means the row
      // came in UNDER plan (spent less than allocated); negative
      // means over.
      diff: plan - Math.abs(cat.total),
      isHidden:
        excludedSet.has(cat.id) ||
        (cat.parentId ? excludedSet.has(cat.parentId) : false) ||
        (cat.grandparentId ? excludedSet.has(cat.grandparentId) : false),
    };
  }
  const incomeRows = income.map(enrich);
  const expenseRows = expenses.map(enrich);

  function sortRows(rows: Row[]): Row[] {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.displayName.localeCompare(b.displayName);
          break;
        case "total":
          // Sort by magnitude so income & expense sort intuitively
          // (biggest at the top when desc).
          cmp = Math.abs(a.total) - Math.abs(b.total);
          break;
        case "counts":
          cmp = a.counts - b.counts;
          break;
        case "avg":
          cmp = Math.abs(a.total / monthsCount) - Math.abs(b.total / monthsCount);
          break;
        case "plan":
          cmp = a.plan - b.plan;
          break;
        case "diff":
          cmp = a.diff - b.diff;
          break;
      }
      return cmp * dir;
    });
  }

  const visibleIncome = sortRows(incomeRows.filter((r) => !r.isHidden));
  const visibleExpenses = sortRows(expenseRows.filter((r) => !r.isHidden));
  const hiddenIncome = sortRows(incomeRows.filter((r) => r.isHidden));
  const hiddenExpenses = sortRows(expenseRows.filter((r) => r.isHidden));
  const hasHidden = hiddenIncome.length > 0 || hiddenExpenses.length > 0;

  const totalIncome = visibleIncome.reduce((s, r) => s + r.total, 0);
  const totalExpenses = visibleExpenses.reduce((s, r) => s + r.total, 0);
  const net = totalIncome + totalExpenses;

  return (
    <div className="space-y-3 print-landscape">
      {/* `innerClassName` matches the table's `max-w-3xl mx-auto`
          below so the bar and the table share one responsive spine. */}
      <FilterBar align="end" innerClassName="max-w-3xl mx-auto">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Avg</span>
            <Switch
              checked={showAvg}
              onCheckedChange={(v) => setPref("cashflowShowAvg", v)}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Counts</span>
            <Switch
              checked={showCounts}
              onCheckedChange={(v) => setPref("cashflowShowCounts", v)}
            />
          </label>
          <SegmentedControl
            label="Plan"
            value={planMode}
            onChange={(m) => setPref("cashflowPlanMode", m)}
            options={[
              { value: "off", label: "Off" },
              { value: "plan", label: "Plan" },
              { value: "diff", label: "Diff" },
            ]}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Hide transfers</span>
            <Switch
              checked={hideTransfers}
              onCheckedChange={(v) => setPref("cashflowHideTransfers", v)}
            />
          </label>
          {hasHidden && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Show hidden</span>
              <Switch
                checked={showHidden}
                onCheckedChange={(v) => setPref("cashflowShowHidden", v)}
              />
            </label>
          )}
      </FilterBar>

      {/* Page-width table. max-w-3xl (~768px) is enough for the
          Category name column + the numeric endcaps; on narrow
          viewports mx-auto centres and w-full lets the table
          shrink cleanly. Bounded max-height means the sticky
          thead has something to anchor against while rows
          scroll. */}
      <TableScroller maxWidth="max-w-3xl" className="mx-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted">
              <SortHeader
                label="Category"
                onClick={() => clickSort("name")}
                active={sortKey === "name"}
                dir={sortDir}
                align="left"
              />
              <SortHeader
                label="Total"
                onClick={() => clickSort("total")}
                active={sortKey === "total"}
                dir={sortDir}
                align="right"
              />
              {showCounts && (
                <SortHeader
                  label="#"
                  onClick={() => clickSort("counts")}
                  active={sortKey === "counts"}
                  dir={sortDir}
                  align="right"
                />
              )}
              {showAvg && (
                <SortHeader
                  label="Avg/mo"
                  onClick={() => clickSort("avg")}
                  active={sortKey === "avg"}
                  dir={sortDir}
                  align="right"
                />
              )}
              {showPlan && (
                <SortHeader
                  label="Plan"
                  onClick={() => clickSort("plan")}
                  active={sortKey === "plan"}
                  dir={sortDir}
                  align="right"
                />
              )}
              {showDiff && (
                <SortHeader
                  label="Diff"
                  onClick={() => clickSort("diff")}
                  active={sortKey === "diff"}
                  dir={sortDir}
                  align="right"
                />
              )}
            </tr>
          </thead>
          <tbody>
            <SectionRow label="Income" />
            {visibleIncome.map((r) => (
              <CategoryRow
                key={r.id}
                row={r}
                monthsCount={monthsCount}
                showCounts={showCounts}
                showAvg={showAvg}
                showPlan={showPlan}
                showDiff={showDiff}
                onHide={() => toggleHide(r.id)}
                onOpen={() =>
                  setCellQuery({
                    categoryId: r.id,
                    from,
                    to,
                    rangeLabel: totalRangeLabel(from, to),
                    displayName: r.displayName,
                  })
                }
              />
            ))}
            <TotalsRow
              label="Total Income"
              total={totalIncome}
              monthsCount={monthsCount}
              showCounts={showCounts}
              showAvg={showAvg}
              showPlan={showPlan}
              showDiff={showDiff}
            />

            <SectionRow label="Expenses" />
            {visibleExpenses.map((r) => (
              <CategoryRow
                key={r.id}
                row={r}
                monthsCount={monthsCount}
                showCounts={showCounts}
                showAvg={showAvg}
                showPlan={showPlan}
                showDiff={showDiff}
                onHide={() => toggleHide(r.id)}
                onOpen={() =>
                  setCellQuery({
                    categoryId: r.id,
                    from,
                    to,
                    rangeLabel: totalRangeLabel(from, to),
                    displayName: r.displayName,
                  })
                }
              />
            ))}
            <TotalsRow
              label="Total Expenses"
              total={totalExpenses}
              monthsCount={monthsCount}
              showCounts={showCounts}
              showAvg={showAvg}
              showPlan={showPlan}
              showDiff={showDiff}
            />

            {/* Surplus / Deficit — the whole point of the summary. */}
            <TotalsRow
              label="Surplus / Deficit"
              total={net}
              monthsCount={monthsCount}
              showCounts={false}
              showAvg={showAvg}
              showPlan={false}
              showDiff={false}
              emphasis
            />

            {showHidden && hasHidden && (
              <>
                <SectionRow label="Hidden (excluded from totals)" />
                {[...hiddenIncome, ...hiddenExpenses].map((r) => (
                  <CategoryRow
                    key={r.id}
                    row={r}
                    monthsCount={monthsCount}
                    showCounts={showCounts}
                    showAvg={showAvg}
                    showPlan={showPlan}
                    showDiff={showDiff}
                    onHide={() => toggleHide(r.id)}
                    onOpen={() =>
                      setCellQuery({
                        categoryId: r.id,
                        from,
                        to,
                        rangeLabel: totalRangeLabel(from, to),
                        displayName: r.displayName,
                      })
                    }
                    muted
                  />
                ))}
              </>
            )}
          </tbody>
        </table>
      </TableScroller>

      <CashflowCellDialog
        query={cellQuery}
        accountIds={accountIds}
        hideTransfers={hideTransfers}
        onClose={() => setCellQuery(null)}
      />
    </div>
  );
}

function totalRangeLabel(from: string, to: string): string {
  return `${format(parseISO(from), "MMM ''yy")} → ${format(endOfMonth(parseISO(to)), "MMM ''yy")}`;
}

function SortHeader({
  label,
  onClick,
  active,
  dir,
  align,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  dir: "asc" | "desc";
  align: "left" | "right";
}) {
  return (
    <th
      className={`sticky top-0 z-10 bg-muted px-3 py-2 font-semibold text-xs uppercase tracking-wider text-muted-foreground shadow-[inset_0_-1px_0_0_var(--border)] whitespace-nowrap ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
          active ? "text-foreground" : ""
        } ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        <span>{label}</span>
        {active && (
          dir === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        )}
      </button>
    </th>
  );
}

function SectionRow({ label }: { label: string }) {
  return (
    <tr>
      <td
        colSpan={100}
        className="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40"
      >
        {label}
      </td>
    </tr>
  );
}

function CategoryRow({
  row,
  monthsCount,
  showCounts,
  showAvg,
  showPlan,
  showDiff,
  onHide,
  onOpen,
  muted,
}: {
  row: {
    id: string;
    displayName: string;
    total: number;
    counts: number;
    plan: number;
    diff: number;
  };
  monthsCount: number;
  showCounts: boolean;
  showAvg: boolean;
  showPlan: boolean;
  showDiff: boolean;
  onHide: () => void;
  onOpen: () => void;
  muted?: boolean;
}) {
  const totalCls = amountClass(row.total);
  const avg = monthsCount > 0 ? row.total / monthsCount : undefined;
  const diffCls = amountClass(row.diff);
  return (
    <tr
      className={`group hover:bg-muted/30 border-b border-border/50 ${muted ? "opacity-50" : ""}`}
    >
      <td className="px-3 py-1.5 text-sm whitespace-nowrap">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">{row.displayName}</span>
          <button
            type="button"
            onClick={onHide}
            className={`ml-auto p-0.5 rounded hover:bg-muted transition-opacity print:hidden ${
              muted
                ? "opacity-70 hover:opacity-100"
                : "opacity-0 group-hover:opacity-60 hover:opacity-100 lg:opacity-0 lg:group-hover:opacity-60"
            }`}
            title={muted ? "Show this category" : "Hide this category"}
            aria-label={muted ? "Show category" : "Hide category"}
          >
            {muted ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        </span>
      </td>
      <td className={`px-3 py-1.5 text-right tabular-nums ${totalCls}`}>
        {row.total !== 0 ? (
          <button
            type="button"
            onClick={onOpen}
            className="hover:underline hover:text-indigo-600 transition-colors"
          >
            {formatAUDShort(row.total)}
          </button>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </td>
      {showCounts && (
        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
          {row.counts || <span className="text-muted-foreground/50">—</span>}
        </td>
      )}
      {showAvg && (
        <td className={`px-3 py-1.5 text-right tabular-nums text-muted-foreground ${amountClass(avg ?? 0)}`}>
          {avg !== undefined && avg !== 0 ? formatAUDShort(avg) : <span className="text-muted-foreground/50">—</span>}
        </td>
      )}
      {showPlan && (
        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
          {row.plan !== 0 ? formatAUDShort(row.plan) : <span className="text-muted-foreground/50">—</span>}
        </td>
      )}
      {showDiff && (
        <td className={`px-3 py-1.5 text-right tabular-nums ${diffCls}`}>
          {row.diff !== 0 ? formatAUDShort(row.diff) : <span className="text-muted-foreground/50">—</span>}
        </td>
      )}
    </tr>
  );
}

function TotalsRow({
  label,
  total,
  monthsCount,
  showCounts,
  showAvg,
  showPlan,
  showDiff,
  emphasis,
}: {
  label: string;
  total: number;
  monthsCount: number;
  showCounts: boolean;
  showAvg: boolean;
  showPlan: boolean;
  showDiff: boolean;
  emphasis?: boolean;
}) {
  const avg = monthsCount > 0 ? total / monthsCount : undefined;
  return (
    <tr className={`border-t-2 border-border ${emphasis ? "font-bold bg-muted/20" : "font-semibold"}`}>
      <td className="px-3 py-2 text-sm bg-muted/40 whitespace-nowrap">
        {label}
      </td>
      <td className={`px-3 py-2 text-right tabular-nums ${amountClass(total)}`}>
        {formatAUDShort(total)}
      </td>
      {showCounts && <td className="bg-muted/40" />}
      {showAvg && (
        <td className={`px-3 py-2 text-right tabular-nums text-muted-foreground ${amountClass(avg ?? 0)}`}>
          {avg !== undefined ? formatAUDShort(avg) : "—"}
        </td>
      )}
      {showPlan && <td className="bg-muted/40" />}
      {showDiff && <td className="bg-muted/40" />}
    </tr>
  );
}

