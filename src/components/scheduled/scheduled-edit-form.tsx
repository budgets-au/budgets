"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalendarClock, PiggyBank, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CategoryDropdown } from "@/components/categories/category-dropdown";
import type { Account, Category } from "@/db/schema";

export interface ScheduledFormRow {
  id: string;
  /** "schedule" | "budget" — left as string to absorb the loose drizzle
   * row type without casting; the form normalises it back to the union. */
  kind: string;
  payee: string | null;
  description: string | null;
  amount: string;
  amountMin: string | null;
  type: string;
  frequency: string;
  interval: number | null;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  dayOfMonth: number | null;
  accountId: string | null;
  categoryId: string | null;
  transferToAccountId: string | null;
}

export function ScheduledEditForm({
  row,
  allAccounts,
  allCategories,
  onSaved,
  onDelete,
  canReplace = true,
  latestMatchDate = null,
  onAddToGroup,
  addingToGroup = false,
  mode = "edit",
}: {
  row: ScheduledFormRow;
  allAccounts: Pick<Account, "id" | "name">[];
  allCategories: Pick<Category, "id" | "name" | "parentId">[];
  onSaved: () => void;
  onDelete?: () => void;
  /** When "create", submit POSTs a new schedule and the edit-only controls
   * (Replace, Add to group, Active toggle, Delete) are hidden. */
  mode?: "create" | "edit";
  /** Hide the "Replace with new amount…" button when false. Set by the list
   * view for predecessors so a replace can only originate from the latest
   * active member of a lineage. Defaults to true so the standalone detail
   * page (no lineage context) keeps its current behaviour. */
  canReplace?: boolean;
  /** Date of the most-recent matched real transaction for this schedule.
   * Used to default the Replace dialog's "Effective from" — typically the
   * date the new amount actually started showing up — instead of today. */
  latestMatchDate?: string | null;
  /** When provided, renders a "+ Add another to this group" button inline in
   * the form's action row. Omitted on the standalone detail page where group
   * context isn't available. */
  onAddToGroup?: () => void;
  /** Pending state for the inline add-to-group button. */
  addingToGroup?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<"schedule" | "budget">(
    row.kind === "budget" ? "budget" : "schedule",
  );
  const isBudget = kind === "budget";
  const [accountId, setAccountId] = useState(row.accountId ?? "");
  const [type, setType] = useState<"income" | "expense" | "transfer">(row.type as "income" | "expense" | "transfer");
  const [frequency, setFrequency] = useState(row.frequency);
  const [categoryId, setCategoryId] = useState(row.categoryId ?? "");
  const [transferToAccountId, setTransferToAccountId] = useState(row.transferToAccountId ?? "");
  const [isActive, setIsActive] = useState(row.isActive);

  // Controlled values for the previously-uncontrolled inputs. Base UI's Input
  // warns if a `defaultValue` changes after mount, which happens when the
  // parent re-renders the form with a refreshed row after save.
  const [amount, setAmount] = useState(Math.abs(parseFloat(row.amount)).toFixed(2));
  const [useRange, setUseRange] = useState(row.amountMin != null);
  const [amountMin, setAmountMin] = useState(
    row.amountMin != null ? Math.abs(parseFloat(row.amountMin)).toFixed(2) : "",
  );
  const [payee, setPayee] = useState(row.payee ?? "");
  const [interval, setInterval] = useState(String(row.interval ?? 1));
  const [startDate, setStartDate] = useState(row.startDate);
  const [endDate, setEndDate] = useState(row.endDate ?? "");
  const [dayOfMonth, setDayOfMonth] = useState(row.dayOfMonth ? String(row.dayOfMonth) : "");

  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceAmount, setReplaceAmount] = useState(Math.abs(parseFloat(row.amount)).toFixed(2));
  const [replaceDate, setReplaceDate] = useState(
    latestMatchDate ?? new Date().toISOString().slice(0, 10),
  );
  const [replacePayee, setReplacePayee] = useState("");
  const [replacing, setReplacing] = useState(false);

  async function handleReplace() {
    if (!replaceAmount.trim() || !replaceDate) return;
    setReplacing(true);
    const res = await fetch(`/api/scheduled/${row.id}/replace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newAmount: replaceAmount,
        effectiveDate: replaceDate,
        payee: replacePayee.trim() || undefined,
      }),
    });
    setReplacing(false);
    if (res.ok) {
      toast.success("Created new schedule for the new amount");
      setReplaceOpen(false);
      setReplacePayee("");
      onSaved();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Replace failed");
    }
  }

  // The CategoryDropdown handles label resolution + tree shaping
  // itself, so no need to pre-compute path / sibling groupings here.

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    // Budget rows are spending caps so the amount stays negative regardless
    // of the (hidden) type field; matcher-only fields are sent null and the
    // server normalises further as a defence-in-depth.
    const effectiveType = isBudget ? "expense" : type;
    const payload = {
      kind,
      accountId: accountId || null,
      payee: payee || undefined,
      amount: (effectiveType === "expense" || effectiveType === "transfer")
        ? `-${Math.abs(parseFloat(amount || "0")).toFixed(2)}`
        : parseFloat(amount || "0").toFixed(2),
      amountMin: !isBudget && useRange && amountMin.trim() !== ""
        ? Math.abs(parseFloat(amountMin)).toFixed(2)
        : null,
      type: effectiveType,
      // A transfer-type schedule may carry a category — e.g. a payment to a
      // loan/credit account tagged with an `external` transferKind category
      // so the cashflow Plan column attributes the projection to it.
      categoryId: categoryId || null,
      transferToAccountId: !isBudget && effectiveType === "transfer" ? (transferToAccountId || null) : null,
      frequency,
      interval: isBudget ? 1 : parseInt(interval || "1"),
      startDate,
      endDate: endDate || null,
      dayOfMonth: !isBudget && dayOfMonth ? parseInt(dayOfMonth) : null,
      isActive,
    };

    const res = mode === "create"
      ? await fetch("/api/scheduled", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch(`/api/scheduled/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    setLoading(false);
    if (res.ok) {
      toast.success(mode === "create" ? "Created" : "Saved");
      onSaved();
    } else {
      toast.error(mode === "create" ? "Failed to create" : "Failed to save");
    }
  }

  // Single density: dense layout with h-7 inputs and small labels. The form
  // sits inside a half-width column, so every pixel saved means another field
  // fits on one line (especially on Mac/Safari where text renders wider).
  const fieldGroupSpacing = "space-y-0.5";
  const inputCls = "h-7 text-[11px] bg-background px-2 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
  const triggerCls = "h-7 text-[11px] bg-background py-1 pl-2 pr-1.5";
  // !block overrides Label's default `flex` so `truncate` actually clips when
  // the parent cell is narrow — otherwise the label overflows and overlaps the
  // next field on Mac/Safari.
  const labelCls = "text-[10px] !block truncate leading-tight";

  return (
    <form onSubmit={handleSave} className="space-y-2">
      <div className="flex items-center gap-1 text-[11px]">
        {([
          { k: "schedule" as const, Icon: CalendarClock, label: "Schedule" },
          { k: "budget" as const, Icon: PiggyBank, label: "Budget" },
        ]).map(({ k, Icon, label }) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            title={label}
            aria-label={label}
            aria-pressed={kind === k}
            className={`p-1.5 rounded border transition-colors ${
              kind === k
                ? "bg-indigo-600 border-indigo-600 text-white"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
        <span className="ml-2 text-[10px] text-muted-foreground">
          {isBudget
            ? "Period spending cap, summed across the category subtree"
            : "Single recurring occurrence matched to one transaction"}
        </span>
        {/* Top-right Delete affordance. Kept separate from the
            bottom action row so it doesn't sit next to Save and
            risk a misclick on a destructive op while the operator's
            mouse is on the primary CTA. */}
        {mode === "edit" && onDelete && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onDelete}
            aria-label="Delete schedule"
            title="Delete schedule"
            className="ml-auto text-muted-foreground hover:text-red-600 hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap gap-2">
          <div className={`${fieldGroupSpacing} flex-1 min-w-[7rem]`}>
            <Label className={labelCls}>{isBudget ? "Account (optional)" : type === "transfer" ? "From account *" : "Account *"}</Label>
            <Select
              value={accountId || (isBudget ? "__none__" : "")}
              onValueChange={(v) => setAccountId(v === "__none__" ? "" : (v ?? ""))}
              required={!isBudget}
            >
              <SelectTrigger className={`${triggerCls} w-full`}>
                <SelectValue placeholder="Account">
                  {accountId
                    ? allAccounts.find((a) => a.id === accountId)?.name ?? "Account"
                    : isBudget
                    ? "All accounts"
                    : "Account"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {isBudget && <SelectItem value="__none__">All accounts</SelectItem>}
                {allAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isBudget && (
            <div className={`${fieldGroupSpacing} flex-1 min-w-[5rem]`}>
              <Label className={labelCls}>Type *</Label>
              <Select value={type} onValueChange={(v) => setType((v ?? "expense") as typeof type)}>
                <SelectTrigger className={`${triggerCls} w-full`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {!isBudget && type === "transfer" && (
            <div className={`${fieldGroupSpacing} flex-1 min-w-[7rem]`}>
              <Label className={labelCls}>To account *</Label>
              <Select value={transferToAccountId} onValueChange={(v) => setTransferToAccountId(v ?? "")} required>
                <SelectTrigger className={`${triggerCls} w-full`}>
                  <SelectValue placeholder="Destination">
                    {allAccounts.find((a) => a.id === transferToAccountId)?.name ?? "Destination"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {allAccounts.filter((a) => a.id !== accountId).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!isBudget && (
            <div className={`${fieldGroupSpacing} flex-1 min-w-[7rem]`}>
              <Label className={labelCls}>
                Category{type === "transfer" && (
                  <span className="ml-1 text-[10px] text-muted-foreground font-normal">(optional)</span>
                )}
              </Label>
              <CategoryDropdown
                value={categoryId || null}
                onChange={(v) => setCategoryId(v ?? "")}
                categories={allCategories}
                triggerClassName={`${triggerCls} w-full justify-between`}
                popoverClassName="w-[var(--anchor-width)] p-0 gap-0 overflow-hidden min-w-72"
              />
            </div>
          )}

          <div className={`${fieldGroupSpacing} flex-[2] min-w-[8rem]`}>
            <Label htmlFor="payee" className={labelCls}>Payee</Label>
            <Input
              id="payee"
              name="payee"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="Netflix, Rent, Salary…"
              className={inputCls}
            />
          </div>
        </div>

        <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap gap-2">
          {!isBudget && (
            <div className={`${fieldGroupSpacing} w-14 shrink-0`}>
              <Label htmlFor="interval" className={labelCls}>Every</Label>
              <Input
                id="interval"
                name="interval"
                type="number"
                min="1"
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                className={inputCls}
              />
            </div>
          )}

          <div className={`${fieldGroupSpacing} flex-1 min-w-[5rem]`}>
            <Label className={labelCls}>{isBudget ? "Period *" : "Frequency *"}</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v ?? "monthly")}>
              <SelectTrigger className={`${triggerCls} w-full`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {!isBudget && <SelectItem value="once">One-off</SelectItem>}
                <SelectItem value="weekly">Weekly</SelectItem>
                {!isBudget && <SelectItem value="fortnightly">Fortnightly</SelectItem>}
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!isBudget && frequency === "monthly" && (
            <div className={`${fieldGroupSpacing} w-16 shrink-0`}>
              <Label htmlFor="dayOfMonth" className={labelCls}>Day</Label>
              <Input
                id="dayOfMonth"
                name="dayOfMonth"
                type="number"
                min="1"
                max="31"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(e.target.value)}
                placeholder="1-31"
                className={inputCls}
              />
            </div>
          )}

          <div className={`${fieldGroupSpacing} flex-[2] min-w-[10rem]`}>
            <Label className={labelCls}>Dates *</Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="startDate"
                name="startDate"
                type="date" min="1900-01-01" max="2099-12-31"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className={`${inputCls} flex-1 min-w-0`}
              />
              <span className="text-muted-foreground text-[10px]">→</span>
              {endDate ? (
                <Input
                  id="endDate"
                  name="endDate"
                  type="date" min="1900-01-01" max="2099-12-31"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={`${inputCls} flex-1 min-w-0`}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEndDate(new Date().toISOString().slice(0, 10))}
                  className="flex-1 min-w-0 h-7 text-[10px] text-muted-foreground hover:text-foreground border border-dashed rounded-md px-2 hover:bg-muted/50 transition-colors"
                >
                  + end
                </button>
              )}
              {endDate && (
                <button
                  type="button"
                  onClick={() => setEndDate("")}
                  className="text-muted-foreground hover:text-foreground text-xs px-1"
                  title="Clear end date"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          <div className={`${fieldGroupSpacing} flex-1 min-w-[5rem]`}>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="amount" className={labelCls}>
                {isBudget ? "Cap *" : useRange ? "Min – Max *" : "Amount *"}
              </Label>
              {!isBudget && (
                <label
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                  title="Toggle a min/max range. Forecasts always use the max."
                >
                  <Switch
                    size="xs"
                    checked={useRange}
                    onCheckedChange={(v) => setUseRange(v)}
                    aria-label="Use min/max amount range"
                  />
                  Range
                </label>
              )}
            </div>
            {useRange ? (
              <div className="flex items-center gap-1.5">
                <Input
                  id="amountMin"
                  name="amountMin"
                  type="number"
                  step="0.01"
                  min="0"
                  value={amountMin}
                  onChange={(e) => setAmountMin(e.target.value)}
                  placeholder="min"
                  required
                  className={`${inputCls} flex-1 min-w-0 text-left`}
                />
                <span className="text-muted-foreground text-[10px]">–</span>
                <Input
                  id="amount"
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="max"
                  required
                  className={`${inputCls} flex-1 min-w-0 text-left`}
                />
              </div>
            ) : (
              <Input
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className={`${inputCls} text-left`}
              />
            )}
          </div>
        </div>

      </div>

      <div className="flex items-center gap-2 pt-1">
        {mode === "edit" && canReplace && !isBudget && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setReplaceOpen(true)}
            title="End this schedule and start a new one with a changed amount"
          >
            Replace schedule
          </Button>
        )}
        {mode === "edit" && onAddToGroup && !isBudget && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onAddToGroup}
            disabled={addingToGroup}
            title="Add another schedule to this lineage group"
          >
            {addingToGroup ? "Adding…" : "+ Add schedule"}
          </Button>
        )}
        {mode === "edit" && (
          <label
            className="ml-auto flex items-center gap-2 h-8 text-xs cursor-pointer"
            title={isActive ? "Active — click to pause" : "Inactive — click to activate"}
          >
            <Switch
              checked={isActive}
              onCheckedChange={(v) => setIsActive(v)}
              aria-label={isActive ? "Pause schedule" : "Activate schedule"}
            />
            <span className="text-muted-foreground">{isActive ? "Active" : "Inactive"}</span>
          </label>
        )}
        {/* Save sits at the right-end of the row (where Delete used
            to live) and uses the indigo CTA variant — primary commit
            action of the form. Edit-mode falls back to ml-auto via
            the Active toggle's label above; create-mode (no Active
            toggle) needs its own ml-auto so Save still right-aligns. */}
        <Button
          type="submit"
          size="sm"
          variant="indigo"
          disabled={loading || (!isBudget && !accountId) || (type === "transfer" && !transferToAccountId)}
          className={mode === "create" ? "ml-auto" : ""}
        >
          {loading ? (mode === "create" ? "Creating…" : "Saving…") : (mode === "create" ? "Create" : "Save")}
        </Button>
      </div>

      <Dialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Replace with new amount</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Use this when the recurring price changed. The current schedule will be closed
              the day before the effective date and a new one will start on it, inheriting
              everything except the amount. Both stay linked so the chart shows the rate change.
            </p>
            <div className="space-y-2">
              <Label htmlFor="replace-amount">New amount</Label>
              <Input
                id="replace-amount"
                type="number"
                step="0.01"
                min="0"
                value={replaceAmount}
                onChange={(e) => setReplaceAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="replace-date">Effective from</Label>
              <Input
                id="replace-date"
                type="date" min="1900-01-01" max="2099-12-31"
                value={replaceDate}
                onChange={(e) => setReplaceDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="replace-payee">Payee (optional)</Label>
              <Input
                id="replace-payee"
                value={replacePayee}
                onChange={(e) => setReplacePayee(e.target.value)}
                placeholder={row.payee ?? ""}
              />
              <p className="text-[10px] text-muted-foreground">
                Leave blank to keep the current payee.
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                onClick={handleReplace}
                disabled={replacing || !replaceAmount.trim() || !replaceDate}
              >
                {replacing ? "Replacing…" : "Replace"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setReplaceOpen(false)} disabled={replacing}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </form>
  );
}
