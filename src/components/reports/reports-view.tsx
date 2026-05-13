"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { useAccountFilter } from "@/hooks/use-account-filter";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
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
import { formatAUD } from "@/lib/utils";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { CashflowReport } from "./cashflow-report";
import { TaxDeductionsReport } from "./tax-deductions-report";
import { ExpensesDrilldown } from "./expenses-drilldown";
import { EnvelopeReport } from "./envelope-report";
import { SankeyReport } from "./sankey-report";
import { Switch } from "@/components/ui/switch";

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

export function ReportsView({
  accounts,
}: {
  accounts: { id: string; name: string }[];
}) {
  const now = new Date();
  const [from, setFrom] = useState(format(startOfMonth(now), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(endOfMonth(now), "yyyy-MM-dd"));
  const [activeTab, setActiveTab] = useState("cashflow");

  // Per-tab period persistence + hideTransfers both live in the
  // DB-backed displayPrefs blob now, so the operator's choices follow
  // them across devices instead of staying in per-browser localStorage.
  const { prefs: displayPrefs, setPref } = useDisplayPrefs();
  const hideTransfers = displayPrefs.reportsHideTransfers;
  function toggleHideTransfers() {
    setPref("reportsHideTransfers", !hideTransfers);
  }

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
      // Envelope and Tree only really make sense over a long window —
      // a weekly-envelope figure derived from one month of activity is
      // misleading. Other tabs default to "this month".
      const today = new Date();
      const defaultMonths =
        activeTab === "envelope" || activeTab === "sankey" ? 11 : 0;
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

  const PIE_COLORS = [
    "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316",
    "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6",
  ];

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
        {/* Quick ranges — the active range is the one whose computed
            (from, to) matches the current state, so it stays highlighted
            after manual edits land on a preset boundary too. */}
        <div className="flex gap-2">
          {[
            { label: "This month", months: 0 },
            { label: "3 months", months: 2 },
            { label: "6 months", months: 5 },
            { label: "12 months", months: 11 },
          ].map(({ label, months }) => {
            const optFrom = format(startOfMonth(subMonths(now, months)), "yyyy-MM-dd");
            const optTo = format(endOfMonth(now), "yyyy-MM-dd");
            const active = from === optFrom && to === optTo;
            return (
              <button
                key={label}
                onClick={() => applyRange(optFrom, optTo)}
                className={`text-xs px-3 py-2 border rounded-md transition-colors ${
                  active
                    ? "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
                    : "hover:bg-muted"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Hide transfers toggle */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-muted-foreground">Hide transfers</span>
          <Switch
            checked={hideTransfers}
            onCheckedChange={toggleHideTransfers}
            aria-label="Hide transfer-typed transactions"
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-print-hide>
          <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="expenses">Expenses by Category</TabsTrigger>
          <TabsTrigger value="income">Income by Category</TabsTrigger>
          <TabsTrigger value="envelope">Envelope</TabsTrigger>
          <TabsTrigger value="sankey">Sankey</TabsTrigger>
          <TabsTrigger value="tax">Tax Deductions</TabsTrigger>
        </TabsList>

        {/* Cash Flow Report */}
        <TabsContent value="cashflow">
          <CashflowReport from={from} to={to} accountIds={accountIds} hideTransfers={hideTransfers} />
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
                  <Tooltip formatter={(v) => formatAUD(Number(v ?? 0))} />
                  <Legend />
                  <Bar dataKey="Income" fill="#22c55e" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Expenses" fill="#ef4444" radius={[3, 3, 0, 0]} />
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
                    <Tooltip formatter={(v) => formatAUD(Number(v ?? 0))} />
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
