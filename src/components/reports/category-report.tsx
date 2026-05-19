"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Sigma,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { amountClass, formatAUD } from "@/lib/utils";
import {
  applyBudgetedParentRollup,
  buildHierarchicalRows,
  hasOwnBudget,
} from "@/lib/category-hierarchy";
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
  const rollupBudgetedParents = prefs.cashflowRollupBudgetedParents;

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

  // Collapsed parent IDs (any depth-0 or depth-1 row that has
  // descendants and whose subtree the user has folded shut). Matches
  // the Cashflow report's collapse UX — local state because per-id
  // collapse is too granular to bother syncing across devices.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  function toggleCollapsed(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  // Build the hierarchical row lists once so the "Expand/Collapse
  // all" button can target the exact parent IDs that have
  // descendants (without re-walking the tree). When the operator
  // turns on "roll up budgeted parents", every parent that
  // carries its own budget folds its descendants' actuals into
  // its own row and the descendants stop rendering — see
  // `applyBudgetedParentRollup` for the math.
  const rawIncomeRows = buildHierarchicalRows(visibleIncome, monthsInWindow);
  const rawExpenseRows = buildHierarchicalRows(visibleExpenses, monthsInWindow);
  // applyBudgetedParentRollup always returns the `isRolledUp`
  // shape; when the toggle is off we still walk the rows so the
  // render side has one consistent shape to consume.
  const incomeRows = rollupBudgetedParents
    ? applyBudgetedParentRollup(rawIncomeRows, visibleIncome, monthsInWindow)
    : rawIncomeRows.map((r) => ({ ...r, isRolledUp: false }));
  const expenseRows = rollupBudgetedParents
    ? applyBudgetedParentRollup(rawExpenseRows, visibleExpenses, monthsInWindow)
    : rawExpenseRows.map((r) => ({ ...r, isRolledUp: false }));
  // Surface the toggle only when at least one parent has its own
  // budget in the current window — no point cluttering the toolbar
  // when there's nothing to roll up.
  const anyBudgetedParent = [...visibleIncome, ...visibleExpenses].some(
    (c) =>
      hasOwnBudget(c, monthsInWindow) &&
      [...visibleIncome, ...visibleExpenses].some(
        (d) => d.parentId === c.id || d.grandparentId === c.id,
      ),
  );
  // A row has descendants iff any other row in the same section
  // names it as a parent or grandparent. Synthesised parent rows
  // qualify too — they exist precisely *because* they have
  // descendants.
  const parentIds = new Set<string>();
  for (const { row } of [...incomeRows, ...expenseRows]) {
    if (row.parentId) parentIds.add(row.parentId);
    if (row.grandparentId) parentIds.add(row.grandparentId);
  }
  const allParentIds = [...parentIds];
  const allCollapsed =
    allParentIds.length > 0 &&
    allParentIds.every((id) => collapsedIds.has(id));
  function toggleCollapseAll() {
    setCollapsedIds(allCollapsed ? new Set() : new Set(allParentIds));
  }
  // A row is hidden if any of its ancestors is collapsed.
  function isCollapsedByAncestor(row: CashflowCategory): boolean {
    if (row.parentId && collapsedIds.has(row.parentId)) return true;
    if (row.grandparentId && collapsedIds.has(row.grandparentId))
      return true;
    return false;
  }

  return (
    <div className="space-y-3">
      <div
        className="flex items-center justify-between gap-4 flex-wrap"
        data-print-hide
      >
        <button
          type="button"
          onClick={toggleCollapseAll}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition-colors print:hidden"
          aria-label={allCollapsed ? "Expand all" : "Collapse all"}
        >
          {allCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>
        <div className="flex items-center gap-4 flex-wrap">
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
        {anyBudgetedParent && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Roll up budgeted parents
            </span>
            <Switch
              checked={rollupBudgetedParents}
              onCheckedChange={(v) =>
                setPref("cashflowRollupBudgetedParents", v)
              }
              aria-label="Roll children into any parent with its own budget"
            />
          </div>
        )}
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
            {incomeRows
              .filter(({ row }) => !isCollapsedByAncestor(row))
              .map(({ row, isSynthetic, isRolledUp }) => (
                <CategoryRow
                  key={row.id}
                  cat={row}
                  monthsInWindow={monthsInWindow}
                  showPlan={showPlan}
                  showCounts={showCounts}
                  onToggleHide={toggleHideCat}
                  isHidden={false}
                  isSynthetic={isSynthetic}
                  isRolledUp={isRolledUp}
                  hasDescendants={parentIds.has(row.id)}
                  isCollapsed={collapsedIds.has(row.id)}
                  onToggleCollapsed={() => toggleCollapsed(row.id)}
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
              type="income"
              showPlan={showPlan}
              showCounts={showCounts}
            />

            <SectionHeader label="Expenses" colSpan={colCount} />
            {expenseRows
              .filter(({ row }) => !isCollapsedByAncestor(row))
              .map(({ row, isSynthetic, isRolledUp }) => (
                <CategoryRow
                  key={row.id}
                  cat={row}
                  monthsInWindow={monthsInWindow}
                  showPlan={showPlan}
                  showCounts={showCounts}
                  onToggleHide={toggleHideCat}
                  isHidden={false}
                  isSynthetic={isSynthetic}
                  isRolledUp={isRolledUp}
                  hasDescendants={parentIds.has(row.id)}
                  isCollapsed={collapsedIds.has(row.id)}
                  onToggleCollapsed={() => toggleCollapsed(row.id)}
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
              type="expense"
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
                    isSynthetic={false}
                    isRolledUp={false}
                    hasDescendants={false}
                    isCollapsed={false}
                    onToggleCollapsed={() => {}}
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
 *  parent name, own name) so the hierarchy reads top-down. Only used
 *  by the hidden section now; visibleIncome / visibleExpenses go
 *  through `buildHierarchicalRows` which also fills missing parents. */
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
  isSynthetic,
  isRolledUp,
  hasDescendants,
  isCollapsed,
  onToggleCollapsed,
  from,
  to,
}: {
  cat: CashflowCategory;
  monthsInWindow: string[];
  showPlan: boolean;
  showCounts: boolean;
  onToggleHide: (id: string) => void;
  isHidden: boolean;
  isSynthetic: boolean;
  isRolledUp: boolean;
  hasDescendants: boolean;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  from: string;
  to: string;
}) {
  const display = cat.total;
  // Sum the actual per-month occurrence + budget values across the
  // selected window rather than the smoothed `*PerMonth × months`.
  // For bimonthly / quarterly / yearly schedules the smoothing
  // would overstate Plan for windows that don't actually contain
  // an occurrence.
  let scheduledAbs = 0;
  let budgetAbs = 0;
  for (const m of monthsInWindow) {
    scheduledAbs += cat.scheduledByMonth?.[m] ?? 0;
    budgetAbs += cat.budgetByMonth?.[m] ?? 0;
  }
  // The Cashflow API stores plan as `Math.abs(...)` regardless of
  // direction, so a $600 expense budget arrives as +600. Total
  // arrives signed: −500 for $500 spent. Subtracting unsigned plan
  // from signed total gave nonsense (e.g. −500 − 600 = −1100).
  // Apply the sign from `cat.type` so Plan matches Total's
  // convention (negative for expenses); Diff = Total − Plan then
  // reads as expected (positive = saved on expenses /
  // outperformed on income, negative = over-spent / shortfall).
  const sign = cat.type === "expense" ? -1 : 1;
  const plan = sign * (budgetAbs + scheduledAbs);
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
  const Chevron = isCollapsed ? ChevronRight : ChevronDown;
  return (
    <tr
      className={`group border-b border-border/50 hover:bg-muted/30 ${
        isHidden ? "opacity-50" : ""
      } ${hasDescendants ? "cursor-pointer" : ""}`}
      onClick={hasDescendants ? onToggleCollapsed : undefined}
    >
      <td className={`${namePad} py-1.5 text-sm whitespace-nowrap`}>
        <span className="flex items-center gap-1 min-w-0">
          {hasDescendants ? (
            <Chevron className="h-3 w-3 shrink-0 text-muted-foreground print:hidden" />
          ) : (
            // Reserve the chevron's slot so leaf and parent rows align
            // at the same name-column x-position.
            <span className="w-3 shrink-0 print:hidden" />
          )}
          {isSynthetic ? (
            // Structural header — no own transactions in this window,
            // so there's nothing to link to. Mute slightly so the
            // operator reads it as a group header rather than a leaf.
            <span className="text-muted-foreground italic truncate">
              {cat.name}
            </span>
          ) : (
            <Link
              href={href}
              onClick={(e) => e.stopPropagation()}
              className={
                isUncategorised
                  ? "text-muted-foreground hover:underline hover:text-foreground transition-colors truncate"
                  : "hover:underline hover:text-indigo-600 transition-colors truncate"
              }
            >
              {cat.name}
            </Link>
          )}
          {!isUncategorised && !isSynthetic && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleHide(cat.id);
              }}
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
        className="px-3 py-1.5 text-right tabular-nums border-l border-border bg-muted/40 text-foreground"
      >
        <span className="inline-flex items-center gap-0.5 align-baseline">
          {formatAUD(display)}
          {isRolledUp && (
            // Σ flag — the row's Total has been folded up from
            // descendants because the parent carries its own
            // budget. Sits as a small superscript so the number
            // remains the primary read.
            <Sigma
              className="h-2.5 w-2.5 -translate-y-1 text-muted-foreground"
              aria-label="Total rolled up from children"
            >
              <title>Total rolled up from descendants</title>
            </Sigma>
          )}
        </span>
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
  type,
  showPlan,
  showCounts,
}: {
  label: string;
  total: number;
  count: number;
  budget: number;
  scheduled: number;
  type: "income" | "expense";
  showPlan: boolean;
  showCounts: boolean;
}) {
  // Plan amounts roll up as positive absolutes from the API
  // (Math.abs in both budget and scheduled aggregators). Apply the
  // direction from `type` so Plan matches Total's sign convention,
  // and Diff = Total − Plan reads correctly.
  const sign = type === "expense" ? -1 : 1;
  const plan = sign * (budget + scheduled);
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
