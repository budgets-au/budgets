"use client";

import { useMemo } from "react";
import useSWR from "swr";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
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
 *  selected period; Total / Plan (Budget + Scheduled) / Count
 *  columns driven by the same display-prefs the Cashflow tab uses.
 *
 *  Visual rhythm mirrors Cashflow: depth-based indents on the
 *  name column, vertical separator lines between numeric columns,
 *  muted "computed" background on aggregate cells, hover row
 *  highlight. Section headers wrap Income and Expenses; a Net row
 *  closes out the table. */
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
  const showPlan = prefs.cashflowShowPlan;
  const showHidden = prefs.cashflowShowHidden;
  const excludedIds = prefs.cashflowExcludedCatIds;
  const hideTransfers = prefs.cashflowHideTransfers;

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

  const visibleIncome = data.income.filter((c) => !excludedSet.has(c.id));
  const visibleExpenses = data.expenses.filter((c) => !excludedSet.has(c.id));
  const hiddenIncome = data.income.filter((c) => excludedSet.has(c.id));
  const hiddenExpenses = data.expenses.filter((c) => excludedSet.has(c.id));
  const hasHidden = hiddenIncome.length + hiddenExpenses.length > 0;
  const monthsInWindow = data.months;

  /** Sum a category's expected figures across the months the report
   *  is scoped to. Uses the API's per-month maps (which reflect the
   *  actual recurrence — a bimonthly schedule only contributes in
   *  the months it fires) rather than `scheduledPerMonth * months`
   *  (which smooths a non-monthly cadence over every month and
   *  overstates plan for short windows). */
  function periodPlan(cat: CashflowCategory): {
    scheduled: number;
    budget: number;
  } {
    let scheduled = 0;
    let budget = 0;
    for (const m of monthsInWindow) {
      scheduled += cat.scheduledByMonth?.[m] ?? 0;
      budget += cat.budgetByMonth?.[m] ?? 0;
    }
    return { scheduled, budget };
  }

  function aggregate(cats: CashflowCategory[]) {
    let total = 0;
    let count = 0;
    let scheduled = 0;
    let budget = 0;
    for (const c of cats) {
      total += c.total;
      count += c.totalCount;
      const p = periodPlan(c);
      scheduled += p.scheduled;
      budget += p.budget;
    }
    return { total, count, scheduled, budget };
  }

  const incomeTotals = aggregate(visibleIncome);
  const expenseTotals = aggregate(visibleExpenses);
  const net = incomeTotals.total + expenseTotals.total;
  // Plan is the sum of Budget + Scheduled — operators usually think
  // of "what I expected" as a single number rather than two separate
  // ones. Diff = Total − Plan; positive when actual outpaced plan.
  const colCount =
    1 /* name */ +
    1 /* total */ +
    (showPlan ? 2 : 0) /* plan + diff */ +
    (showCounts ? 1 : 0) +
    1; /* hide-toggle column */

  return (
    <div className="space-y-3">
      <div
        className="flex items-center justify-end gap-4 flex-wrap"
        data-print-hide
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Plan</span>
          <Switch
            checked={showPlan}
            onCheckedChange={(v) => setPref("cashflowShowPlan", v)}
            aria-label="Show plan columns"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Show counts</span>
          <Switch
            checked={showCounts}
            onCheckedChange={(v) => setPref("cashflowShowCounts", v)}
            aria-label="Show transaction counts"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Hide transfers</span>
          <Switch
            checked={hideTransfers}
            onCheckedChange={(v) => setPref("cashflowHideTransfers", v)}
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
              onCheckedChange={(v) => setPref("cashflowShowHidden", v)}
              aria-label="Show hidden categories"
            />
          </div>
        )}
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b bg-muted/30">
              <Th align="left" pad="px-3 py-2">
                Category
              </Th>
              <Th align="right" computed>
                Total
              </Th>
              {showPlan && (
                <Th align="right" computed>
                  Plan
                </Th>
              )}
              {showPlan && (
                <Th align="right" computed>
                  Diff
                </Th>
              )}
              {showCounts && (
                <Th align="right" computed>
                  #
                </Th>
              )}
              <Th align="right" pad="w-8" />
            </tr>
          </thead>
          <tbody>
            <SectionHeader label="Income" colSpan={colCount} />
            {sortCats(visibleIncome).map((cat) => (
              <CategoryRow
                key={cat.id}
                cat={cat}
                monthsInWindow={monthsInWindow}
                showPlan={showPlan}
                showCounts={showCounts}
                onToggleHide={toggleHideCat}
                isHidden={false}
                from={from}
                to={to}
              />
            ))}
            <SummaryRow
              label="Total income"
              total={incomeTotals.total}
              count={incomeTotals.count}
              budget={incomeTotals.budget}
              scheduled={incomeTotals.scheduled}
              showPlan={showPlan}
              showCounts={showCounts}
            />

            <SectionHeader label="Expenses" colSpan={colCount} />
            {sortCats(visibleExpenses).map((cat) => (
              <CategoryRow
                key={cat.id}
                cat={cat}
                monthsInWindow={monthsInWindow}
                showPlan={showPlan}
                showCounts={showCounts}
                onToggleHide={toggleHideCat}
                isHidden={false}
                from={from}
                to={to}
              />
            ))}
            <SummaryRow
              label="Total expenses"
              total={expenseTotals.total}
              count={expenseTotals.count}
              budget={expenseTotals.budget}
              scheduled={expenseTotals.scheduled}
              showPlan={showPlan}
              showCounts={showCounts}
            />

            <tr className="border-t bg-muted/40 font-semibold">
              <td className="px-3 py-2">Net (income + expenses)</td>
              <td
                className={`px-3 py-2 text-right tabular-nums border-l border-border bg-muted/40 ${amountClass(net)}`}
              >
                {formatAUD(net)}
              </td>
              {showPlan && (
                <td className="px-3 py-2 text-right border-l border-border bg-muted/40 text-muted-foreground">
                  —
                </td>
              )}
              {showPlan && (
                <td className="px-3 py-2 text-right border-l border-border bg-muted/40 text-muted-foreground">
                  —
                </td>
              )}
              {showCounts && (
                <td className="px-3 py-2 text-right border-l border-border bg-muted/40 text-muted-foreground">
                  —
                </td>
              )}
              <td />
            </tr>

            {showHidden && hasHidden && (
              <>
                <SectionHeader
                  label="Hidden — not included in totals"
                  colSpan={colCount}
                  muted
                />
                {sortCats([...hiddenIncome, ...hiddenExpenses]).map((cat) => (
                  <CategoryRow
                    key={cat.id}
                    cat={cat}
                    monthsInWindow={monthsInWindow}
                    showPlan={showPlan}
                    showCounts={showCounts}
                    onToggleHide={toggleHideCat}
                    isHidden
                    from={from}
                    to={to}
                  />
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Sort cats so children sit directly under their parent. The API
 *  returns a flat list; this stable sort keys on (grandparent name,
 *  parent name, own name) so the hierarchy reads top-down. */
function sortCats(cats: CashflowCategory[]): CashflowCategory[] {
  return cats.slice().sort((a, b) => {
    const aGp = a.grandparentName ?? a.parentName ?? a.name;
    const bGp = b.grandparentName ?? b.parentName ?? b.name;
    if (aGp !== bGp) return aGp.localeCompare(bGp);
    const aP = a.parentName ?? a.name;
    const bP = b.parentName ?? b.name;
    if (aP !== bP) return aP.localeCompare(bP);
    return a.name.localeCompare(b.name);
  });
}

function depthOf(cat: CashflowCategory): 0 | 1 | 2 {
  if (cat.grandparentId) return 2;
  if (cat.parentId) return 1;
  return 0;
}

function CategoryRow({
  cat,
  monthsInWindow,
  showPlan,
  showCounts,
  onToggleHide,
  isHidden,
  from,
  to,
}: {
  cat: CashflowCategory;
  monthsInWindow: string[];
  showPlan: boolean;
  showCounts: boolean;
  onToggleHide: (id: string) => void;
  isHidden: boolean;
  from: string;
  to: string;
}) {
  const display = cat.total;
  // Sum the actual per-month occurrence + budget values across the
  // selected window rather than the smoothed `*PerMonth × months`.
  // For bimonthly / quarterly / yearly schedules the smoothing
  // would overstate Plan for windows that don't actually contain
  // an occurrence.
  let scheduled = 0;
  let budget = 0;
  for (const m of monthsInWindow) {
    scheduled += cat.scheduledByMonth?.[m] ?? 0;
    budget += cat.budgetByMonth?.[m] ?? 0;
  }
  // Plan = budget + scheduled (treated as one expected-figure
  // column). Diff = actual − plan; for expenses (negative actual,
  // negative plan) this reads as "over" when positive and "under"
  // when negative — same sign convention the amount cells follow.
  const plan = budget + scheduled;
  const diff = display - plan;
  const depth = depthOf(cat);
  // Indent classes mirror cashflow-report's LeafRow:
  //   depth 0 → px-3
  //   depth 1 → pl-9 pr-3
  //   depth 2 → pl-16 pr-3
  const namePad =
    depth === 2 ? "pl-16 pr-3" : depth === 1 ? "pl-9 pr-3" : "px-3";
  const isUncategorised = cat.id.startsWith("uncategorised-");
  const direction =
    cat.id === "uncategorised-income"
      ? "in"
      : cat.id === "uncategorised-expenses"
        ? "out"
        : null;
  const href = isUncategorised
    ? `/transactions?categoryId=__uncat__&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${direction ? `&direction=${encodeURIComponent(direction)}` : ""}`
    : `/transactions?categoryId=${encodeURIComponent(cat.id)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return (
    <tr
      className={`group border-b border-border/50 hover:bg-muted/30 ${
        isHidden ? "opacity-50" : ""
      }`}
    >
      <td className={`${namePad} py-1.5 text-sm whitespace-nowrap`}>
        <span className="flex items-center gap-1 min-w-0">
          <Link
            href={href}
            className={
              isUncategorised
                ? "text-muted-foreground hover:underline hover:text-foreground transition-colors truncate"
                : "hover:underline hover:text-indigo-600 transition-colors truncate"
            }
          >
            {cat.name}
          </Link>
          {!isUncategorised && (
            <button
              type="button"
              onClick={() => onToggleHide(cat.id)}
              className="lg:opacity-0 lg:group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground print:hidden"
              aria-label={isHidden ? "Show category" : "Hide category"}
              title={isHidden ? "Show category" : "Hide category"}
            >
              {isHidden ? (
                <Eye className="h-3 w-3" />
              ) : (
                <EyeOff className="h-3 w-3" />
              )}
            </button>
          )}
        </span>
      </td>
      <td
        className={`px-3 py-1.5 text-right tabular-nums border-l border-border bg-muted/40 ${amountClass(display)}`}
      >
        {formatAUD(display)}
      </td>
      {showPlan && (
        <td className="px-3 py-1.5 text-right tabular-nums border-l border-border bg-muted/40 text-muted-foreground">
          {plan !== 0 ? formatAUD(plan) : "—"}
        </td>
      )}
      {showPlan && (
        <td
          className={`px-3 py-1.5 text-right tabular-nums border-l border-border bg-muted/40 ${
            plan === 0 ? "text-muted-foreground" : amountClass(diff)
          }`}
        >
          {plan !== 0 ? formatAUD(diff) : "—"}
        </td>
      )}
      {showCounts && (
        <td className="px-3 py-1.5 text-right tabular-nums border-l border-border bg-muted/40 text-muted-foreground">
          {cat.totalCount || "—"}
        </td>
      )}
      <td className="w-8" />
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
    <tr className={muted ? "border-b bg-muted/20" : "border-b bg-muted/30"}>
      <td
        colSpan={colSpan}
        className={`px-3 py-1.5 text-[11px] uppercase tracking-wider ${
          muted ? "text-muted-foreground" : "font-medium text-muted-foreground"
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
  showPlan,
  showCounts,
}: {
  label: string;
  total: number;
  count: number;
  budget: number;
  scheduled: number;
  showPlan: boolean;
  showCounts: boolean;
}) {
  const plan = budget + scheduled;
  const diff = total - plan;
  return (
    <tr className="border-b bg-muted/20 font-medium">
      <td className="px-3 py-1.5">{label}</td>
      <td
        className={`px-3 py-1.5 text-right tabular-nums border-l border-border bg-muted/40 ${amountClass(total)}`}
      >
        {formatAUD(total)}
      </td>
      {showPlan && (
        <td className="px-3 py-1.5 text-right tabular-nums border-l border-border bg-muted/40 text-muted-foreground">
          {plan !== 0 ? formatAUD(plan) : "—"}
        </td>
      )}
      {showPlan && (
        <td
          className={`px-3 py-1.5 text-right tabular-nums border-l border-border bg-muted/40 ${
            plan === 0 ? "text-muted-foreground" : amountClass(diff)
          }`}
        >
          {plan !== 0 ? formatAUD(diff) : "—"}
        </td>
      )}
      {showCounts && (
        <td className="px-3 py-1.5 text-right tabular-nums border-l border-border bg-muted/40 text-muted-foreground">
          {count || "—"}
        </td>
      )}
      <td className="w-8" />
    </tr>
  );
}

function Th({
  align,
  children,
  computed,
  pad = "px-3 py-2",
}: {
  align: "left" | "right";
  children?: React.ReactNode;
  computed?: boolean;
  pad?: string;
}) {
  return (
    <th
      className={`${pad} text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-${align} ${
        computed ? "border-l border-border bg-muted/40" : ""
      }`}
    >
      {children}
    </th>
  );
}
