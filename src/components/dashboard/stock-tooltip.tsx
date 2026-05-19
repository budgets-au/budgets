"use client";

import {
  ChartTooltipCard,
  ChartTooltipHeader,
  ChartTooltipRow,
} from "@/components/ui/chart-tooltip";

interface HistoryPoint {
  date: string;
  close: number;
}

/** Recharts tooltip used by the dashboard's tracked-stock and
 *  watched-stock cards. Both cards plot the same {date, close}
 *  shape so they share one renderer; the only call-site
 *  variation is the AUD / USD currency prefix. */
export function StockTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload?: HistoryPoint }>;
  currency: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <ChartTooltipCard className="min-w-[8rem]">
      <ChartTooltipHeader title={p.date} />
      <ChartTooltipRow
        label="Close"
        value={`${currency === "USD" ? "US$" : "A$"}${p.close.toFixed(2)}`}
      />
    </ChartTooltipCard>
  );
}
