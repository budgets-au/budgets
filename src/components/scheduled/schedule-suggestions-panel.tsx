"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSwrJson } from "@/hooks/use-swr-json";
import { Switch } from "@/components/ui/switch";
import {
  ChevronDown,
  ChevronRight,
  Sparkles,
  Plus,
  Check,
  X,
  Undo2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatAUD, formatDate, amountClass } from "@/lib/utils";
import { colourForFrequency, dimColour, freqLabel } from "@/lib/schedule-colours";
import { invalidateCashflow } from "@/lib/invalidate-cashflow";
import { toast } from "sonner";


interface Observation {
  id: string;
  date: string;
  amount: string;
  payee: string | null;
  categoryName: string | null;
}

interface Suggestion {
  key: string;
  accountId: string;
  accountName: string;
  accountColor: string;
  payee: string;
  normalizedPayee: string;
  amount: string;
  amountMin: string | null;
  isRange: boolean;
  frequency: string;
  interval: number;
  count: number;
  firstDate: string;
  lastDate: string;
  suggestedStartDate: string;
  categoryId: string | null;
  categoryName: string | null;
  alreadyScheduled: boolean;
  confidence: number;
  dismissed: boolean;
  type: "expense" | "income" | "transfer";
  transferToAccountId: string | null;
  transferToAccountName: string | null;
  transferToAccountColor: string | null;
  observations: Observation[];
}

