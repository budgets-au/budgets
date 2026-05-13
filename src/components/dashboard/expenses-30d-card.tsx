"use client";

import useSWR from "swr";
import { ArrowDownRight } from "lucide-react";
import { format, subDays } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAUD } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TxRow {
  amount: string;
}

/** Magnitude of negative transaction amounts in the last 30 days. */
export function Expenses30dCard() {
  const from = format(subDays(new Date(), 30), "yyyy-MM-dd");
  const { data: rows = [] } = useSWR<TxRow[]>(
    `/api/transactions?from=${from}&limit=10000`,
    fetcher,
  );
  const txns: TxRow[] = Array.isArray(rows)
    ? rows
    : ((rows as unknown as { rows?: TxRow[] }).rows ?? []);
  const total = txns
    .filter((t) => parseFloat(t.amount) < 0)
    .reduce((s, t) => s + Math.abs(parseFloat(t.amount)), 0);
  return (
    <Card data-size="sm" className="h-full">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Expenses (30 days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-red-500">{formatAUD(total)}</p>
        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
          <ArrowDownRight className="h-3 w-3 text-red-500" />
          <span>Money out</span>
        </div>
      </CardContent>
    </Card>
  );
}
