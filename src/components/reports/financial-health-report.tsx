"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { format, parseISO } from "date-fns";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/state-message";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartTooltipCard,
  ChartTooltipHeader,
  ChartTooltipRow,
} from "@/components/ui/chart-tooltip";
import { useSwrJson } from "@/hooks/use-swr-json";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { formatAUD, formatAUDShort } from "@/lib/utils";
import type { CashflowReport as CashflowData } from "@/app/api/reports/cashflow/route";
import { StatTile } from "./_shared/stat-tile";
import {
  savingsRateForMonth,
  savingsRateSeries,
  avgMonthlyExpenses,
  avgMonthlyIncome,
  resolveEmergencyFundAccounts,
  resolveLiabilityAccounts,
  emergencyFundMonths,
  debtToIncome,
  netWorth,
  topExpenseCategories,
  type AccountLite,
} from "./_shared/health-calcs";

/** Financial Health — a one-page motivational board. Answers "am I
 *  on track?" at a glance:
 *  1. Stat row: savings rate, net worth, emergency-fund coverage,
 *     debt-to-income.
 *  2. Savings-rate line over the full window with a target line.
 *  3. Current-month expense composition donut.
 *  4. Targets card so the operator can tune the two thresholds
 *     without leaving the report.
 *
 *  Feeds off two existing endpoints: `/api/reports/cashflow` for
 *  the time series + expense breakdown, and `/api/accounts` for
 *  the balance snapshot. No new backend. */
