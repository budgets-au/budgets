"use client";

import { useSwrJson } from "@/hooks/use-swr-json";
import { ArrowUpRight } from "lucide-react";
import { format, subDays } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAUD } from "@/lib/utils";


interface TxRow {
  amount: string;
}

/** Sum of positive transaction amounts in the last 30 days. Matches
 * the previous server-side computation, just fetched via SWR so the
 * card can move into the widget grid. */
export function Income30dCard() {
  const from = format(subDays(new Date(), 30), "yyyy-MM-dd");
  const { data: rows = [] } = useSwrJson<TxRow[]>(
    `/api/transactions?from=${from}&limit=10000`,
  );
  // The transactions endpoint sometimes wraps results in
  // `{rows: [...], total: N}`; tolerate both shapes.
  const txns: TxRow[] = Array.isArray(rows)
    ? rows
    : ((rows as unknown as { rows?: TxRow[] }).rows ?? []);
  const total = txns
    .filter((t) => parseFloat(t.amount) > 0)
    .reduce((s, t) => s + parseFloat(t.amount), 0);
  return (
    <Card data-size="sm" className="h-full">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Income (30 days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-emerald-600">{formatAUD(total)}</p>
        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
          <ArrowUpRight className="h-3 w-3 text-emerald-600" />
          <span>Money in</span>
        </div>
      </CardContent>
    </Card>
  );
}
