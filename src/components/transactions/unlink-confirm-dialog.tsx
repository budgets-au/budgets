"use client";

import { useState } from "react";
import { TransactionCellDialog } from "@/components/reports/transaction-cell-dialog";

export interface UnlinkConfirmDialogProps {
  /** When non-null the dialog opens with both transactions listed.
   *  Null = closed. */
  candidate: { txnId: string; pairTxnId: string } | null;
  onClose: () => void;
  /** Fired after the user confirms; the parent runs the actual PATCH
   *  + cache mutation. The dialog stays open while the parent's
   *  promise resolves so a slow network still feels responsive. */
  onConfirm: (txnId: string) => Promise<void> | void;
}

/** Two-row confirmation dialog for breaking a transfer pair. Reuses
 *  the same `TransactionCellDialog` the report drill-throughs render,
 *  filtered to the exact pair via the `ids=` query param on
 *  /api/transactions. Footer surfaces a destructive "Remove link"
 *  button alongside the standard layout. */
export function UnlinkConfirmDialog({
  candidate,
  onClose,
  onConfirm,
}: UnlinkConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const open = candidate !== null;
  const apiUrl = candidate
    ? `/api/transactions?ids=${candidate.txnId},${candidate.pairTxnId}&limit=2&sort=date&order=desc`
    : null;

  async function handleConfirm() {
    if (!candidate || busy) return;
    setBusy(true);
    try {
      await onConfirm(candidate.txnId);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <TransactionCellDialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      apiUrl={apiUrl}
      title="Unlink transfer?"
      subtitle="These two transactions will no longer be paired"
      extraFooter={
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy}
          className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-md bg-rose-600 text-white hover:bg-rose-700 transition-colors disabled:opacity-60"
        >
          {busy ? "Removing…" : "Remove link"}
        </button>
      }
    />
  );
}
