"use client";

import useSWR from "swr";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartTooltipCard,
  ChartTooltipHeader,
  ChartTooltipRow,
} from "@/components/ui/chart-tooltip";
import { cn, formatAUD, amountClass } from "@/lib/utils";
import type { Account } from "@/db/schema";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface FlowResp {
  series: { date: string; inflow: number; outflow: number }[];
}

const INFLOW_COLOR = "#10b981"; // emerald-500
const OUTFLOW_COLOR = "#ef4444"; // red-500

function FlowTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { date: string; inflow: number; outflow: number } }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <ChartTooltipCard className="min-w-[9rem]">
      <ChartTooltipHeader title={p.date} />
      <ChartTooltipRow label="In" value={formatAUD(p.inflow)} />
      <ChartTooltipRow label="Out" value={formatAUD(p.outflow)} />
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
 * it shows the account's colour stripe + name + balance + type
 * line, matching the AccountHeader visual rhythm but in a 2×2 tile.
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
  const { data: accountsData } = useSWR<Account[]>(
    "/api/accounts?includeArchived=true",
    fetcher,
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

  // 7-day in/out series for the selected account. SWR keyed by id
  // so switching the picked account triggers a fresh fetch. Skipped
  // (key=null) when nothing is selected, so an empty card doesn't
  // ping the endpoint.
  const { data: flowData } = useSWR<FlowResp>(
    selected
      ? `/api/dashboard/account-daily-flow?accountId=${selected.id}&days=7`
      : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  const flow = flowData?.series ?? [];
  const hasFlow = flow.some((p) => p.inflow > 0 || p.outflow > 0);

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
            {/* 7-day in/out bar chart. Suspended in edit mode for the
            same reason tracked-stock's sparkline is — recharts'
            ResponsiveContainer fires ResizeObserver updates as RGL
            shifts cells during a drag, and recharts 3.x's internal
            redux store can push the cascade past React's update-
            depth ceiling. Also hidden when the window has no
            activity at all, so a fresh / dormant account doesn't
            show an empty axis. */}
            <div className="flex-1 min-h-0 mt-1 -mx-1">
              {editMode ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Chart hidden while editing
                  </p>
                </div>
              ) : hasFlow ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={flow} barCategoryGap={2} barGap={1}>
                    <Tooltip
                      cursor={{ fill: "rgba(127,127,127,0.08)" }}
                      content={<FlowTooltip />}
                    />
                    <Bar
                      dataKey="inflow"
                      fill={INFLOW_COLOR}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="outflow"
                      fill={OUTFLOW_COLOR}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-[10px] text-muted-foreground text-center pt-1">
                  No activity in 7 days.
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
