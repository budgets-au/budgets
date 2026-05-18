"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import {
  clearPendingUndoImport,
  readPendingUndoImport,
  UNDO_IMPORT_TTL_MS,
  type PendingUndoImport,
} from "@/lib/import-undo";

/** Pair of buttons that surface a just-finished import's
 * importLogIds for one-click rollback. Mounts in the /transactions
 * topbar (next to the Import button) when the import-view has
 * stashed a pending undo via sessionStorage. Empty render when
 * there's nothing pending — costs the topbar zero pixels on a
 * normal nav.
 *
 * Two affordances:
 *   - Undo (delete N) — confirms, hits /api/import/undo-commit,
 *     then router.refresh() so the transactions list re-fetches.
 *   - × (dismiss) — clears the pending entry without doing
 *     anything. For when the operator's happy with the import and
 *     wants the chrome out of the way. */
export function UndoLastImportButton() {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, setPending] = useState<PendingUndoImport | null>(null);
  const [undoing, setUndoing] = useState(false);

  // sessionStorage read goes into an effect rather than the
  // useState initialiser to avoid SSR/client hydration mismatch
  // (the server can't see sessionStorage; the first render must
  // match what the server emitted). Matches the
  // feedback_hydration_localstorage.md convention.
  //
  // Once we've found a pending entry, schedule the auto-dismiss
  // for the remaining time on its UNDO_IMPORT_TTL_MS window — the
  // entry vanishes silently from the topbar instead of camping
  // there until the next page nav.
  useEffect(() => {
    const found = readPendingUndoImport();
    setPending(found);
    if (!found) return;
    const remaining =
      found.committedAt + UNDO_IMPORT_TTL_MS - Date.now();
    if (remaining <= 0) {
      clearPendingUndoImport();
      setPending(null);
      return;
    }
    const t = setTimeout(() => {
      clearPendingUndoImport();
      setPending(null);
    }, remaining);
    return () => clearTimeout(t);
  }, []);

  if (!pending) return null;

  async function handleUndo() {
    if (!pending) return;
    const ok = await confirm({
      title: "Undo last import",
      description: `Delete ${pending.imported} just-inserted transaction${pending.imported === 1 ? "" : "s"}? This won't reverse any type / balance backfills on rows that were already in the DB.`,
      confirmLabel: "Undo import",
    });
    if (!ok) return;
    setUndoing(true);
    try {
      const res = await fetch("/api/import/undo-commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importLogIds: pending.importLogIds }),
      });
      if (!res.ok) {
        const { error } = await res
          .json()
          .catch(() => ({ error: "Undo failed" }));
        toast.error(error ?? "Undo failed");
        return;
      }
      const result = await res.json();
      toast.success(
        `Deleted ${result.deletedTransactions} transaction${result.deletedTransactions === 1 ? "" : "s"}.`,
      );
      clearPendingUndoImport();
      setPending(null);
      router.refresh();
    } finally {
      setUndoing(false);
    }
  }

  function dismiss() {
    clearPendingUndoImport();
    setPending(null);
  }

  return (
    <div className="inline-flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleUndo}
        disabled={undoing}
        className="border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400"
      >
        <Undo2 className="h-3.5 w-3.5 mr-1" />
        {undoing
          ? "Undoing…"
          : `Undo import (${pending.imported})`}
      </Button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss undo"
        title="Dismiss"
        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
