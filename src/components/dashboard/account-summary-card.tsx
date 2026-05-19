"use client";

import { useSwrJson } from "@/hooks/use-swr-json";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartTooltipCard,
  ChartTooltipHeader,
  ChartTooltipRow,
} from "@/components/ui/chart-tooltip";
import { cn, formatAUD, amountClass } from "@/lib/utils";
import { TREND_UP, TREND_DOWN } from "@/lib/colours";
import type { Account } from "@/db/schema";


interface BalanceTrendResp {
  series: { date: string; balance: number }[];
}

function BalanceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { date: string; balance: number } }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <ChartTooltipCard className="min-w-[9rem]">
      <ChartTooltipHeader title={p.date} />
      <ChartTooltipRow label="Balance" value={formatAUD(p.balance)} />
    </ChartTooltipCard>
  );
}

/** Dashboard widget that pins a single user-picked account. The
 * active selection lives in the layout entry's `config.accountId`.
 * In edit mode the card surfaces a dropdown of every account on the
 * file, including ones the operator hid from the rest of the
 * dashboard — pinning a hidden account here is the whole point
 * (a closed CC the user still wants visibility on, a savings goal
 * they don't want polluting balance sums, etc.). Out of edit mode
 * it shows the balance + institution line and a 7-day
 * running-balance sparkline below it.
 *
 * Note: the dropdown carries `widget-cancel-drag` so RGL doesn't
 * swallow the click that opens the native picker. */
export function AccountSummaryCard({
  config,
  editMode,
  onConfigChange,
}: {
  config?: Record<string, unknown>;
  editMode: boolean;
  onConfigChange?: (next: Record<string, unknown>) => void;
}) {
  const accountId =
    typeof config?.accountId === "string" ? config.accountId : null;

  // includeArchived=true so the dropdown can offer hidden accounts
  // (the whole point of pinning is that an archived account stays
  // visible) and so view-mode can still resolve a pinned-archived
  // selection back to its row. The default /api/accounts response
  // filters them out for sidebar / transaction-filter callers.
  const { data: accountsData } = useSwrJson<Account[]>(
    "/api/accounts?includeArchived=true",
    { revalidateOnFocus: false },
  );
  const accounts: Account[] = Array.isArray(accountsData) ? accountsData : [];

  // Split visible / hidden so the dropdown's <optgroup> reads top-down
  // (visible first, then hidden underneath) — quicker to scan for the
  // common case while still letting the operator pick an archived
  // account if they want to.
  const visible = accounts.filter((a) => !a.isArchived);
  const hidden = accounts.filter((a) => a.isArchived);
  const selected = accountId
    ? accounts.find((a) => a.id === accountId) ?? null
    : null;

  // 7-day daily-end balance series. SWR keyed by id so switching
  // the picked account triggers a fresh fetch; skipped when nothing
  // is selected.
  const { data: trendData } = useSwrJson<BalanceTrendResp>(
    selected
      ? `/api/dashboard/account-balance-trend?accountId=${selected.id}&days=7`
      : null,
    { revalidateOnFocus: false },
  );
  const trend = trendData?.series ?? [];
  const startBal = trend[0]?.balance;
  const endBal = trend[trend.length - 1]?.balance;
  const trendUp =
    startBal != null && endBal != null ? endBal >= startBal : true;
  const lineColor = trendUp ? TREND_UP : TREND_DOWN;

  return (
    <Card data-size="sm" className="h-full flex flex-col">
      <CardHeader className="pb-1 shrink-0 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <Wallet className="h-3.5 w-3.5" />
          {selected ? (
            <Link
              href={`/transactions?accountIds=${selected.id}`}
              className="hover:text-foreground transition-colors"
            >
              {selected.name}
            </Link>
          ) : (
            "Account"
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col">
        {editMode && (
          <select
            value={accountId ?? ""}
            onChange={(e) =>
              onConfigChange?.({ accountId: e.target.value || null })
            }
            className={cn(
              "widget-cancel-drag mb-2 rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500",
            )}
            aria-label="Pick an account to pin"
          >
            <option value="">— Pick an account —</option>
            {visible.length > 0 && (
              <optgroup label="Accounts">
                {visible.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.institution ? ` — ${a.institution}` : ""}
                  </option>
                ))}
              </optgroup>
            )}
            {hidden.length > 0 && (
              <optgroup label="Hidden">
                {hidden.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.institution ? ` — ${a.institution}` : ""}
                  </option>
                ))}
              </optgroup>
            )}
            {accounts.length === 0 && (
              <option disabled value="">
                No accounts yet
              </option>
            )}
          </select>
        )}
        {!selected ? (
          <p className="text-xs text-muted-foreground">
            {editMode
              ? "Pick an account from the dropdown."
              : "No account configured. Enter edit mode to pick one."}
          </p>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="shrink-0">
              <p
                className={`text-xl font-bold leading-tight ${amountClass(
                  selected.currentBalance,
                )}`}
              >
                {formatAUD(selected.currentBalance)}
              </p>
              {(selected.institution || selected.isArchived) && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {selected.institution ?? ""}
                  {selected.institution && selected.isArchived ? " · " : ""}
                  {selected.isArchived ? "hidden" : ""}
                </p>
              )}
            </div>
            {/* 7-day running-balance sparkline. Suspended in edit
            mode for the same reason tracked-stock's sparkline is —
            recharts' ResponsiveContainer fires ResizeObserver
            updates as RGL shifts cells during a drag, and recharts
            3.x's internal redux store can push the cascade past
            React's update-depth ceiling. Hidden when the cache has
            fewer than 2 points so we don't draw a degenerate
            horizontal line on a brand-new / dormant account. */}
            <div className="flex-1 min-h-0 mt-1 -mx-1">
              {editMode ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Chart hidden while editing
                  </p>
                </div>
              ) : trend.length >= 2 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend}>
                    <defs>
                      <linearGradient
                        id={`balTrendGrad-${selected.id}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor={lineColor}
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor={lineColor}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <Tooltip content={<BalanceTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="balance"
                      stroke={lineColor}
                      strokeWidth={1.5}
                      fill={`url(#balTrendGrad-${selected.id})`}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
