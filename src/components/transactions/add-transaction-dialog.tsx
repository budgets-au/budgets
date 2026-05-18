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
import { buildCategoryMeta } from "@/lib/category-path";

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

/** Manual transaction entry — for users who don't have an OFX/CSV
 *  feed for a given account (cash, small side accounts, corrections).
 *  POSTs to `/api/transactions`, which mints normalised payee tokens
 *  and refreshes the account's running balance. */
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
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [description, setDescription] = useState("");
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
    setAmount("");
    setPayee("");
    setDescription("");
    setCategoryId(null);
    setNotes("");
  }, [open, defaultAccountId]);

  const { meta: catMeta } = buildCategoryMeta(categories);
  const accountItems: ComboboxItem[] = accounts
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => ({ id: a.id, label: a.name }));

  const canSubmit =
    !saving &&
    accountId !== "" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    amount.trim() !== "" &&
    !Number.isNaN(parseFloat(amount));

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        accountId,
        date,
        amount: amount.trim(),
      };
      if (payee.trim()) body.payee = payee.trim();
      if (description.trim()) body.description = description.trim();
      if (notes.trim()) body.notes = notes.trim();
      if (categoryId) body.categoryId = categoryId;
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `POST ${res.status}`);
      }
      toast.success("Transaction added");
      onOpenChange(false);
      onCreated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Add failed");
    } finally {
      setSaving(false);
    }
  }

  // catMeta is used implicitly via CategoryDropdown's own meta build;
  // we keep the reference live so future refactors that need the
  // breadcrumb path here have it on hand.
  void catMeta;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add transaction</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 text-sm">
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" required>
              <Input
                type="date"
                min="1900-01-01"
                max="2099-12-31"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Amount" required>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="-12.34"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          </div>
          <p className="text-[11px] text-muted-foreground -mt-2">
            Negative for outflows, positive for inflows.
          </p>
          <Field label="Payee">
            <Input
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="e.g. Woolworths"
            />
          </Field>
          <Field label="Category">
            <CategoryDropdown
              value={categoryId}
              onChange={setCategoryId}
              categories={categories}
              triggerClassName="h-9 w-full text-sm border rounded-md px-3 bg-background inline-flex items-center justify-between gap-2"
            />
          </Field>
          <Field label="Description">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </Field>
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
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
