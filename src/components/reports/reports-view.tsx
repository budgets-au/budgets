"use client";

import { Fragment, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { useAccountFilter } from "@/hooks/use-account-filter";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { TREND_DOWN } from "@/lib/colours";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown } from "lucide-react";
import { formatAUD } from "@/lib/utils";
import {
  ChartTooltipCard,
  ChartTooltipHeader,
  ChartTooltipRow,
} from "@/components/ui/chart-tooltip";

function ReportsBarTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string | number; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <ChartTooltipCard>
      <ChartTooltipHeader title={String(label ?? "")} />
      {payload.map((row) => (
        <ChartTooltipRow
          key={String(row.name)}
          label={String(row.name)}
          value={formatAUD(Number(row.value ?? 0))}
          swatch={row.color}
        />
      ))}
    </ChartTooltipCard>
  );
}

function ReportsPieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    name?: string | number;
    value?: number;
    payload?: { fill?: string };
  }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0];
  return (
    <ChartTooltipCard>
      <ChartTooltipHeader title={String(row.name ?? "")} />
      <ChartTooltipRow
        label="Total"
        value={formatAUD(Number(row.value ?? 0))}
        swatch={row.payload?.fill}
      />
    </ChartTooltipCard>
  );
}
import {
  format,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  subQuarters,
  startOfYear,
  endOfYear,
  subYears,
} from "date-fns";

import {
  startOfFinancialYear,
  endOfFinancialYear,
} from "@/lib/financial-year";

interface RangePreset {
  key: string;
  label: string;
  from: string;
  to: string;
}

/** Build the eight popover options. Returned as 4 pairs so the
 * popover can render them in 2 columns (this / last) per row. */
function buildRangePresets(now: Date): RangePreset[][] {
  const iso = (d: Date) => format(d, "yyyy-MM-dd");
  const prevMonth = subMonths(now, 1);
  const prevQuarter = subQuarters(now, 1);
  const prevYear = subYears(now, 1);
  return [
    [
      { key: "thisMonth", label: "This month", from: iso(startOfMonth(now)), to: iso(endOfMonth(now)) },
      { key: "lastMonth", label: "Last month", from: iso(startOfMonth(prevMonth)), to: iso(endOfMonth(prevMonth)) },
    ],
    [
      { key: "thisQuarter", label: "This Quarter", from: iso(startOfQuarter(now)), to: iso(endOfQuarter(now)) },
      { key: "lastQuarter", label: "Last Quarter", from: iso(startOfQuarter(prevQuarter)), to: iso(endOfQuarter(prevQuarter)) },
    ],
    [
      { key: "thisYear", label: "This Year", from: iso(startOfYear(now)), to: iso(endOfYear(now)) },
      { key: "lastYear", label: "Last Year", from: iso(startOfYear(prevYear)), to: iso(endOfYear(prevYear)) },
    ],
    [
      { key: "thisFY", label: "This Financial", from: iso(startOfFinancialYear(now)), to: iso(endOfFinancialYear(now)) },
      { key: "lastFY", label: "Last Financial", from: iso(startOfFinancialYear(prevYear)), to: iso(endOfFinancialYear(prevYear)) },
    ],
  ];
}

import { CashflowReport } from "./cashflow-report";
import { TaxDeductionsReport } from "./tax-deductions-report";
import { ExpensesDrilldown } from "./expenses-drilldown";
import { EnvelopeReport } from "./envelope-report";
import { SankeyReport } from "./sankey-report";
import { YoYReport } from "./yoy-report";
import { TreemapReport } from "./treemap-report";
import { DailyHeatmapReport } from "./daily-heatmap-report";
import { ScatterReport } from "./scatter-report";
import { PayeeParetoReport } from "./payee-pareto-report";
import { AccountsCashflowReport } from "./accounts-cashflow-report";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CategoryRow {
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categoryType: string | null;
  total: string;
  count: string;
}

interface MonthRow {
  month: string;
  income: string;
  expenses: string;
  net: string;
}

const REPORT_TABS = [
  "cashflow",
  "monthly",
  "yoy",
  "expenses",
  "income",
  "envelope",
  "accounts",
  "sankey",
  "treemap",
  "heatmap",
  "scatter",
  "payees",
  "tax",
] as const;
type ReportTab = (typeof REPORT_TABS)[number];

