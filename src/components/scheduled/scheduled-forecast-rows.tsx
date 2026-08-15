"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import { expandRecurrence } from "@/lib/recurrence";
import { currentBudgetPeriod } from "@/lib/budget-period";
import { addDays, addMonths, addWeeks, addYears, parseISO } from "date-fns";
import type { ScheduledTransaction } from "@/db/schema";
import { FORECAST_HORIZON as HORIZON } from "@/lib/forecast";

interface ScheduleLite {
  id: string;
  /** "schedule" | "budget" — left as string to absorb the loose drizzle row
   * type without casting. */
  kind: string;
  amount: string;
  type: string;
  frequency: string;
  interval: number | null;
  startDate: string;
  endDate: string | null;
  dayOfMonth: number | null;
  isActive: boolean;
  accountId: string | null;
  categoryId: string | null;
  transferToAccountId: string | null;
}

interface UpcomingOccurrence {
  /** Storage key — for schedules this is the occurrence date, for budgets
   * the period's `from` date (period anchor). */
  date: string;
  /** Display label — for schedules a single date, for budgets a range. */
  label: string;
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nextBudgetPeriodStart(from: Date, frequency: string): Date {
  switch (frequency) {
    case "weekly":
      return addWeeks(from, 1);
    case "monthly":
      return addMonths(from, 1);
    case "quarterly":
      return addMonths(from, 3);
    case "yearly":
      return addYears(from, 1);
    default:
      return addMonths(from, 1);
  }
}

interface ForecastEntry {
  scheduledId: string;
  occurrenceDate: string;
  amount: string | null;
  newDate: string | null;
}

export function ScheduledForecastRows({
  schedule,
  initialForecasts,
  onChanged,
}: {
  schedule: ScheduleLite;
  initialForecasts: ForecastEntry[];
  onChanged?: () => void;
}) {
  const fcMap = useMemo(() => {
    const m = new Map<string, { amount: string | null; newDate: string | null }>();
    for (const f of initialForecasts) {
      if (f.scheduledId === schedule.id) {
        m.set(f.occurrenceDate, { amount: f.amount, newDate: f.newDate });
      }
    }
    return m;
  }, [initialForecasts, schedule.id]);

  // Project the next HORIZON future occurrences. Schedules use expandRecurrence;
  // budgets walk forward by period (the unit a cap applies to), starting from
  // the next period after the one currently in progress so the override only
  // affects future spend windows. Deps are the primitive schedule fields —
  // using the schedule object directly would re-create this array on every
  // parent re-render (the parent rebuilds `editing` each pass), which then
  // tripped the effect below and wiped any in-progress draft typing.
  const occurrences = useMemo<UpcomingOccurrence[]>(() => {
    if (!schedule.isActive) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (schedule.kind === "budget") {
      const cur = currentBudgetPeriod(schedule.startDate, schedule.frequency, today);
      const out: UpcomingOccurrence[] = [];
      let from = parseISO(cur.from);
      // Skip the in-progress period — only forecast caps for periods that
      // haven't started yet. The user can still tweak the live cap by editing
      // the schedule's standard amount.
      from = nextBudgetPeriodStart(from, schedule.frequency);
      const end = schedule.endDate ? parseISO(schedule.endDate) : null;
      for (let i = 0; i < HORIZON; i++) {
        if (end && from > end) break;
        const next = nextBudgetPeriodStart(from, schedule.frequency);
        const to = addDays(next, -1);
        out.push({
          date: toISO(from),
          label: `${formatDate(toISO(from))} – ${formatDate(toISO(to))}`,
        });
        from = next;
      }
      return out;
    }

    const todayISO = toISO(today);
    const start = parseISO(schedule.startDate);
    const end = schedule.endDate ? parseISO(schedule.endDate) : addMonths(today, 36);
    const fromDate = start > today ? start : today;
    if (fromDate > end) return [];
    const projected = expandRecurrence(schedule as unknown as ScheduledTransaction, fromDate, end);
    return projected
      .filter((o) => o.date > todayISO)
      .slice(0, HORIZON)
      .map((o) => ({ date: o.date, label: formatDate(o.date) }));
  }, [
    schedule.id,
    schedule.kind,
    schedule.startDate,
    schedule.endDate,
    schedule.frequency,
    schedule.interval,
    schedule.dayOfMonth,
    schedule.isActive,
  ]);

  // Local input state, keyed by occurrence date. Two axes per row —
  // amount (magnitude only; sign added from schedule.type on save)
  // and date (an ISO YYYY-MM-DD to shift the occurrence to). Empty
  // strings mean "no override on that axis" — the schedule's own
  // amount / rule-derived date apply.
  interface Draft {
    amount: string;
    date: string;
  }
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const out: Record<string, Draft> = {};
    for (const o of occurrences) {
      const v = fcMap.get(o.date);
      out[o.date] = {
        amount: v?.amount ? Math.abs(parseFloat(v.amount)).toFixed(2) : "",
        date: v?.newDate ?? "",
      };
    }
    return out;
  });

  // Reset drafts when the user switches schedules or the persisted forecasts
  // change. Deliberately NOT depending on `occurrences` — that array's
  // identity wobbled across parent renders and would otherwise wipe
  // in-progress draft typing.
  useEffect(() => {
    const out: Record<string, Draft> = {};
    for (const o of occurrences) {
      const v = fcMap.get(o.date);
      out[o.date] = {
        amount: v?.amount ? Math.abs(parseFloat(v.amount)).toFixed(2) : "",
        date: v?.newDate ?? "",
      };
    }
    setDrafts(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule.id, fcMap]);

  const [savingDate, setSavingDate] = useState<string | null>(null);

  // A row counts as an override when either axis has a stored value.
  const overrideCount = occurrences.filter((o) => {
    const v = fcMap.get(o.date);
    return !!v && (v.amount !== null || v.newDate !== null);
  }).length;
  const [expanded, setExpanded] = useState(false);
  // Collapse when the user switches schedules. (Hook must run before the
  // early return below — otherwise newly-added schedules with no upcoming
  // occurrences cause a "rendered fewer hooks" violation.)
  useEffect(() => {
    setExpanded(false);
  }, [schedule.id]);

  async function save(date: string) {
    const draft = drafts[date];
    const amountValue = (draft?.amount ?? "").trim();
    const dateValue = (draft?.date ?? "").trim();
    setSavingDate(date);
    try {
      // Both axes empty → delete the row entirely. At least one axis
      // set → POST an upsert with only the axes that carry a value.
      const method = !amountValue && !dateValue ? "DELETE" : "POST";
      const body: Record<string, string> = { occurrenceDate: date };
      if (method === "POST") {
        if (amountValue) body.amount = amountValue;
        if (dateValue) body.newDate = dateValue;
      }
      const res = await fetch(`/api/scheduled/${schedule.id}/forecasts`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toast.success(method === "POST" ? "Forecast saved" : "Forecast cleared");
      onChanged?.();
    } catch {
      toast.error("Failed to save forecast");
    } finally {
      setSavingDate(null);
    }
  }

  if (occurrences.length === 0) return null;

  const standardMagnitude = Math.abs(parseFloat(schedule.amount)).toFixed(2);

  return (
    <div className="space-y-2 pt-2 border-t">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        <Label className="text-[11px] cursor-pointer">Upcoming forecast</Label>
        {overrideCount > 0 && (
          <span className="text-[10px] text-amber-600">
            {overrideCount} override{overrideCount === 1 ? "" : "s"}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          standard ${standardMagnitude}
        </span>
      </button>
      {expanded && (
      <div className="overflow-x-auto rounded-md border bg-background">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className={`px-2 py-1 text-left font-medium ${schedule.kind === "budget" ? "w-56" : "w-32"}`}>
                {schedule.kind === "budget" ? "Period" : "Date"}
              </th>
              {schedule.kind !== "budget" && (
                <th className="px-2 py-1 text-left font-medium w-36">
                  Shift to
                </th>
              )}
              <th className="px-2 py-1 text-right font-medium">
                {schedule.kind === "budget" ? "Forecast cap" : "Forecast amount"}
              </th>
              <th className="px-2 py-1 text-left font-medium w-12">Status</th>
              <th className="px-2 py-1 text-right font-medium w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {occurrences.map((occ) => {
              const draft = drafts[occ.date] ?? { amount: "", date: "" };
              const stored = fcMap.get(occ.date);
              const storedAmount = stored?.amount
                ? Math.abs(parseFloat(stored.amount)).toFixed(2)
                : "";
              const storedDate = stored?.newDate ?? "";
              const dirty =
                draft.amount !== storedAmount || draft.date !== storedDate;
              const hasOverride =
                !!stored && (stored.amount !== null || stored.newDate !== null);
              const willClear = !draft.amount.trim() && !draft.date.trim();
              return (
                <tr key={occ.date}>
                  <td className="px-2 py-1 tabular-nums whitespace-nowrap">
                    {occ.label}
                  </td>
                  {schedule.kind !== "budget" && (
                    <td className="px-2 py-1">
                      <Input
                        type="date"
                        min="1900-01-01"
                        max="2099-12-31"
                        value={draft.date}
                        onChange={(e) =>
                          setDrafts((p) => ({
                            ...p,
                            [occ.date]: {
                              ...(p[occ.date] ?? { amount: "", date: "" }),
                              date: e.target.value,
                            },
                          }))
                        }
                        placeholder={occ.date}
                        className="h-7 text-xs max-w-[140px]"
                      />
                    </td>
                  )}
                  <td className="px-2 py-1 text-right">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={draft.amount}
                      onChange={(e) =>
                        setDrafts((p) => ({
                          ...p,
                          [occ.date]: {
                            ...(p[occ.date] ?? { amount: "", date: "" }),
                            amount: e.target.value,
                          },
                        }))
                      }
                      placeholder={standardMagnitude}
                      className="h-7 text-xs text-right ml-auto max-w-[140px] tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-1 text-[10px] text-muted-foreground">
                    {hasOverride ? "override" : "standard"}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {dirty ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => save(occ.date)}
                        disabled={savingDate === occ.date}
                        className="h-7 px-2 text-[10px]"
                      >
                        {savingDate === occ.date ? "…" : willClear ? "Clear" : "Save"}
                      </Button>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
