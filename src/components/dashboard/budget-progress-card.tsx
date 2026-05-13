"use client";

import useSWR from "swr";
import { Target } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAUD } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ProgressRow {
  scheduledId: string;
  spent: string;
  cap: string;
  periodFrom: string;
  periodTo: string;
}
interface ScheduledRow {
  id: string;
  payee: string | null;
  description: string | null;
  kind: string;
  categoryId: string | null;
}
interface CategoryRow {
  id: string;
  name: string;
}

/** Top-5 in-period budget progress on the dashboard. Hides itself
 * silently when there are no active budget schedules — most users
 * never set one up, so we don't want the card squatting empty. */
export function BudgetProgressCard() {
  const { data: progress = [] } = useSWR<ProgressRow[]>(
    "/api/scheduled/budget-progress",
    fetcher,
    { revalidateOnFocus: false },
  );
  const { data: scheduled = [] } = useSWR<ScheduledRow[]>(
    "/api/scheduled",
    fetcher,
    { revalidateOnFocus: false },
  );
  const { data: cats = [] } = useSWR<CategoryRow[]>(
    "/api/categories",
    fetcher,
    { revalidateOnFocus: false },
  );

  if (progress.length === 0) return null;

  const schedById = new Map(scheduled.map((s) => [s.id, s]));
  const catById = new Map(cats.map((c) => [c.id, c]));

  // Join + dedupe. Multiple active budget schedules can target the
  // same category (a paused-then-replaced budget, or layered
  // parent/child entries). Without deduping, the same category would
  // show as repeated rows in the card. Group by `categoryId ||
  // scheduledId` (fallback for budgets with no category) and sum the
  // caps + spent within each bucket so each category appears once.
  type Row = { key: string; label: string; cap: number; spent: number };
  const byKey = new Map<string, Row>();
  for (const p of progress) {
    const s = schedById.get(p.scheduledId);
    const key = s?.categoryId ?? p.scheduledId;
    const label =
      s?.payee ??
      s?.description ??
      (s?.categoryId ? catById.get(s.categoryId)?.name : null) ??
      "Budget";
    const cap = Math.abs(parseFloat(p.cap));
    const spent = Math.abs(parseFloat(p.spent));
    const existing = byKey.get(key);
    if (existing) {
      existing.cap += cap;
      existing.spent += spent;
    } else {
      byKey.set(key, { key, label, cap, spent });
    }
  }
  const rows = Array.from(byKey.values())
    .filter((r) => r.cap > 0)
    .map((r) => ({
      ...r,
      pct: r.cap > 0 ? Math.min((r.spent / r.cap) * 100, 200) : 0,
    }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);

  if (rows.length === 0) return null;

  return (
    <Card data-size="sm">
      <CardHeader className="pb-1 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5" />
          Budget progress
        </CardTitle>
        <Link
          href="/scheduled?kind=budget"
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          All →
        </Link>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {rows.map((r) => {
          const over = r.spent > r.cap;
          return (
            <div key={r.key} className="space-y-0.5">
              <div className="flex items-baseline justify-between text-xs gap-2">
                <span className="truncate flex-1 min-w-0">{r.label}</span>
                <span
                  className={`tabular-nums ${over ? "text-red-500 font-medium" : "text-muted-foreground"}`}
                >
                  {formatAUD(r.spent)} / {formatAUD(r.cap)}
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${over ? "bg-red-500" : "bg-indigo-500"}`}
                  style={{ width: `${Math.min(r.pct, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
