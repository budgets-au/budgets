"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import type { Account } from "@/db/schema";

const ACCOUNT_TYPES = [
  { value: "checking", label: "Everyday / Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit", label: "Credit Card" },
  { value: "loan", label: "Loan / Mortgage" },
  { value: "cash", label: "Cash" },
];

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6",
];

export function EditAccountDialog({
  account,
  open,
  onOpenChange,
}: {
  account: Account;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(account.name);
  const [type, setType] = useState(account.type);
  const [institution, setInstitution] = useState(account.institution ?? "");
  const [last4, setLast4] = useState(account.accountNumberLast4 ?? "");
  const [color, setColor] = useState(account.color);
  const [startingBalance, setStartingBalance] = useState(account.startingBalance);
  const [startingDate, setStartingDate] = useState(account.startingDate ?? "");
  const [currentBalance, setCurrentBalance] = useState(account.currentBalance);
  const [isExternal, setIsExternal] = useState(account.isExternal);

  // currentBalance is normally derived (= startingBalance + sum of txns).
  // We only PATCH it when the user has changed it relative to its initial
  // value — otherwise we leave it out of the payload and let the server
  // recompute it from the new starting anchor.
  const currentBalanceTouched = currentBalance !== account.currentBalance;

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const patch: Record<string, unknown> = {
      name,
      type,
      institution: institution || null,
      accountNumberLast4: last4 || null,
      color,
      // startingDate is nullable in the DB; send null on empty rather than
      // PG rejecting "" as an invalid date.
      startingDate: startingDate === "" ? null : startingDate,
      isExternal,
    };
    // startingBalance and currentBalance are notNull numerics. Only include
    // them in the payload when the user has a value, so a type-only edit on
    // an account with no explicit anchor doesn't try to write empty strings.
    if (startingBalance !== "") patch.startingBalance = startingBalance;
    if (currentBalanceTouched && currentBalance !== "") {
      patch.currentBalance = currentBalance;
    }

    const res = await fetch(`/api/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });

    setLoading(false);
    if (res.ok) {
      toast.success("Saved");
      onOpenChange(false);
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to save");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Account</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="acct-name">Name *</Label>
            <Input
              id="acct-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type *</Label>
              <Select value={type} onValueChange={(v) => setType(v ?? type)}>
                <SelectTrigger>
                  <SelectValue>
                    {ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? type}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acct-institution">Institution</Label>
              <Input
                id="acct-institution"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acct-last4">Last 4 digits</Label>
            <Input
              id="acct-last4"
              value={last4}
              maxLength={4}
              onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Colour</Label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-transform ${
                    color === c ? "border-foreground scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <label className="flex items-start gap-2 cursor-pointer pt-1 select-none">
            <input
              type="checkbox"
              checked={isExternal}
              onChange={(e) => setIsExternal(e.target.checked)}
              className="mt-0.5 cursor-pointer accent-indigo-600"
            />
            <span className="text-sm">
              Outside the spending pool
              <span className="block text-[11px] text-muted-foreground">
                Transfers to or from this account count as real cashflow in
                weekly totals (use for Savings, Emergency, etc.) instead of
                netting to zero against another asset account.
              </span>
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t">
            <div className="space-y-1.5">
              <Label htmlFor="acct-starting-balance">Starting balance</Label>
              <Input
                id="acct-starting-balance"
                type="number"
                step="0.01"
                value={startingBalance}
                onChange={(e) => setStartingBalance(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acct-starting-date">As-of date</Label>
              <Input
                id="acct-starting-date"
                type="date" min="1900-01-01" max="2099-12-31"
                value={startingDate}
                onChange={(e) => setStartingDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acct-current-balance">Current balance</Label>
            <Input
              id="acct-current-balance"
              type="number"
              step="0.01"
              value={currentBalance}
              onChange={(e) => setCurrentBalance(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Auto-recomputed as <em>starting balance + transactions</em> when you change the starting balance. Edit directly only if you need to override.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? "Saving…" : "Save"}
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
