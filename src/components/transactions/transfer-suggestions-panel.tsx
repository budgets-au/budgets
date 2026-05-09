"use client";

import { useState } from "react";
import useSWR from "swr";
import { ArrowLeftRight, ChevronDown, ChevronRight, Check, X } from "lucide-react";
import { formatAUD, formatDate, amountClass } from "@/lib/utils";
import { toast } from "sonner";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Suggestion {
  id: string;
  score: number;
  aId: string;
  aDate: string;
  aAmount: string;
  aPayee: string | null;
  aAccountName: string;
  aAccountColor: string;
  bId: string;
  bDate: string;
  bAmount: string;
  bPayee: string | null;
  bAccountName: string;
  bAccountColor: string;
}

export function TransferSuggestionsPanel({ onChanged }: { onChanged?: () => void }) {
  const { data: suggestions = [], mutate } = useSWR<Suggestion[]>(
    "/api/transfers/suggestions",
    fetcher,
  );
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (suggestions.length === 0) return null;

  async function confirm(id: string) {
    setBusy(id);
    const res = await fetch(`/api/transfers/suggestions/${id}/confirm`, { method: "POST" });
    setBusy(null);
    if (res.ok) {
      toast.success("Transfer linked");
      mutate();
      onChanged?.();
    } else {
      toast.error("Failed to link");
    }
  }

  async function dismiss(id: string) {
    setBusy(id);
    const res = await fetch(`/api/transfers/suggestions/${id}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) {
      mutate();
    } else {
      toast.error("Failed to dismiss");
    }
  }

  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="rounded-lg border bg-amber-500/5 dark:bg-amber-500/10 mb-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm"
      >
        <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" />
        <ArrowLeftRight className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="font-medium">
          {suggestions.length} possible transfer{suggestions.length === 1 ? "" : "s"} found
        </span>
        <span className="text-xs text-muted-foreground">
          — review to link
        </span>
      </button>

      {expanded && (
        <div className="border-t divide-y">
          {suggestions.map((s) => (
            <div key={s.id} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2 px-3 py-2 text-xs">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span
                    className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap"
                    style={{ backgroundColor: s.aAccountColor }}
                  >
                    {s.aAccountName}
                  </span>
                  <span className="text-muted-foreground">{formatDate(s.aDate)}</span>
                  <span className={`font-semibold tabular-nums ${amountClass(s.aAmount)}`}>
                    {formatAUD(s.aAmount)}
                  </span>
                </div>
                <span className="block truncate text-muted-foreground">{s.aPayee || "—"}</span>
              </div>

              <ArrowLeftRight className="h-4 w-4 text-muted-foreground shrink-0" />

              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span
                    className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap"
                    style={{ backgroundColor: s.bAccountColor }}
                  >
                    {s.bAccountName}
                  </span>
                  <span className="text-muted-foreground">{formatDate(s.bDate)}</span>
                  <span className={`font-semibold tabular-nums ${amountClass(s.bAmount)}`}>
                    {formatAUD(s.bAmount)}
                  </span>
                </div>
                <span className="block truncate text-muted-foreground">{s.bPayee || "—"}</span>
              </div>

              <div className="flex gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => confirm(s.id)}
                  disabled={busy === s.id}
                  className="p-1.5 rounded-md border text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50"
                  title="Link these"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(s.id)}
                  disabled={busy === s.id}
                  className="p-1.5 rounded-md border text-muted-foreground hover:bg-muted disabled:opacity-50"
                  title="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