export function FinancialHealthReport({
  from,
  to,
  accountIds,
}: {
  from: string;
  to: string;
  accountIds: string[];
}) {
  const { prefs, setPref } = useDisplayPrefs();

  const accountIdsParam =
    accountIds.length > 0 ? `&accountIds=${accountIds.join(",")}` : "";
  const {
    data: cashflow,
    isLoading: cashflowLoading,
    error: cashflowError,
    mutate: retryCashflow,
  } = useSwrJson<CashflowData>(
    `/api/reports/cashflow?from=${from}&to=${to}&hideTransfers=true${accountIdsParam}`,
  );
  const {
    data: accountsData,
    isLoading: accountsLoading,
    error: accountsError,
  } = useSwrJson<AccountLite[]>(`/api/accounts?includeArchived=true`);

  const isLoading = cashflowLoading || accountsLoading;
  const error = cashflowError ?? accountsError;

  // ------- derived values (unconditional hook — safe with empty data) -------
  const derived = useMemo(() => {
    if (!cashflow || !accountsData) return null;
    if (cashflow.months.length === 0) return null;
    const lastMonth = cashflow.months[cashflow.months.length - 1];
    const prevMonth =
      cashflow.months.length >= 2
        ? cashflow.months[cashflow.months.length - 2]
        : null;

    const currentSavingsRate = savingsRateForMonth(cashflow, lastMonth);
    const prevSavingsRate = prevMonth
      ? savingsRateForMonth(cashflow, prevMonth)
      : null;
    const savingsRateDelta =
      currentSavingsRate !== null && prevSavingsRate !== null
        ? currentSavingsRate - prevSavingsRate
        : null;

    const nw = netWorth(accountsData);

    const emergencyAccounts = resolveEmergencyFundAccounts(
      accountsData,
      prefs.healthEmergencyFundAccountIds,
    );
    const emergencyBalance = emergencyAccounts.reduce((sum, a) => {
      const bal =
        typeof a.currentBalance === "number"
          ? a.currentBalance
          : parseFloat(a.currentBalance);
      return sum + (Number.isFinite(bal) ? bal : 0);
    }, 0);
    const avgExp = avgMonthlyExpenses(cashflow, 3);
    const efMonths = emergencyFundMonths(emergencyBalance, avgExp);

    const liabilityAccounts = resolveLiabilityAccounts(
      accountsData,
      prefs.healthLiabilityAccountIds,
    );
    const liabilitiesTotal = liabilityAccounts.reduce((sum, a) => {
      const bal =
        typeof a.currentBalance === "number"
          ? a.currentBalance
          : parseFloat(a.currentBalance);
      return sum + (Number.isFinite(bal) ? bal : 0);
    }, 0);
    const avgInc = avgMonthlyIncome(cashflow, 3);
    const dti = debtToIncome(liabilitiesTotal, avgInc);

    const rateSeries = savingsRateSeries(cashflow);
    const composition = topExpenseCategories(cashflow.expenses, lastMonth, 5);

    return {
      lastMonth,
      currentSavingsRate,
      savingsRateDelta,
      nw,
      emergencyAccounts,
      emergencyBalance,
      efMonths,
      liabilityAccounts,
      liabilitiesTotal,
      dti,
      rateSeries,
      composition,
    };
  }, [
    cashflow,
    accountsData,
    prefs.healthEmergencyFundAccountIds,
    prefs.healthLiabilityAccountIds,
  ]);

  if (isLoading) {
    return <LoadingState label="Loading financial health…" />;
  }
  if (error) {
    return (
      <ErrorState
        label="Couldn’t load the financial health board."
        onRetry={() => retryCashflow()}
      />
    );
  }
  if (!derived) {
    return <EmptyState>No data for this period.</EmptyState>;
  }

  const target = prefs.healthTargetSavingsRatePct;
  const targetMonths = prefs.healthTargetEmergencyMonths;

  const savingsRatePctLabel = formatPct(derived.currentSavingsRate);
  const efMonthsLabel =
    derived.efMonths === null ? "—" : `${derived.efMonths.toFixed(1)} mo`;
  const dtiPctLabel = formatPct(derived.dti);

  return (
    <div className="mx-auto max-w-4xl space-y-4 print-portrait">
      {/* Stat row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Savings rate"
          value={savingsRatePctLabel}
          hint={`Target ${(target * 100).toFixed(0)}%`}
          delta={derived.savingsRateDelta}
          goodDirection="up"
        />
        <StatTile
          label="Net worth"
          value={formatAUD(derived.nw)}
          hint={`${countLive(accountsData)} accounts`}
        />
        <StatTile
          label="Emergency fund"
          value={efMonthsLabel}
          hint={`Target ${targetMonths} mo`}
          goodDirection="up"
        />
        <StatTile
          label="Debt-to-income"
          value={dtiPctLabel}
          hint="Lower is better"
          goodDirection="down"
        />
      </div>

      {/* Savings-rate over time */}
      <Card>
        <CardHeader>
          <CardTitle>Savings rate over time</CardTitle>
          <p className="text-xs text-muted-foreground">
            Monthly (income + expenses) ÷ income. Dashed line marks
            your {(target * 100).toFixed(0)}% target.
          </p>
        </CardHeader>
        <CardContent>
          {derived.rateSeries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No month in this window has both income and expense data.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart
                data={derived.rateSeries.map((r) => ({
                  month: r.month,
                  rate: r.rate,
                }))}
                margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
              >
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(m) => format(parseISO(`${m}-01`), "MMM ''yy")}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  width={40}
                  domain={[
                    (dataMin: number) => Math.min(0, Math.floor(dataMin * 10) / 10),
                    (dataMax: number) => Math.max(target, Math.ceil(dataMax * 10) / 10),
                  ]}
                />
                <Tooltip content={<SavingsRateTooltip target={target} />} />
                <ReferenceLine
                  y={target}
                  stroke="#6366f1"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Line
                  type="monotone"
                  dataKey="rate"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#10b981" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Composition + Targets side by side on desktop */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              Where the money went — {format(parseISO(`${derived.lastMonth}-01`), "MMM ''yy")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Top 5 expense categories this month plus the tail.
            </p>
          </CardHeader>
          <CardContent>
            {derived.composition.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No expenses recorded this month.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={derived.composition}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    innerRadius={40}
                    label={({ percent }) =>
                      (percent ?? 0) > 0.06
                        ? `${((percent ?? 0) * 100).toFixed(0)}%`
                        : ""
                    }
                  >
                    {derived.composition.map((_, i) => (
                      <Cell key={i} fill={PIE_COLOURS[i % PIE_COLOURS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CompositionTooltip />} />
                  <Legend
                    verticalAlign="bottom"
                    wrapperStyle={{ fontSize: 11 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Targets</CardTitle>
            <p className="text-xs text-muted-foreground">
              Persisted with your other display preferences.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block">
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="font-medium">Savings rate target</span>
                <span className="tabular-nums text-muted-foreground">
                  {(target * 100).toFixed(0)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={0.6}
                step={0.05}
                value={target}
                onChange={(e) =>
                  setPref(
                    "healthTargetSavingsRatePct",
                    parseFloat(e.target.value),
                  )
                }
                className="w-full accent-indigo-600"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                A common FIRE benchmark is 20%.
              </p>
            </label>

            <label className="block">
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="font-medium">Emergency-fund target</span>
                <span className="tabular-nums text-muted-foreground">
                  {targetMonths} mo
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={12}
                step={1}
                value={targetMonths}
                onChange={(e) =>
                  setPref(
                    "healthTargetEmergencyMonths",
                    parseInt(e.target.value, 10),
                  )
                }
                className="w-full accent-indigo-600"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {derived.emergencyAccounts.length > 0 ? (
                  <>
                    Fund pulls from {derived.emergencyAccounts.length} account
                    {derived.emergencyAccounts.length === 1 ? "" : "s"} —{" "}
                    {derived.emergencyAccounts
                      .slice(0, 3)
                      .map((a) => a.name ?? a.id.slice(0, 6))
                      .join(", ")}
                    {derived.emergencyAccounts.length > 3 ? "…" : ""}.
                  </>
                ) : (
                  "No savings-type account detected — configure via account settings."
                )}
              </p>
            </label>

            <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-xs">
              <div className="mb-1 font-medium">This month at a glance</div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Emergency fund balance</span>
                <span className="tabular-nums text-foreground">
                  {formatAUDShort(derived.emergencyBalance)}
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Liabilities</span>
                <span className="tabular-nums text-foreground">
                  {formatAUDShort(derived.liabilitiesTotal)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const PIE_COLOURS = [
  "#6366f1",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#0ea5e9",
  "#94a3b8", // "Other" bucket
];

function formatPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function countLive(accounts: AccountLite[] | undefined): number {
  if (!accounts) return 0;
  return accounts.filter((a) => !a.isArchived).length;
}

function SavingsRateTooltip({
  active,
  payload,
  label,
  target,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
  target: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rate = Number(payload[0].value ?? 0);
  const delta = rate - target;
  return (
    <ChartTooltipCard>
      <ChartTooltipHeader
        title={
          typeof label === "string"
            ? format(parseISO(`${label}-01`), "MMM ''yy")
            : String(label ?? "")
        }
      />
      <ChartTooltipRow label="Savings rate" value={formatPct(rate)} />
      <ChartTooltipRow
        label={delta >= 0 ? "Above target" : "Below target"}
        value={formatPct(Math.abs(delta))}
        tone={delta >= 0 ? "positive" : "negative"}
      />
    </ChartTooltipCard>
  );
}

function CompositionTooltip({
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
        label="Spend"
        value={formatAUD(Number(row.value ?? 0))}
        swatch={row.payload?.fill}
      />
    </ChartTooltipCard>
  );
}
