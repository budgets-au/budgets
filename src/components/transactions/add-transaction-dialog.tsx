"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SearchableCombobox,
  type ComboboxItem,
} from "@/components/ui/searchable-combobox";
import { CategoryDropdown } from "@/components/categories/category-dropdown";

interface AccountLite {
  id: string;
  name: string;
  color?: string;
}

interface CategoryLite {
  id: string;
  name: string;
  parentId: string | null;
  type?: string;
}

export interface AddTransactionDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  accounts: AccountLite[];
  categories: CategoryLite[];
  /** Pre-select this account in the form when the dialog opens —
   *  matches the page's currently-filtered account so the operator
   *  isn't forced to re-pick the same one they just narrowed to. */
  defaultAccountId?: string | null;
  /** Fires after the POST succeeds. Use to revalidate the
   *  transactions list and any aggregate caches that depend on it. */
  onCreated?: () => void;
}

type TxType = "expense" | "income" | "transfer-out" | "transfer-in";

const TYPE_OPTIONS: { value: TxType; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer-out", label: "Transfer out" },
  { value: "transfer-in", label: "Transfer in" },
];

function todayISO(): string {
  // Use local-tz Y-M-D so the default lines up with what the user sees
  // on their calendar — UTC slicing would roll into yesterday at
  // ~10am Sydney time.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Manual transaction entry. Supports four types — Expense, Income,
 *  Transfer out, Transfer in — so the operator doesn't have to think
 *  about amount signs. Sign is derived from type; transfer types
 *  surface a counterparty-account picker that may be left empty, in
 *  which case the server mints a synthetic counterpart in the
 *  "External" account (mirroring the orphan-transfer backfill
 *  behaviour). Field layout is the 1/2/3-column responsive grid
 *  the Scheduled-edit form uses so plain Tab keystrokes walk the
 *  visible row in reading order. */
export function AddTransactionDialog({
  open,
  onOpenChange,
  accounts,
  categories,
  defaultAccountId,
  onCreated,
}: AddTransactionDialogProps) {
  const [accountId, setAccountId] = useState(defaultAccountId ?? "");
  const [date, setDate] = useState(todayISO());
  const [txType, setTxType] = useState<TxType>("expense");
  const [otherAccountId, setOtherAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Each time the dialog opens, reset the form. Keep `defaultAccountId`
  // sticky so re-opening after a filter change picks up the new
  // default; clear everything else so previous values don't bleed.
  useEffect(() => {
    if (!open) return;
    setAccountId(defaultAccountId ?? "");
    setDate(todayISO());
    setTxType("expense");
    setOtherAccountId("");
    setAmount("");
    setPayee("");
    setCategoryId(null);
    setNotes("");
  }, [open, defaultAccountId]);

  const isTransfer = txType === "transfer-out" || txType === "transfer-in";
  const otherAccountLabel =
    txType === "transfer-out" ? "To account" : "From account";

  const sortedAccounts = accounts
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const accountItems: ComboboxItem[] = sortedAccounts.map((a) => ({
    id: a.id,
    label: a.name,
  }));
  const otherAccountItems: ComboboxItem[] = sortedAccounts
    .filter((a) => a.id !== accountId)
    .map((a) => ({ id: a.id, label: a.name }));

  const amountNumeric = Number.parseFloat(amount);
  const canSubmit =
    !saving &&
    accountId !== "" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    amount.trim() !== "" &&
    Number.isFinite(amountNumeric) &&
    amountNumeric > 0 &&
    (!isTransfer || otherAccountId !== accountId);
  // Note: an empty `otherAccountId` is allowed on transfers — the
  // server mints a synthetic counterpart in External.

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const magnitude = Math.abs(amountNumeric).toFixed(2);
      // Compute the four primitives the server expects:
      //   bodyAccountId     = the SOURCE leg's account
      //   bodyTransferTo    = the DEST leg's account (if any)
      //   bodySynthetic     = mint a synthetic dest in External (if no
      //                       real destination)
      //   bodyAmount        = signed source-leg amount
      let bodyAccountId = accountId;
      let bodyTransferTo: string | null = null;
      let bodySyntheticTransfer = false;
      // Source-leg sign rule: outflows negative, inflows positive.
      // Expense + transfer-out + transfer-in-with-real-source all
      // drive a NEGATIVE source amount. Income + transfer-in-with-
      // synthetic-source drive POSITIVE.
      let bodyAmount = `-${magnitude}`;
      if (txType === "income") {
        bodyAmount = magnitude;
      } else if (txType === "transfer-out") {
        if (otherAccountId) bodyTransferTo = otherAccountId;
        else bodySyntheticTransfer = true;
      } else if (txType === "transfer-in") {
        // Money flowing FROM other TO picked. When the operator
        // supplied a real source, picked is the dest; when they left
        // it empty, the picked account is the SOURCE (inflow) and
        // the synthetic stub is the dest (outflow).
        if (otherAccountId) {
          bodyAccountId = otherAccountId;
          bodyTransferTo = accountId;
        } else {
          bodySyntheticTransfer = true;
          bodyAmount = magnitude;
        }
      }
      const body: Record<string, unknown> = {
        accountId: bodyAccountId,
        date,
        amount: bodyAmount,
      };
      if (payee.trim()) body.payee = payee.trim();
      if (notes.trim()) body.notes = notes.trim();
      if (categoryId) body.categoryId = categoryId;
      if (bodyTransferTo) body.transferToAccountId = bodyTransferTo;
      if (bodySyntheticTransfer) body.syntheticTransfer = true;
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `POST ${res.status}`);
      }
      toast.success(isTransfer ? "Transfer added" : "Transaction added");
      onOpenChange(false);
      onCreated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Add failed");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add transaction</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={handleKeyDown}>
          {/* Row 1: date / account / type (+ other account when
              transfer) — the "what is this and where does it sit"
              row. Cmd/Ctrl-Enter from any input submits. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <Field label="Date" required>
              <Input
                type="date"
                min="1900-01-01"
                max="2099-12-31"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-9"
              />
            </Field>
            <Field label="Account" required>
              <SearchableCombobox
                value={accountId}
                onChange={setAccountId}
                items={accountItems}
                searchPlaceholder="Search accounts…"
                emptyTriggerLabel="Choose account…"
                triggerClassName="h-9 w-full text-sm border rounded-md px-3 bg-background inline-flex items-center justify-between gap-2"
              />
            </Field>
            <Field label="Type" required>
              <select
                value={txType}
                onChange={(e) => setTxType(e.target.value as TxType)}
                className="h-9 w-full text-sm border rounded-md px-3 bg-background focus:outline-none focus:ring-1 focus:ring-ring/50"
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            {isTransfer && (
              <Field
                label={`${otherAccountLabel} (optional)`}
                hint={
                  otherAccountId
                    ? undefined
                    : "Empty → External (synthetic)"
                }
              >
                <SearchableCombobox
                  value={otherAccountId}
                  onChange={setOtherAccountId}
                  items={otherAccountItems}
                  pinnedItems={[
                    { id: "", label: "External (synthetic)", italic: true },
                  ]}
                  searchPlaceholder="Search accounts…"
                  emptyTriggerLabel="External (synthetic)"
                  triggerClassName="h-9 w-full text-sm border rounded-md px-3 bg-background inline-flex items-center justify-between gap-2"
                />
              </Field>
            )}
          </div>

          {/* Row 2: category / payee / amount — the "what is this
              for and how much" row. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <Field label="Category">
              <CategoryDropdown
                value={categoryId}
                onChange={setCategoryId}
                categories={categories}
                triggerClassName="h-9 w-full text-sm border rounded-md px-3 bg-background inline-flex items-center justify-between gap-2"
              />
            </Field>
            <Field label="Payee">
              <Input
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
                placeholder="e.g. Woolworths"
                className="h-9"
              />
            </Field>
            <Field
              label="Amount"
              required
              hint="Magnitude — sign is set by the type."
            >
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-9"
              />
            </Field>
          </div>

          {/* Row 3: notes — full width, multi-line. */}
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional"
              className="w-full text-sm border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-ring/50"
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="indigo"
            onClick={submit}
            disabled={!canSubmit}
          >
            {saving ? "Adding…" : "Add"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </span>
      {children}
      {hint && (
        <span className="text-[11px] text-muted-foreground/80">{hint}</span>
      )}
    </label>
  );
}
