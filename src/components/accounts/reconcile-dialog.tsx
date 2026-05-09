"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatAUD, amountClass } from "@/lib/utils";

interface MismatchResult {
  matched: false;
  expected: string;
  stated: string;
  diff: string;
}

export function ReconcileDialog({
  accountId,
  open,
  onOpenChange,
}: {
  accountId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [balance, setBalance] = useState("");
  const [mismatch, setMismatch] = useState<MismatchResult | null>(null);

  function reset() {
    setBalance("");
    setMismatch(null);
    setDate(new Date().toISOString().slice(0, 10));
  }

  async function handleReconcile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMismatch(null);

    const res = await fetch(`/api/accounts/${accountId}/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, balance }),
    });

    setLoading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Reconcile failed");
      return;
    }

    const data = await res.json();
    if (data.matched) {
      toast.success(
        data.reconciled === 0
          ? "Already reconciled — balance still matches"
          : `Reconciled ${data.reconciled} transaction${data.reconciled === 1 ? "" : "s"}`,
      );
      onOpenChange(false);
      reset();
      router.refresh();
    } else {
      setMismatch(data);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reconcile account</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleReconcile} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Enter the date and ending balance from your bank statement. If our running
            balance up to that date matches, every transaction on or before it will be
            marked reconciled.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="reconcile-date">Statement date</Label>
              <Input
                id="reconcile-date"
                type="date" min="1900-01-01" max="2099-12-31"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reconcile-balance">Ending balance</Label>
              <Input
                id="reconcile-balance"
                type="number"
                step="0.01"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                required
              />
            </div>
          </div>

          {mismatch && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 text-xs space-y-1">
              <p className="font-medium text-amber-800 dark:text-amber-200">
                Balances don&apos;t match — nothing was reconciled.
              </p>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
                <span className="text-muted-foreground">Bank says:</span>
                <span className={amountClass(mismatch.stated)}>{formatAUD(mismatch.stated)}</span>
                <span className="text-muted-foreground">App computes:</span>
                <span className={amountClass(mismatch.expected)}>{formatAUD(mismatch.expected)}</span>
                <span className="text-muted-foreground">Difference:</span>
                <span className={`font-semibold ${amountClass(mismatch.diff)}`}>
                  {parseFloat(mismatch.diff) > 0 ? "+" : ""}
                  {formatAUD(mismatch.diff)}
                </span>
              </div>
              <p className="text-muted-foreground pt-1">
                A negative diff means the app is over-counting (extra or wrong-amount
                txn). Positive means a transaction is missing.
              </p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="submit" size="sm" disabled={loading || !balance}>
              {loading ? "Checking…" : "Reconcile"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
