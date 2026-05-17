"use client";

import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Check,
  Eraser,
  RefreshCw,
  X,
} from "lucide-react";
import { formatAUD, formatDate, amountClass } from "@/lib/utils";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm-dialog";

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
  const [rescanning, setRescanning] = useState(false);
  const [resetting, setResetting] = useState(false);
  const confirmDialog = useConfirm();

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

  async function rescan(e: React.MouseEvent) {
    // Stop the click bubbling to the panel's expand toggle.
    e.stopPropagation();
    if (rescanning) return;
    setRescanning(true);
    const res = await fetch("/api/transfers/repair", { method: "POST" });
    setRescanning(false);
    if (!res.ok) {
      toast.error("Re-scan failed");
      return;
    }
    const body = (await res.json().catch(() => ({}))) as {
      paired?: number;
      suggested?: number;
    };
    const paired = body.paired ?? 0;
    const suggested = body.suggested ?? 0;
    if (paired === 0 && suggested === 0) {
      toast.success("Re-scan complete — no new matches");
    } else {
      const pieces: string[] = [];
      if (paired > 0) pieces.push(`${paired} auto-paired`);
      if (suggested > 0) pieces.push(`${suggested} suggestion${suggested === 1 ? "" : "s"}`);
      toast.success(`Re-scan: ${pieces.join(" · ")}`);
    }
    // Refresh the suggestion list AND any transactions view that's
    // showing paired rows so the new links surface immediately.
    mutate();
    void globalMutate(
      (k) => typeof k === "string" && k.startsWith("/api/transactions"),
      undefined,
      { revalidate: true },
    );
    onChanged?.();
  }

  /** Destructive maintenance: delete every synthetic placeholder, then
   *  re-run the auto-pairing matcher. Useful when the orphan-transfer
   *  backfill minted synthetics in the External account but the real
   *  counterparts actually live in tracked accounts (e.g. after
   *  restoring a DB whose pair_ids had been cleared via partial
   *  deletes). Pairs that CAN be re-formed against tracked data WILL
   *  be; the rest stay as un-paired orphans. */
  async function resetAndRescan(e: React.MouseEvent) {
    e.stopPropagation();
    if (resetting) return;
    const ok = await confirmDialog({
      title: "Delete synthetic placeholders & re-scan?",
      description:
        "Every transfer placeholder the app auto-minted in External (or another untracked-counterparty account) will be deleted. " +
        "The matcher then re-pairs surviving rows against real tracked counterparts where possible. " +
        "Manually-linked external pairs are also removed — re-create them via the row's Link icon if needed.",
      confirmLabel: "Reset & re-scan",
    });
    if (!ok) return;
    setResetting(true);
    const res = await fetch("/api/transfers/reset-and-rescan", {
      method: "POST",
    });
    setResetting(false);
    if (!res.ok) {
      toast.error("Reset failed");
      return;
    }
    const body = (await res.json().catch(() => ({}))) as {
      syntheticsDeleted?: number;
      paired?: number;
      suggested?: number;
    };
    const parts: string[] = [];
    parts.push(`${body.syntheticsDeleted ?? 0} placeholder${(body.syntheticsDeleted ?? 0) === 1 ? "" : "s"} deleted`);
    if ((body.paired ?? 0) > 0) parts.push(`${body.paired} auto-paired`);
    if ((body.suggested ?? 0) > 0) {
      parts.push(`${body.suggested} suggestion${body.suggested === 1 ? "" : "s"}`);
    }
    toast.success(parts.join(" · "));
    mutate();
    void globalMutate(
      (k) => typeof k === "string" && k.startsWith("/api/transactions"),
      undefined,
      { revalidate: true },
    );
    void globalMutate("/api/accounts", undefined, { revalidate: true });
    onChanged?.();
  }

  const Chevron = expanded ? ChevronDown : ChevronRight;
  const hasSuggestions = suggestions.length > 0;

  // The "Re-scan transfers" button is always available so the user
  // can retroactively match transfers from imports that pre-date the
  // auto-match-on-commit behaviour (or whenever they want a sweep).
  // When suggestions are zero the panel collapses to a single quiet
  // row containing just the button; it doesn't crowd the page.
  return (
    <div
      className={`rounded-lg border mb-3 ${
        hasSuggestions
          ? "bg-amber-500/5 dark:bg-amber-500/10"
          : "bg-muted/20"
      }`}
    >
      <div
        className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${
          hasSuggestions ? "cursor-pointer" : ""
        }`}
        onClick={() => hasSuggestions && setExpanded((v) => !v)}
      >
        {hasSuggestions ? (
          <>
            <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" />
            <ArrowLeftRight className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="font-medium">
              {suggestions.length} possible transfer
              {suggestions.length === 1 ? "" : "s"} found
            </span>
            <span className="text-xs text-muted-foreground">
              — review to link
            </span>
          </>
        ) : (
          <>
            <ArrowLeftRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              No transfer matches pending.
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={resetAndRescan}
            disabled={resetting || rescanning}
            className="inline-flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400 hover:text-rose-500 dark:hover:text-rose-300 px-2 py-1 rounded hover:bg-muted disabled:opacity-50 transition-colors"
            title="Delete every auto-minted synthetic placeholder, then re-run the transfer matcher. Useful when the backfill paired transfers with External-account stubs but the real counterparts exist in tracked accounts."
          >
            <Eraser className="h-3 w-3" />
            {resetting ? "Resetting…" : "Reset & re-scan"}
          </button>
          <button
            type="button"
            onClick={rescan}
            disabled={rescanning || resetting}
            className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 px-2 py-1 rounded hover:bg-muted disabled:opacity-50 transition-colors"
            title="Run the transfer matcher across every unpaired transaction"
          >
            <RefreshCw
              className={`h-3 w-3 ${rescanning ? "animate-spin" : ""}`}
            />
            {rescanning ? "Scanning…" : "Re-scan transfers"}
          </button>
        </div>
      </div>

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
