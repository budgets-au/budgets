"use client";

import { useSwrJson } from "@/hooks/use-swr-json";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { amountClass, formatAUD } from "@/lib/utils";


interface Account {
  id: string;
  currentBalance: string;
  isArchived: boolean;
}

/** Sum of currentBalance across non-archived accounts. Matches the
 * formula the dashboard headline figure has always used; this just
 * moves the computation client-side so the card can live as a
 * draggable widget rather than a server-rendered Tailwind cell. */
export function NetWorthCard() {
  const { data: accounts = [] } = useSwrJson<Account[]>("/api/accounts");
  const visible = accounts.filter((a) => !a.isArchived);
  const total = visible.reduce(
    (s, a) => s + (Number.isFinite(parseFloat(a.currentBalance)) ? parseFloat(a.currentBalance) : 0),
    0,
  );
  return (
    <Card data-size="sm" className="h-full">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Net Worth
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-bold ${amountClass(total)}`}>
          {formatAUD(total)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          across {visible.length} account{visible.length !== 1 ? "s" : ""}
        </p>
      </CardContent>
    </Card>
  );
}
