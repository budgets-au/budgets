"use client";

import { useState } from "react";
import { Repeat } from "lucide-react";
import Link from "next/link";
import { useSwrJson } from "@/hooks/use-swr-json";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { CategoryDropdown } from "@/components/categories/category-dropdown";
import type { Account, Category } from "@/db/schema";
import { colourForFrequency, freqLabel } from "@/lib/schedule-colours";

interface Props {
  transaction: {
    payee: string | null;
    amount: string;
    categoryId: string | null;
    accountId: string;
    date: string; // YYYY-MM-DD
    transferPairId?: string | null;
    pairAccountId?: string | null;
  };
  /** All non-archived accounts, for the destination picker on transfers. */
  accounts: { id: string; name: string }[];
  /**
   * Full category list for the source-row category lookup AND the picker.
   * Optional — if omitted we fall back to fetching once the dialog opens.
   */
  categoriesProp?: Category[];
  scheduledMatch?: {
    id: string;
    frequency: string;
    interval: number;
  };
}


export function ScheduleButton({ transaction, accounts, categoriesProp, scheduledMatch }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const isExpense = parseFloat(transaction.amount) < 0;

  // Prefer the parent-supplied list (already loaded for the table) so the
  // transfer/payment heuristic resolves synchronously on first render.
  const { data: fetchedCategories = [] } = useSwrJson<Category[]>(
    open && !categoriesProp ? "/api/categories" : null,
  );
  const categories = categoriesProp ?? fetchedCategories;

  // A row is "transfer-like" when it's already linked to a counterpart, OR
  // its category has any non-'none' transferKind (inner move OR external
  // loan/credit payment). Default the form to type=transfer in that case
  // so the destination account can be pre-filled (from the existing pair)
  // and the category picker is hidden.
  const sourceCategory = categories.find((c) => c.id === transaction.categoryId);
  const looksLikeTransfer =
    !!transaction.transferPairId ||
    (!!sourceCategory && sourceCategory.transferKind !== "none");

  const [type, setType] = useState<"income" | "expense" | "transfer">(
    looksLikeTransfer ? "transfer" : isExpense ? "expense" : "income"
  );
  const [frequency, setFrequency] = useState("monthly");
  const [categoryId, setCategoryId] = useState(transaction.categoryId ?? "");
  const [transferToAccountId, setTransferToAccountId] = useState(transaction.pairAccountId ?? "");

  const absAmount = Math.abs(parseFloat(transaction.amount)).toFixed(2);
  const dayOfMonth = parseInt(transaction.date.split("-")[2], 10);

  // Category tree shaping, search and label resolution all live in the
  // shared CategoryDropdown — nothing to precompute here.

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const amountRaw = parseFloat(String(form.get("amount") ?? absAmount));

    const res = await fetch("/api/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: transaction.accountId,
        payee: String(form.get("payee") || "").trim() || undefined,
        // Transfers leave the source account, so store as negative just like
        // expenses do (so amount sign matches what shows up on the source side).
        amount:
          (type === "expense" || type === "transfer")
            ? `-${Math.abs(amountRaw).toFixed(2)}`
            : Math.abs(amountRaw).toFixed(2),
        type,
        // Categories don't apply to transfers; destination account does.
        categoryId: type === "transfer" ? null : (categoryId || null),
        transferToAccountId: type === "transfer" ? (transferToAccountId || null) : null,
        frequency,
        interval: parseInt(String(form.get("interval") ?? "1")) || 1,
        startDate: String(form.get("startDate")),
        endDate: null,
        dayOfMonth:
          frequency === "monthly"
            ? parseInt(String(form.get("dayOfMonth") ?? String(dayOfMonth))) || null
            : null,
      }),
    });

    setLoading(false);
    if (res.ok) {
      toast.success("Scheduled transaction created");
      setOpen(false);
    } else {
      toast.error("Failed to create scheduled transaction");
    }
  }

  // If already matched to a scheduled entry, show a pill link only.
  // Matches the account-badge styling: solid background, white text, square
  // corners. Colour is deterministic per scheduled-transaction id so each
  // schedule has its own visually-distinct chip.
  if (scheduledMatch) {
    return (
      <Link
        href={`/scheduled/${scheduledMatch.id}`}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-white text-[10px] font-medium whitespace-nowrap hover:opacity-80 transition-opacity shrink-0"
        style={{ backgroundColor: colourForFrequency(scheduledMatch.frequency) }}
        onClick={(e) => e.stopPropagation()}
      >
        <Repeat className="h-2.5 w-2.5" />
        {freqLabel(scheduledMatch.frequency, scheduledMatch.interval)}
      </Link>
    );
  }

  // Otherwise show a create button (visible on row hover)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 lg:opacity-0 lg:group-hover:opacity-100 text-muted-foreground hover:text-violet-600 transition-all p-0.5 rounded"
        title="Create scheduled transaction"
      >
        <Repeat className="h-3.5 w-3.5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Schedule This Transaction</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3 mt-1">
          <div className="space-y-1">
            <Label htmlFor="s-payee">Payee</Label>
            <Input id="s-payee" name="payee" defaultValue={transaction.payee ?? ""} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType((v ?? "expense") as typeof type)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="transfer">Transfer / Payment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="s-amount">Amount (AUD)</Label>
              <Input
                id="s-amount"
                name="amount"
                type="number"
                step="0.01"
                min="0"
                defaultValue={absAmount}
                required
              />
            </div>
          </div>

          {type === "transfer" ? (
            <div className="space-y-1">
              <Label>To account</Label>
              <Select
                value={transferToAccountId}
                onValueChange={(v) => setTransferToAccountId(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select destination account">
                    {accounts.find((a) => a.id === transferToAccountId)?.name ?? "Select destination account"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    .filter((a) => a.id !== transaction.accountId)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1">
              <Label>Category</Label>
              <CategoryDropdown
                value={categoryId || null}
                onChange={(v) => setCategoryId(v ?? "")}
                categories={categories}
                typeFilter={isExpense ? "expense" : "income"}
                popoverClassName="w-[var(--anchor-width)] p-0 gap-0 overflow-hidden min-w-72"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Frequency</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v ?? "monthly")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="fortnightly">Fortnightly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="s-startDate">Start date</Label>
              <Input
                id="s-startDate"
                name="startDate"
                type="date" min="1900-01-01" max="2099-12-31"
                defaultValue={transaction.date}
                required
              />
            </div>
          </div>

          {frequency === "monthly" && (
            <div className="space-y-1">
              <Label htmlFor="s-dom">Day of month</Label>
              <Input
                id="s-dom"
                name="dayOfMonth"
                type="number"
                min="1"
                max="31"
                defaultValue={dayOfMonth}
              />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              type="submit"
              disabled={loading || (type === "transfer" && !transferToAccountId)}
              className="flex-1"
            >
              {loading ? "Creating…" : "Create Scheduled"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
      </Dialog>
    </>
  );
}
