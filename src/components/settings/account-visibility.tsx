"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { mutate } from "swr";
import { toast } from "sonner";
import { CheckSquare, Eye, EyeOff, Pencil, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ImportAccountsButton } from "@/components/accounts/import-accounts-button";
import { EditAccountDialog } from "@/components/accounts/edit-account-dialog";
import { ReconcileDialog } from "@/components/accounts/reconcile-dialog";
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
    // The left-nav sidebar lists active accounts via SWR(/api/accounts);
    // without this invalidate it would still display archived accounts
    // (or omit just-unarchived ones) until a hard refresh.
    void mutate("/api/accounts");
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
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  return (
    <>
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
        {/* Edit + Reconcile + Hide affordances. Hover-revealed on
            lg+, always visible on mobile (no hover) to stay
            discoverable. Mirrors the deleted dashboard Accounts
            widget — the operator can now manage names / colours /
            balances without leaving Settings → Accounts. */}
        <div className="flex items-center gap-0.5 shrink-0 ml-2 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setEditing(true)}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Edit account"
            aria-label="Edit account"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => setReconciling(true)}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Reconcile account"
            aria-label="Reconcile account"
          >
            <CheckSquare className="h-4 w-4" />
          </button>
          <button
            onClick={() => onToggle(account.id, !account.isArchived)}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={account.isArchived ? "Show account" : "Hide account"}
            aria-label={account.isArchived ? "Show account" : "Hide account"}
          >
            {account.isArchived ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <EditAccountDialog
        account={account}
        open={editing}
        onOpenChange={(o) => {
          setEditing(o);
          // Refresh the server-rendered initialAccounts after a
          // save so the row reflects new name/color/etc.
          if (!o) router.refresh();
        }}
      />
      <ReconcileDialog
        accountId={account.id}
        open={reconciling}
        onOpenChange={(o) => {
          setReconciling(o);
          if (!o) router.refresh();
        }}
      />
    </>
  );
}
