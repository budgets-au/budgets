"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartTooltipCard,
  ChartTooltipHeader,
  ChartTooltipRow,
} from "@/components/ui/chart-tooltip";
import { formatAUD } from "@/lib/utils";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { chartGridStroke } from "@/lib/colours";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface PayeeRow {
  payee: string;
  total: number;
  count: number;
}
interface PayeeResp {
  rows: PayeeRow[];
  otherTotal: number;
  otherCount: number;
}

/** Payee Pareto — top-25 payees by absolute spend, with a
 * cumulative-% line so the operator can see the 80/95 boundary.
 *
 * X = payee (categorical, sorted descending). Y left = bar value
 * in dollars. Y right = cumulative % (0..100 + a bit for the
 * long-tail "other"). `<ReferenceLine>`s at 80 and 95 % anchor
 * the eye.
 *
 * Bar click → `/transactions?q=<payee>` so the user can audit. */
export function PayeeParetoReport({
  from,
  to,
  accountIds,
  hideTransfers,
}: {
  from: string;
  to: string;
  accountIds: string[];
  hideTransfers: boolean;
}) {
  const [kind, setKind] = useState<"expense" | "income" | "all">("expense");
  const isDark = useDarkMode();

  const params = new URLSearchParams({ from, to, kind, limit: "25" });
  if (accountIds.length > 0) params.set("accountIds", accountIds.join(","));
  if (hideTransfers) params.set("hideTransfers", "true");
  const url = `/api/reports/payee-totals?${params}`;
  const { data, isLoading } = useSWR<PayeeResp>(url, fetcher);

  const rows = data?.rows ?? [];
  const otherTotal = data?.otherTotal ?? 0;

  const chartData = useMemo(() => {
    const grandTotal =
      rows.reduce((s, r) => s + r.total, 0) + otherTotal;
    if (grandTotal === 0) return [];
    let running = 0;
    const out = rows.map((r) => {
      running += r.total;
      return {
        payee: r.payee,
        total: r.total,
        count: r.count,
        cumulativePct: (running / grandTotal) * 100,
      };
    });
    if (otherTotal > 0) {
      running += otherTotal;
      out.push({
        payee: `(other ${data?.otherCount ?? 0})`,
        total: otherTotal,
        count: data?.otherCount ?? 0,
        cumulativePct: (running / grandTotal) * 100,
      });
    }
    return out;
  }, [rows, otherTotal, data?.otherCount]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 gap-2">
        <CardTitle className="text-base">Payee Pareto</CardTitle>
        <div
          role="tablist"
          className="inline-flex items-center gap-0.5 rounded-md border bg-muted/30 p-0.5"
        >
          {(["expense", "income", "all"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded transition-colors ${
                kind === k
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            Loading…
          </p>
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            No {kind} transactions in the selected window.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              Top 25 {kind} payees · click a bar to filter the
              transactions list to that payee. Reference lines mark
              the 80% and 95% points of cumulative spend.
            </p>
            <div style={{ width: "100%", height: 460 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 12, right: 48, bottom: 60, left: 8 }}
                >
                  <CartesianGrid
                    stroke={chartGridStroke(isDark)}
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="payee"
                    tick={{ fontSize: 9 }}
                    angle={-45}
                    textAnchor="end"
                    interval={0}
                    height={60}
                  />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={(v) =>
                      v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`
                    }
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                    tick={{ fontSize: 10 }}
                  />
                  <ReferenceLine
                    yAxisId="right"
                    y={80}
                    stroke="#94a3b8"
                    strokeDasharray="3 3"
                    label={{ value: "80%", fontSize: 9, fill: "#94a3b8", position: "right" }}
                  />
                  <ReferenceLine
                    yAxisId="right"
                    y={95}
                    stroke="#94a3b8"
                    strokeDasharray="3 3"
                    label={{ value: "95%", fontSize: 9, fill: "#94a3b8", position: "right" }}
                  />
                  <Tooltip content={<ParetoTooltip />} cursor={{ fill: "transparent" }} />
                  <Bar
                    yAxisId="left"
                    dataKey="total"
                    fill="#6366f1"
                    isAnimationActive={false}
                    onClick={(data) => {
                      // Recharts hands the click handler the rectangle's
                      // datum object; the typed signature is intentionally
                      // wide so cast through `unknown` to the local
                      // payload shape.
                      const p = data as unknown as { payee?: string };
                      if (!p.payee || p.payee.startsWith("(other")) return;
                      window.location.href = `/transactions?q=${encodeURIComponent(p.payee)}`;
                    }}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="cumulativePct"
                    stroke={isDark ? "#fafafa" : "#1e293b"}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-muted-foreground mt-3">
              <Link
                href="/transactions"
                className="hover:text-foreground hover:underline"
              >
                Open transactions →
              </Link>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface ParetoTooltipPayload {
  payload?: {
    payee?: string;
    total?: number;
    count?: number;
    cumulativePct?: number;
  };
}

function ParetoTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ParetoTooltipPayload[];
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const p = payload[0].payload;
  return (
    <ChartTooltipCard>
      <ChartTooltipHeader title={p.payee ?? ""} />
      <ChartTooltipRow
        label="Total"
        value={typeof p.total === "number" ? formatAUD(p.total) : "—"}
      />
      <ChartTooltipRow
        label="Transactions"
        value={String(p.count ?? 0)}
      />
      <ChartTooltipRow
        label="Cumulative"
        value={typeof p.cumulativePct === "number" ? `${p.cumulativePct.toFixed(1)}%` : "—"}
      />
    </ChartTooltipCard>
  );
}
