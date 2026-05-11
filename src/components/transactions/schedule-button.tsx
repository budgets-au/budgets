"use client";

import { useState } from "react";
import { Repeat } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function ScheduleButton({ transaction, accounts, categoriesProp, scheduledMatch }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const isExpense = parseFloat(transaction.amount) < 0;

  // Prefer the parent-supplied list (already loaded for the table) so the
  // transfer/payment heuristic resolves synchronously on first render.
  const { data: fetchedCategories = [] } = useSWR<Category[]>(
    open && !categoriesProp ? "/api/categories" : null,
    fetcher,
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

  const parents = categories
    .filter((c) => !c.parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const childrenByParent = new Map<string, Category[]>();
  for (const c of categories) {
    if (c.parentId) {
      const arr = childrenByParent.get(c.parentId) ?? [];
      arr.push(c);
      childrenByParent.set(c.parentId, arr);
    }
  }
  // Full path label for the selected category
  const categoryLabel = (() => {
    if (!categoryId) return undefined;
    const byId = new Map(categories.map((c) => [c.id, c]));
    function getPath(id: string, visited = new Set<string>()): string[] {
      if (visited.has(id)) return [];
      visited.add(id);
      const cat = byId.get(id);
      if (!cat) return [];
      if (!cat.parentId) return [cat.name];
      return [...getPath(cat.parentId, visited), cat.name];
    }
    return getPath(categoryId).join(" / ") || undefined;
  })();

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
        className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-violet-600 transition-all p-0.5 rounded"
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
              <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue>{categoryLabel ?? "Uncategorised"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Uncategorised</SelectItem>
                  {parents.map((parent) => {
                    const depth1 = childrenByParent.get(parent.id) ?? [];
                    if (depth1.length === 0) {
                      return (
                        <SelectItem key={parent.id} value={parent.id}>
                          {parent.name}
                        </SelectItem>
                      );
                    }
                    return (
                      <SelectGroup key={parent.id}>
                        <SelectItem value={parent.id}>{parent.name}</SelectItem>
                        {depth1.flatMap((child) => {
                          const depth2 = childrenByParent.get(child.id) ?? [];
                          return [
                            <SelectItem key={child.id} value={child.id} className="pl-5">
                              {child.name}
                            </SelectItem>,
                            ...depth2.map((gc) => (
                              <SelectItem key={gc.id} value={gc.id} className="pl-9">
                                {gc.name}
                              </SelectItem>
                            )),
                          ];
                        })}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
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
