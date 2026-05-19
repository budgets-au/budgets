"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { ChevronRight, Eye, EyeOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { amountClass, formatAUD } from "@/lib/utils";
import type {
  CashflowReport as CashflowData,
  CashflowCategory,
} from "@/app/api/reports/cashflow/route";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** "Category totals" report — the Cashflow report's data without
 *  the per-month matrix. Renders one row per category for the
 *  selected period; Total / Avg-per-month / Plan / Count columns
 *  driven by the same display-prefs the Cashflow tab uses so the
 *  operator's toggle state carries across between the two views.
 *
 *  Hide-transfers, hidden-category visibility, and Show-counts /
 *  Show-avg / Show-plan all share the Cashflow tab's persisted
 *  state — they're conceptually the same data summarised
 *  differently. */
export function CategoryReport({
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
  const { prefs, setPref } = useDisplayPrefs();
  const showCounts = prefs.cashflowShowCounts;
  const showAvg = prefs.cashflowShowAvg;
  const showPlan = prefs.cashflowShowPlan;
  const showHidden = prefs.cashflowShowHidden;
  const excludedIds = prefs.cashflowExcludedCatIds;
  const hideTransfers = prefs.cashflowHideTransfers;

  function toggle<K extends keyof typeof prefs>(
    key: K,
    value: (typeof prefs)[K],
  ) {
    setPref(key, value);
  }

  const url = `/api/reports/cashflow?from=${from}&to=${to}&hideTransfers=${hideTransfers}${accountIdsParam}`;
  const { data, isLoading } = useSWR<CashflowData>(url, fetcher);

  // Hidden cats cascade — hiding a parent hides every descendant.
  const excludedSet = useMemo(() => {
    const all = new Set<string>(excludedIds);
    if (!data) return all;
    const ofId = new Map<string, CashflowCategory>();
    for (const c of [...data.income, ...data.expenses]) ofId.set(c.id, c);
    function isDescendantOfHidden(c: CashflowCategory): boolean {
      let cur: CashflowCategory | undefined = c;
      while (cur?.parentId) {
        if (all.has(cur.parentId)) return true;
        cur = ofId.get(cur.parentId);
      }
      return false;
    }
    for (const c of [...data.income, ...data.expenses]) {
      if (isDescendantOfHidden(c)) all.add(c.id);
    }
    return all;
  }, [excludedIds, data]);

  function toggleHideCat(id: string) {
    const next = new Set(excludedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPref("cashflowExcludedCatIds", Array.from(next));
  }

  if (isLoading || !data) {
    return (
      <div className="rounded-md border p-6 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const monthsCount = data.months.length;
  const visibleIncome = data.income.filter((c) => !excludedSet.has(c.id));
  const visibleExpenses = data.expenses.filter((c) => !excludedSet.has(c.id));
  const hiddenIncome = data.income.filter((c) => excludedSet.has(c.id));
  const hiddenExpenses = data.expenses.filter((c) => excludedSet.has(c.id));
  const hasHidden = hiddenIncome.length + hiddenExpenses.length > 0;

  function aggregate(cats: CashflowCategory[]) {
    let total = 0;
    let count = 0;
    let scheduled = 0;
    let budget = 0;
    for (const c of cats) {
      total += c.total;
      count += c.totalCount;
      scheduled += c.scheduledPerMonth * monthsCount;
      budget += c.budgetPerMonth * monthsCount;
    }
    return { total, count, scheduled, budget };
  }

  const incomeTotals = aggregate(visibleIncome);
  const expenseTotals = aggregate(visibleExpenses);
  const net = incomeTotals.total + expenseTotals.total;
  const colCount =
    1 /* category */ +
    1 /* total */ +
    (showAvg ? 1 : 0) +
    (showPlan ? 2 : 0) /* budget + scheduled */ +
    (showCounts ? 1 : 0) +
    1; /* hide toggle column */

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-4 flex-wrap" data-print-hide>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Avg/mo</span>
          <Switch
            checked={showAvg}
            onCheckedChange={(v) => toggle("cashflowShowAvg", v)}
            aria-label="Show monthly average column"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Plan</span>
          <Switch
            checked={showPlan}
            onCheckedChange={(v) => toggle("cashflowShowPlan", v)}
            aria-label="Show plan columns"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Show counts</span>
          <Switch
            checked={showCounts}
            onCheckedChange={(v) => toggle("cashflowShowCounts", v)}
            aria-label="Show transaction counts"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Hide transfers</span>
          <Switch
            checked={hideTransfers}
            onCheckedChange={(v) => toggle("cashflowHideTransfers", v)}
            aria-label="Hide transfer-typed categories"
          />
        </div>
        {hasHidden && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Show {excludedSet.size} hidden
            </span>
            <Switch
              checked={showHidden}
              onCheckedChange={(v) => toggle("cashflowShowHidden", v)}
              aria-label="Show hidden categories"
            />
          </div>
        )}
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b bg-muted/30">
              <Th align="left">Category</Th>
              <Th align="right">Total</Th>
              {showAvg && <Th align="right">Avg/mo</Th>}
              {showPlan && <Th align="right">Budget</Th>}
              {showPlan && <Th align="right">Scheduled</Th>}
              {showCounts && <Th align="right">#</Th>}
              <Th align="right" />
            </tr>
          </thead>
          <tbody className="divide-y">
            <SectionHeader label="Income" colSpan={colCount} />
            {renderGroup(
              visibleIncome,
              monthsCount,
              showAvg,
              showPlan,
              showCounts,
              toggleHideCat,
              excludedSet,
            )}
            <SummaryRow
              label="Total income"
              total={incomeTotals.total}
              count={incomeTotals.count}
              budget={incomeTotals.budget}
              scheduled={incomeTotals.scheduled}
              monthsCount={monthsCount}
              showAvg={showAvg}
              showPlan={showPlan}
              showCounts={showCounts}
            />

            <SectionHeader label="Expenses" colSpan={colCount} />
            {renderGroup(
              visibleExpenses,
              monthsCount,
              showAvg,
              showPlan,
              showCounts,
              toggleHideCat,
              excludedSet,
            )}
            <SummaryRow
              label="Total expenses"
              total={expenseTotals.total}
              count={expenseTotals.count}
              budget={expenseTotals.budget}
              scheduled={expenseTotals.scheduled}
              monthsCount={monthsCount}
              showAvg={showAvg}
              showPlan={showPlan}
              showCounts={showCounts}
            />

            <tr className="bg-muted/40 font-semibold">
              <td className="px-3 py-2">Net (income + expenses)</td>
              <td className={`px-3 py-2 text-right tabular-nums ${amountClass(net)}`}>
                {formatAUD(net)}
              </td>
              {showAvg && (
                <td
                  className={`px-3 py-2 text-right tabular-nums ${amountClass(
                    net / Math.max(monthsCount, 1),
                  )}`}
                >
                  {formatAUD(net / Math.max(monthsCount, 1))}
                </td>
              )}
              {showPlan && <td className="px-3 py-2 text-right">—</td>}
              {showPlan && <td className="px-3 py-2 text-right">—</td>}
              {showCounts && <td className="px-3 py-2 text-right">—</td>}
              <td />
            </tr>

            {showHidden && hasHidden && (
              <>
                <SectionHeader
                  label="Hidden — not included in totals"
                  colSpan={colCount}
                  muted
                />
                {renderGroup(
                  hiddenIncome,
                  monthsCount,
                  showAvg,
                  showPlan,
                  showCounts,
                  toggleHideCat,
                  excludedSet,
                  true,
                )}
                {renderGroup(
                  hiddenExpenses,
                  monthsCount,
                  showAvg,
                  showPlan,
                  showCounts,
                  toggleHideCat,
                  excludedSet,
                  true,
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Renders a flat group of categories with parent/child indentation
 *  derived from `parentId`. Parents collapse their child subtotals
 *  into a "rolled-up" row when a child has the same parent id; the
 *  ordering relies on the API returning parents before children. */
function renderGroup(
  cats: CashflowCategory[],
  monthsCount: number,
  showAvg: boolean,
  showPlan: boolean,
  showCounts: boolean,
  toggleHide: (id: string) => void,
  excludedSet: Set<string>,
  greyed = false,
) {
  // Group children under their parent so we can render
  // parent | indented children. The API returns the rows already
  // ordered by name+depth, so we walk twice: parents (no parentId),
  // then each parent's direct children.
  const byParent = new Map<string | null, CashflowCategory[]>();
  for (const c of cats) {
    const k = c.parentId;
    const arr = byParent.get(k) ?? [];
    arr.push(c);
    byParent.set(k, arr);
  }

  const roots = byParent.get(null) ?? [];
  const orphans = cats.filter(
    (c) => c.parentId && !cats.some((p) => p.id === c.parentId),
  );

  const rows: React.ReactNode[] = [];
  for (const parent of roots) {
    rows.push(
      <CategoryRow
        key={parent.id}
        cat={parent}
        monthsCount={monthsCount}
        showAvg={showAvg}
        showPlan={showPlan}
        showCounts={showCounts}
        indent={0}
        onToggleHide={toggleHide}
        isHidden={excludedSet.has(parent.id)}
        greyed={greyed}
      />,
    );
    const kids = byParent.get(parent.id) ?? [];
    for (const child of kids) {
      rows.push(
        <CategoryRow
          key={child.id}
          cat={child}
          monthsCount={monthsCount}
          showAvg={showAvg}
          showPlan={showPlan}
          showCounts={showCounts}
          indent={1}
          onToggleHide={toggleHide}
          isHidden={excludedSet.has(child.id)}
          greyed={greyed}
        />,
      );
    }
  }
  // Orphans (child rows whose parent was filtered out) — render at
  // the root level so they aren't silently dropped.
  for (const orphan of orphans) {
    rows.push(
      <CategoryRow
        key={orphan.id}
        cat={orphan}
        monthsCount={monthsCount}
        showAvg={showAvg}
        showPlan={showPlan}
        showCounts={showCounts}
        indent={0}
        onToggleHide={toggleHide}
        isHidden={excludedSet.has(orphan.id)}
        greyed={greyed}
      />,
    );
  }
  return rows;
}

function CategoryRow({
  cat,
  monthsCount,
  showAvg,
  showPlan,
  showCounts,
  indent,
  onToggleHide,
  isHidden,
  greyed,
}: {
  cat: CashflowCategory;
  monthsCount: number;
  showAvg: boolean;
  showPlan: boolean;
  showCounts: boolean;
  indent: number;
  onToggleHide: (id: string) => void;
  isHidden: boolean;
  greyed: boolean;
}) {
  // Render the value in its natural sign — outflows are already
  // negative in the API payload, inflows positive. `amountClass`
  // reads the sign to colour red / green; flipping the display sign
  // would invert the colour assignment.
  const display = cat.total;
  const avg = monthsCount > 0 ? display / monthsCount : 0;
  const scheduled = cat.scheduledPerMonth * monthsCount;
  const budget = cat.budgetPerMonth * monthsCount;
  const pad = indent * 16;
  return (
    <tr className={`group ${greyed ? "opacity-60" : ""} hover:bg-muted/30`}>
      <td className="px-3 py-1.5">
        <span style={{ paddingLeft: pad }} className="inline-block">
          {indent > 0 && (
            <ChevronRight className="inline h-3 w-3 mr-1 text-muted-foreground/60" />
          )}
          {cat.name}
        </span>
      </td>
      <td className={`px-3 py-1.5 text-right tabular-nums ${amountClass(display)}`}>
        {formatAUD(display)}
      </td>
      {showAvg && (
        <td className={`px-3 py-1.5 text-right tabular-nums ${amountClass(avg)}`}>
          {formatAUD(avg)}
        </td>
      )}
      {showPlan && (
        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
          {budget !== 0 ? formatAUD(budget) : "—"}
        </td>
      )}
      {showPlan && (
        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
          {scheduled !== 0 ? formatAUD(scheduled) : "—"}
        </td>
      )}
      {showCounts && (
        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
          {cat.totalCount || "—"}
        </td>
      )}
      <td className="px-3 py-1.5 text-right">
        <button
          type="button"
          onClick={() => onToggleHide(cat.id)}
          className="lg:opacity-0 lg:group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          aria-label={isHidden ? "Show category" : "Hide category"}
          title={isHidden ? "Show category" : "Hide category"}
        >
          {isHidden ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
        </button>
      </td>
    </tr>
  );
}

function SectionHeader({
  label,
  colSpan,
  muted = false,
}: {
  label: string;
  colSpan: number;
  muted?: boolean;
}) {
  return (
    <tr className={muted ? "bg-muted/20" : "bg-muted/40"}>
      <td
        colSpan={colSpan}
        className={`px-3 py-1.5 text-[11px] uppercase tracking-wider ${
          muted ? "text-muted-foreground" : "font-medium"
        }`}
      >
        {label}
      </td>
    </tr>
  );
}

function SummaryRow({
  label,
  total,
  count,
  budget,
  scheduled,
  monthsCount,
  showAvg,
  showPlan,
  showCounts,
}: {
  label: string;
  total: number;
  count: number;
  budget: number;
  scheduled: number;
  monthsCount: number;
  showAvg: boolean;
  showPlan: boolean;
  showCounts: boolean;
}) {
  const avg = monthsCount > 0 ? total / monthsCount : 0;
  return (
    <tr className="bg-muted/20 font-medium">
      <td className="px-3 py-1.5">{label}</td>
      <td className={`px-3 py-1.5 text-right tabular-nums ${amountClass(total)}`}>
        {formatAUD(total)}
      </td>
      {showAvg && (
        <td className={`px-3 py-1.5 text-right tabular-nums ${amountClass(avg)}`}>
          {formatAUD(avg)}
        </td>
      )}
      {showPlan && (
        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
          {budget !== 0 ? formatAUD(budget) : "—"}
        </td>
      )}
      {showPlan && (
        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
          {scheduled !== 0 ? formatAUD(scheduled) : "—"}
        </td>
      )}
      {showCounts && (
        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
          {count || "—"}
        </td>
      )}
      <td />
    </tr>
  );
}

function Th({
  align,
  children,
}: {
  align: "left" | "right";
  children?: React.ReactNode;
}) {
  return (
    <th
      className={`px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-${align}`}
    >
      {children}
    </th>
  );
}

