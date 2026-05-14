"use client";

import { useEffect, useRef, useState } from "react";
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

/** Approx per-budget row height in pixels (text-xs label +
 * 1.5px progress bar + space-y-0.5 between label+bar +
 * space-y-1.5 between rows ≈ 30 px). Tightened from the
 * previous 38 px so the default h=2 cell fits three rows
 * comfortably instead of clipping the third. */
const ROW_HEIGHT_PX = 30;
/** Hard cap — never compute more than this many rows even if the
 * card is enormous. Beyond ~10 the card stops being a summary. */
const MAX_ROWS = 10;

/** In-period budget progress on the dashboard. Sized dynamically:
 * we measure the card's inner-content height and render only as
 * many rows as fit. Hides itself silently when there are no active
 * budget schedules — most users never set one up, so we don't want
 * the card squatting empty. */
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

  const contentRef = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState<number>(MAX_ROWS);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      setVisibleCount(Math.min(MAX_ROWS, Math.max(0, Math.floor(h / ROW_HEIGHT_PX))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (progress.length === 0) return null;

  const schedById = new Map(scheduled.map((s) => [s.id, s]));
  const catById = new Map(cats.map((c) => [c.id, c]));

  // Join + dedupe. Multiple active budget schedules can target the
  // same category (a paused-then-replaced budget, or layered
  // parent/child entries). Group by `categoryId || scheduledId`
  // (fallback for budgets with no category) and sum caps + spent.
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
    .sort((a, b) => b.pct - a.pct);

  if (rows.length === 0) return null;

  const visibleRows = rows.slice(0, visibleCount);

  return (
    <Card data-size="sm" className="h-full flex flex-col">
      <CardHeader className="pb-1 flex flex-row items-center justify-between space-y-0 shrink-0">
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
      <CardContent className="flex-1 min-h-0 overflow-hidden">
        <div ref={contentRef} className="h-full space-y-1.5 overflow-hidden">
          {visibleRows.map((r) => {
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
        </div>
      </CardContent>
    </Card>
  );
}
