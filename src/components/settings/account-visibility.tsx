"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Eye, EyeOff, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ImportAccountsButton } from "@/components/accounts/import-accounts-button";
import { cn } from "@/lib/utils";
import type { Account } from "@/db/schema";

export function AccountVisibility({ initialAccounts }: { initialAccounts: Account[] }) {
  const [accounts, setAccounts] = useState(initialAccounts);

  async function toggle(id: string, isArchived: boolean) {
    const res = await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isArchived }),
    });
    if (!res.ok) {
      toast.error("Failed to update account");
      return;
    }
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, isArchived } : a)));
    toast.success(isArchived ? "Account hidden" : "Account visible");
  }

  const visible = accounts.filter((a) => !a.isArchived);
  const hidden = accounts.filter((a) => a.isArchived);

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-sm">Accounts</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Hidden accounts are excluded from balances, reports, and the
            dashboard. Pin one in a dashboard tile to keep it visible
            anyway.
          </p>
        </div>
        {/* Import + Add buttons used to live on the dashboard's
        Accounts widget; they sit here now so the widget can stay
        focused on viewing balances. */}
        <div className="flex gap-2 shrink-0">
          <ImportAccountsButton />
          <Link
            href="/accounts/new"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Plus className="h-4 w-4 mr-1" /> New
          </Link>
        </div>
      </div>

      <div className="space-y-1">
        {visible.map((a) => (
          <Row key={a.id} account={a} onToggle={toggle} />
        ))}
        {hidden.length > 0 && (
          <>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pt-2 pb-1">
              Hidden
            </p>
            {hidden.map((a) => (
              <Row key={a.id} account={a} onToggle={toggle} />
            ))}
          </>
        )}
        {accounts.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">No accounts yet.</p>
        )}
      </div>
    </div>
  );
}

function Row({
  account,
  onToggle,
}: {
  account: Account;
  onToggle: (id: string, archived: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/50 group">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: account.color }}
        />
        <span className={`text-sm truncate ${account.isArchived ? "text-muted-foreground line-through" : ""}`}>
          {account.name}
        </span>
        {account.institution && (
          <span className="text-xs text-muted-foreground hidden sm:inline">{account.institution}</span>
        )}
      </div>
      <button
        onClick={() => onToggle(account.id, !account.isArchived)}
        className="text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100 shrink-0 ml-2"
        title={account.isArchived ? "Show account" : "Hide account"}
      >
        {account.isArchived ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </button>
    </div>
  );
}