export function ScheduleSuggestionsPanel({
  onAdded,
}: {
  onAdded?: () => void;
}) {
  const router = useRouter();
  const { data: suggestions = [], mutate, isLoading } = useSwrJson<Suggestion[]>(
    "/api/scheduled/suggestions",
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showCovered, setShowCovered] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const { actionable, covered, dismissed } = useMemo(() => {
    const actionable: Suggestion[] = [];
    const covered: Suggestion[] = [];
    const dismissed: Suggestion[] = [];
    for (const s of suggestions) {
      if (s.dismissed) dismissed.push(s);
      else if (s.alreadyScheduled) covered.push(s);
      else actionable.push(s);
    }
    return { actionable, covered, dismissed };
  }, [suggestions]);

  if (isLoading || suggestions.length === 0) return null;

  async function addSuggestion(s: Suggestion) {
    setBusy(s.key);
    // For monthly patterns, derive dayOfMonth from the median of observed
    // payment days. Without this, expandRecurrence falls back to addMonths
    // from the first date, which drifts on month boundaries (31st → 28th in
    // February) and produces phantom misses.
    let dayOfMonth: number | undefined;
    if (s.frequency === "monthly" && s.observations.length > 0) {
      const days = s.observations
        .map((o) => parseInt(o.date.slice(8, 10), 10))
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => a - b);
      if (days.length > 0) {
        dayOfMonth = days[Math.floor(days.length / 2)];
      }
    }
    const res = await fetch("/api/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: s.accountId,
        payee: s.payee,
        amount: s.amount,
        amountMin: s.amountMin ?? undefined,
        // Use the type detected by the suggestion engine (transfer when the
        // historical rows were paired transfers, otherwise expense/income).
        type: s.type,
        // Categories don't apply to transfers; the API rejects category for
        // transfer-type schedules.
        categoryId: s.type === "transfer" ? null : s.categoryId,
        transferToAccountId: s.type === "transfer" ? s.transferToAccountId : null,
        frequency: s.frequency,
        interval: s.interval,
        dayOfMonth,
        // Use the earliest observed occurrence as the schedule's start so
        // expandRecurrence walks the same dates the historical transactions
        // were on.
        startDate: s.firstDate,
      }),
    });
    setBusy(null);
    if (res.ok) {
      toast.success(`Scheduled "${s.payee}"`);
      mutate();
      // Refresh the page's server-rendered data so the new schedule shows
      // up in the list. The optional callback is invoked too so the parent
      // can do its own thing (kept for backwards compatibility).
      router.refresh();
      invalidateCashflow();
      onAdded?.();
    } else {
      toast.error("Failed to add schedule");
    }
  }

  async function dismissSuggestion(s: Suggestion) {
    setBusy(s.key);
    const res = await fetch("/api/scheduled/suggestions/dismissals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: s.accountId,
        normalizedPayee: s.normalizedPayee,
      }),
    });
    setBusy(null);
    if (res.ok) {
      toast.success("Suggestion dismissed");
      mutate();
    } else {
      toast.error("Failed to dismiss");
    }
  }

  async function restoreSuggestion(s: Suggestion) {
    setBusy(s.key);
    const params = new URLSearchParams({
      accountId: s.accountId,
      normalizedPayee: s.normalizedPayee,
    });
    const res = await fetch(`/api/scheduled/suggestions/dismissals?${params}`, {
      method: "DELETE",
    });
    setBusy(null);
    if (res.ok) {
      toast.success("Restored");
      mutate();
    } else {
      toast.error("Failed to restore");
    }
  }

  function toggleExpanded(key: string) {
    setExpandedKey((prev) => (prev === key ? null : key));
  }

  function renderObservations(s: Suggestion) {
    if (s.observations.length === 0) {
      return (
        <p className="text-xs text-muted-foreground py-2 px-3">
          No matching transactions on file.
        </p>
      );
    }
    return (
      <ul className="divide-y divide-indigo-500/10 bg-indigo-500/[0.03]">
        {s.observations.map((o) => {
          const amt = parseFloat(o.amount);
          return (
            <li key={o.id} className="flex items-center gap-2 px-9 py-1.5 text-xs">
              <span className="text-muted-foreground tabular-nums shrink-0 w-[68px]">
                {formatDate(o.date)}
              </span>
              <span className="truncate flex-1 min-w-0">
                {o.payee || "—"}
                {o.categoryName && (
                  <span className="text-muted-foreground"> · {o.categoryName}</span>
                )}
              </span>
              <span className={`shrink-0 font-medium tabular-nums ${amountClass(amt)}`}>
                {formatAUD(amt)}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  function renderRow(
    s: Suggestion,
    variant: "actionable" | "covered" | "dismissed",
  ) {
    const dim = variant !== "actionable";
    const isExpanded = expandedKey === s.key;
    return (
      <div key={s.key}>
        <div
          className={`group flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-indigo-500/5 ${
            dim ? "opacity-60" : ""
          } ${isExpanded ? "bg-indigo-500/5" : ""}`}
          onClick={() => toggleExpanded(s.key)}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-[68px]">
            {formatDate(s.suggestedStartDate)}
          </span>
          <span
            className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap shrink-0"
            style={{ backgroundColor: dimColour(s.accountColor) }}
          >
            {s.accountName}
          </span>
          {s.type === "transfer" && s.transferToAccountName && (
            <>
              <span className="text-muted-foreground shrink-0" aria-hidden="true">→</span>
              <span
                className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap shrink-0"
                style={{ backgroundColor: dimColour(s.transferToAccountColor ?? "#94a3b8") }}
              >
                {s.transferToAccountName}
              </span>
            </>
          )}
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-white text-[10px] font-medium whitespace-nowrap shrink-0"
            style={{ backgroundColor: dimColour(colourForFrequency(s.frequency)) }}
          >
            {freqLabel(s.frequency, s.interval)}
          </span>
          <span className="flex-1 min-w-0 flex items-center gap-2">
            <span
              className={`truncate min-w-0 ${variant === "dismissed" ? "line-through" : ""}`}
              title={s.payee}
            >
              {s.normalizedPayee || s.payee}
            </span>
            {s.categoryName && (
              <span className="text-xs text-muted-foreground shrink-0">· {s.categoryName}</span>
            )}
            <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
              {s.count} seen
            </span>
          </span>
          <span className={`shrink-0 font-medium tabular-nums ${amountClass(s.amount)}`}>
            {s.isRange && s.amountMin
              ? `${formatAUD(s.amountMin).replace("A$", "$")} – ${formatAUD(s.amount).replace("A$", "$")}`
              : formatAUD(s.amount)}
          </span>

          {variant === "covered" ? (
            <span
              className="shrink-0 inline-flex items-center gap-1 text-[11px] text-muted-foreground px-1.5 py-0.5"
              title="An active schedule already covers this pattern"
            >
              <Check className="h-3 w-3" />
              Scheduled
            </span>
          ) : variant === "dismissed" ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                restoreSuggestion(s);
              }}
              disabled={busy === s.key}
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-border hover:bg-muted disabled:opacity-50 transition-colors"
              title="Restore this suggestion"
            >
              <Undo2 className="h-3 w-3" />
              Restore
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  addSuggestion(s);
                }}
                disabled={busy === s.key}
                className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-indigo-500/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 disabled:opacity-50 transition-colors"
                title={`Create a ${freqLabel(s.frequency, s.interval)} schedule starting ${formatDate(s.firstDate)}`}
              >
                <Plus className="h-3 w-3" />
                {busy === s.key ? "Adding…" : "Add"}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  dismissSuggestion(s);
                }}
                disabled={busy === s.key}
                className="shrink-0 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                title="Dismiss this suggestion"
                aria-label="Dismiss suggestion"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
        {isExpanded && renderObservations(s)}
      </div>
    );
  }

  // Trigger button is the only thing that takes vertical space at rest. The
  // full list of detected patterns lives inside a dialog so a quiet day with
  // no actionable suggestions doesn't waste page height.
  const buttonLabel =
    actionable.length === 0
      ? "Detected patterns"
      : `${actionable.length} detected pattern${actionable.length === 1 ? "" : "s"}`;
  const buttonClass =
    actionable.length === 0
      ? "inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1 transition-colors"
      : "inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-400 border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 rounded-md px-2.5 py-1 transition-colors";

  return (
    <>
      <button type="button" onClick={() => setDialogOpen(true)} className={buttonClass}>
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        {buttonLabel}
      </button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-6xl sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>
              <span className="inline-flex items-center gap-2 text-indigo-700 dark:text-indigo-400">
                <Sparkles className="h-4 w-4" />
                Detected recurring patterns
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {actionable.length === 0
                ? "No new recurring patterns detected. The toggles below let you review patterns already covered by an existing schedule, or ones you previously dismissed."
                : `${actionable.length} suggested schedule${actionable.length === 1 ? "" : "s"} from your transaction history. Add the ones you want to track; dismiss the rest.`}
            </p>

            <div className="flex items-center gap-3 flex-wrap">
              {covered.length > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0">
                  <span>Show {covered.length} already scheduled</span>
                  <Switch
                    size="sm"
                    checked={showCovered}
                    onCheckedChange={(v) => setShowCovered(v)}
                    aria-label="Show already-scheduled suggestions"
                  />
                </label>
              )}
              {dismissed.length > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0">
                  <span>Show {dismissed.length} dismissed</span>
                  <Switch
                    size="sm"
                    checked={showDismissed}
                    onCheckedChange={(v) => setShowDismissed(v)}
                    aria-label="Show dismissed suggestions"
                  />
                </label>
              )}
            </div>

            <div className="divide-y divide-border rounded-md border max-h-[60vh] overflow-y-auto overflow-x-hidden">
              {actionable.length === 0 && !showCovered && !showDismissed && (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  Nothing to show. Toggle the switches above to see covered or dismissed patterns.
                </p>
              )}
              {actionable.map((s) => renderRow(s, "actionable"))}
              {showCovered && covered.map((s) => renderRow(s, "covered"))}
              {showDismissed && dismissed.map((s) => renderRow(s, "dismissed"))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