function isReportTab(value: string | null): value is ReportTab {
  return value !== null && (REPORT_TABS as readonly string[]).includes(value);
}

export function ReportsView({
  accounts,
}: {
  accounts: { id: string; name: string }[];
}) {
  const now = new Date();
  const [from, setFrom] = useState(format(startOfMonth(now), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(endOfMonth(now), "yyyy-MM-dd"));

  // Tab state lives in the URL so the eight reports are deep-linkable
  // (share `/reports?tab=sankey`, hit Back to return to the previous
  // tab, etc.). Same convention as the account filter — see
  // hooks/use-account-filter.ts.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get("tab");
  const activeTab: ReportTab = isReportTab(urlTab) ? urlTab : "cashflow";
  function setActiveTab(next: string) {
    if (!isReportTab(next)) return;
    const p = new URLSearchParams(searchParams.toString());
    if (next === "cashflow") p.delete("tab");
    else p.set("tab", next);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  // Per-tab period persistence lives in the DB-backed displayPrefs
  // blob so the operator's choices follow them across devices.
  const { prefs: displayPrefs, setPref } = useDisplayPrefs();
  // The old global "Hide transfers" toggle was removed in 0.7.0 — the
  // cashflow report now does this via per-category eye icons (with
  // internal-transfer cats hidden by default for new users), and the
  // envelope report has its own equivalent. Other tabs see all rows,
  // transfers included. Kept as a hardcoded `false` so subcomponents'
  // prop signatures don't need to churn.
  const hideTransfers = false;

  // On tab change (and initial mount): load that tab's stored range, or fall
  // back to a per-tab default so reports don't bleed periods into each other.
  // Tax owns its own FY scope so it's excluded.
  useEffect(() => {
    if (activeTab === "tax") return;
    const stored = displayPrefs.reportsPeriodByTab[activeTab];
    if (stored?.from && stored?.to) {
      setFrom(stored.from);
      setTo(stored.to);
    } else {
      // Long-window tabs need ≥ 11 months to be meaningful — a
      // weekly-envelope figure from one month of data is misleading,
      // a heatmap of 30 days is empty most of the time, a payee-pareto
      // from a single month has too few rows to find the 80/20.
      // Other tabs default to "this month".
      const today = new Date();
      const longWindowTabs: ReportTab[] = [
        "envelope",
        "sankey",
        "treemap",
        "heatmap",
        "scatter",
        "payees",
        "accounts",
      ];
      const defaultMonths = longWindowTabs.includes(activeTab) ? 11 : 0;
      setFrom(
        format(startOfMonth(subMonths(today, defaultMonths)), "yyyy-MM-dd"),
      );
      setTo(format(endOfMonth(today), "yyyy-MM-dd"));
    }
  }, [activeTab, displayPrefs.reportsPeriodByTab]);

  function applyRange(newFrom: string, newTo: string) {
    setFrom(newFrom);
    setTo(newTo);
    if (activeTab === "tax") return;
    setPref("reportsPeriodByTab", {
      ...displayPrefs.reportsPeriodByTab,
      [activeTab]: { from: newFrom, to: newTo },
    });
  }

  const { ids: accountIds } = useAccountFilter();
  const accountIdsParam = accountIds.length > 0 ? `&accountIds=${accountIds.join(",")}` : "";

  const { data: catData = [] } = useSWR<CategoryRow[]>(
    `/api/reports?groupBy=category&from=${from}&to=${to}&hideTransfers=${hideTransfers}${accountIdsParam}`,
    fetcher
  );

  const { data: monthData = [] } = useSWR<MonthRow[]>(
    `/api/reports?groupBy=month&from=${from}&to=${to}&hideTransfers=${hideTransfers}${accountIdsParam}`,
    fetcher
  );

  const incomes = catData
    .filter((r) => r.categoryType === "income")
    .filter((r) => parseFloat(r.total) > 0)
    .slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Date range filter */}
      <div data-print-hide className="flex flex-wrap gap-3 items-center">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">From</label>
          <input
            type="date" min="1900-01-01" max="2099-12-31"
            value={from}
            onChange={(e) => applyRange(e.target.value, to)}
            className="text-sm border rounded-md px-3 py-2 bg-background"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">To</label>
          <input
            type="date" min="1900-01-01" max="2099-12-31"
            value={to}
            onChange={(e) => applyRange(from, e.target.value)}
            className="text-sm border rounded-md px-3 py-2 bg-background"
          />
        </div>
        {/* Quick-range popover. The trigger labels itself with the
            currently active preset (or "Custom range" when from/to
            land between presets) and opens a 2-column grid: this
            period on the left, last period on the right, one pair
            per row (Month, Quarter, Year, Financial Year). Wrapped
            in a label stack so it baselines with the From/To
            inputs instead of floating above them. */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Quick range
          </label>
          <RangePresetPopover from={from} to={to} now={now} onApply={applyRange} />
        </div>

      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-print-hide>
          <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="yoy">Year over Year</TabsTrigger>
          <TabsTrigger value="expenses">Expenses by Category</TabsTrigger>
          <TabsTrigger value="income">Income by Category</TabsTrigger>
          <TabsTrigger value="envelope">Envelope</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="sankey">Sankey</TabsTrigger>
          <TabsTrigger value="treemap">Treemap</TabsTrigger>
          <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
          <TabsTrigger value="scatter">Scatter</TabsTrigger>
          <TabsTrigger value="payees">Payees</TabsTrigger>
          <TabsTrigger value="tax">Tax Deductions</TabsTrigger>
        </TabsList>

        {/* Cash Flow Report */}
        <TabsContent value="cashflow">
          <CashflowReport from={from} to={to} accountIds={accountIds} hideTransfers={hideTransfers} />
        </TabsContent>

        {/* Year over Year — owns its own FY scope (anchored to today's
            financial year, not the page from/to), same as Tax. */}
        <TabsContent value="yoy">
          <YoYReport accountIds={accountIds} hideTransfers={hideTransfers} />
        </TabsContent>

        {/* Tax Deductions Report — owns its own FY scope, ignores the page-level
            from/to/hideTransfers controls. */}
        <TabsContent value="tax">
          <TaxDeductionsReport accountIds={accountIds} />
        </TabsContent>

        {/* Envelope (weekly) — top-level expense roll-up scaled to per-week / per-month. */}
        <TabsContent value="envelope">
          <EnvelopeReport
            from={from}
            to={to}
            accountIds={accountIds}
            hideTransfers={hideTransfers}
          />
        </TabsContent>

        {/* Accounts — per-account credit / debit / closing balance
            by month, mirrors the cashflow report's column layout but
            grouped by account instead of category. */}
        <TabsContent value="accounts">
          <AccountsCashflowReport from={from} to={to} accountIds={accountIds} />
        </TabsContent>

        {/* Sankey — money-flow visualisation: income → hub → expenses, with
            a Saved / Savings node on whichever side balances the period. */}
        <TabsContent value="sankey">
          <SankeyReport
            from={from}
            to={to}
            accountIds={accountIds}
            hideTransfers={hideTransfers}
          />
        </TabsContent>

        {/* Treemap — category hierarchy at a glance, rectangles sized
            by absolute spend; drills via click on a sub-rectangle. */}
        <TabsContent value="treemap">
          <TreemapReport
            from={from}
            to={to}
            accountIds={accountIds}
            hideTransfers={hideTransfers}
          />
        </TabsContent>

        {/* Daily-spend heatmap — GitHub-contributions-style grid;
            cell colour intensity tracks day-total absolute spend. */}
        <TabsContent value="heatmap">
          <DailyHeatmapReport
            from={from}
            to={to}
            accountIds={accountIds}
            hideTransfers={hideTransfers}
          />
        </TabsContent>

        {/* Scatter — every transaction as a dot (date × amount),
            colour by category, smoothing line on top. */}
        <TabsContent value="scatter">
          <ScatterReport
            from={from}
            to={to}
            accountIds={accountIds}
            hideTransfers={hideTransfers}
          />
        </TabsContent>

        {/* Pareto — top-25 payees by absolute spend with cumulative
            % overlay; surfaces the 20/80. */}
        <TabsContent value="payees">
          <PayeeParetoReport
            from={from}
            to={to}
            accountIds={accountIds}
            hideTransfers={hideTransfers}
          />
        </TabsContent>

        {/* Monthly income vs expenses */}
        <TabsContent value="monthly">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Income vs Expenses by Month</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthData.map((m) => ({
                  month: m.month,
                  Income: parseFloat(m.income),
                  Expenses: parseFloat(m.expenses),
                  Net: parseFloat(m.net),
                }))}>
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} width={45} />
                  <Tooltip content={<ReportsBarTooltip />} />
                  <Legend />
                  <Bar dataKey="Income" fill="#22c55e" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Expenses" fill={TREND_DOWN} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>

              {/* Table */}
              <table className="w-full text-sm mt-4">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2">Month</th>
                    <th className="text-right py-2">Income</th>
                    <th className="text-right py-2">Expenses</th>
                    <th className="text-right py-2">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {monthData.map((m) => (
                    <tr key={m.month}>
                      <td className="py-2">{m.month}</td>
                      <td className="py-2 text-right text-emerald-600">{formatAUD(m.income)}</td>
                      <td className="py-2 text-right text-red-500">{formatAUD(m.expenses)}</td>
                      <td className={`py-2 text-right font-medium ${parseFloat(m.net) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {formatAUD(m.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Expense drill-down */}
        <TabsContent value="expenses">
          <ExpensesDrilldown
            from={from}
            to={to}
            accountIds={accountIds}
            hideTransfers={hideTransfers}
          />
        </TabsContent>

        {/* Income breakdown */}
        <TabsContent value="income">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Income Breakdown</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={incomes.map((e) => ({
                        name: e.categoryName ?? "Uncategorised",
                        value: parseFloat(e.total),
                      }))}
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      dataKey="value"
                      label={({ percent }) =>
                        (percent ?? 0) > 0.05 ? `${((percent ?? 0) * 100).toFixed(0)}%` : ""
                      }
                    >
                      {incomes.map((_, i) => (
                        <Cell key={i} fill={["#22c55e", "#16a34a", "#15803d", "#14532d", "#065f46"][i % 5]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ReportsPieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Income Sources</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {incomes.map((e, i) => (
                    <li key={i} className="flex items-center justify-between text-sm">
                      <span>{e.categoryName ?? "Uncategorised"}</span>
                      <span className="font-medium text-emerald-600">{formatAUD(e.total)}</span>
                    </li>
                  ))}
                  {incomes.length === 0 && (
                    <p className="text-muted-foreground text-sm">No income data for this period.</p>
                  )}
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Pop-up date-range picker. Trigger button shows the active
 * preset's label (or "Custom range" when from/to don't match any
 * preset). Content is a 4×2 grid of one-click ranges. */
function RangePresetPopover({
  from,
  to,
  now,
  onApply,
}: {
  from: string;
  to: string;
  now: Date;
  onApply: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const presetRows = buildRangePresets(now);
  // Active preset = the one whose computed from/to matches the
  // current state. Stable highlight after manual edits that happen
  // to land on a preset boundary too.
  const allPresets = presetRows.flat();
  const active = allPresets.find((p) => p.from === from && p.to === to);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Pick a date range"
            className="inline-flex items-center gap-1.5 text-sm border rounded-md px-3 py-2 bg-background hover:bg-muted transition-colors"
          />
        }
      >
        <span>{active ? active.label : "Custom range"}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="grid grid-cols-2 gap-1.5">
          {presetRows.map(([thisP, lastP]) => (
            <Fragment key={thisP.key}>
              <PresetButton
                preset={thisP}
                isActive={active?.key === thisP.key}
                onPick={() => {
                  onApply(thisP.from, thisP.to);
                  setOpen(false);
                }}
              />
              <PresetButton
                preset={lastP}
                isActive={active?.key === lastP.key}
                onPick={() => {
                  onApply(lastP.from, lastP.to);
                  setOpen(false);
                }}
              />
            </Fragment>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PresetButton({
  preset,
  isActive,
  onPick,
}: {
  preset: RangePreset;
  isActive: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`text-left rounded-md px-3 py-2 text-xs font-medium transition-colors ${
        isActive
          ? "bg-indigo-600 text-white hover:bg-indigo-700"
          : "hover:bg-muted"
      }`}
    >
      {preset.label}
    </button>
  );
}
