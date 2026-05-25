"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { toast } from "sonner";
import { CheckSquare, Eye, EyeOff, Pencil } from "lucide-react";
import { EditAccountDialog } from "@/components/accounts/edit-account-dialog";
import { ReconcileDialog } from "@/components/accounts/reconcile-dialog";
import { groupAccounts, TYPE_LABEL } from "@/components/accounts/group-accounts";
import { formatAUD } from "@/lib/utils";
import type { Account } from "@/db/schema";

export function AccountsList({ initialAccounts }: { initialAccounts: Account[] }) {
  const [accounts, setAccounts] = useState(initialAccounts);
  // Issue #99 pattern — keep local state in sync with parent
  // server-component re-renders triggered by router.refresh() after
  // EditAccountDialog / ReconcileDialog close.
  const lastSeen = useRef(initialAccounts);
  useEffect(() => {
    if (lastSeen.current !== initialAccounts) {
      lastSeen.current = initialAccounts;
      setAccounts(initialAccounts);
    }
  }, [initialAccounts]);

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
    // invalidate so a just-archived row drops out (or a just-restored
    // row reappears) without a hard refresh.
    void mutate("/api/accounts");
    toast.success(isArchived ? "Account hidden" : "Account visible");
  }

  const visible = useMemo(() => accounts.filter((a) => !a.isArchived), [accounts]);
  const hidden = useMemo(() => accounts.filter((a) => a.isArchived), [accounts]);
  const grouped = useMemo(() => groupAccounts(visible), [visible]);

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div>
        <p className="font-medium text-sm">Accounts</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Hidden accounts are excluded from balances, reports, and the
          dashboard. Pin one in a dashboard tile to keep it visible
          anyway.
        </p>
      </div>

      <div className="space-y-5">
        {grouped.groups.map((g) =>
          g.accounts.length === 0 ? null : (
            <Group
              key={g.key}
              label={g.label}
              accounts={g.accounts}
              subtotal={g.subtotal}
              onToggle={toggle}
            />
          ),
        )}
        {grouped.other && (
          <Group
            label="Other"
            accounts={grouped.other.accounts}
            subtotal={grouped.other.subtotal}
            onToggle={toggle}
          />
        )}

        {visible.length > 0 && (
          <div className="flex items-center justify-between border-t pt-3 px-2">
            <span className="text-sm font-semibold">Net worth</span>
            <span className="text-sm font-semibold tabular-nums">
              {formatAUD(grouped.net)}
            </span>
          </div>
        )}

        {hidden.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pt-2 pb-1">
              Hidden
            </p>
            <div className="space-y-1">
              {hidden.map((a) => (
                <Row key={a.id} account={a} onToggle={toggle} />
              ))}
            </div>
          </div>
        )}

        {accounts.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">No accounts yet.</p>
        )}
      </div>
    </div>
  );
}

function Group({
  label,
  accounts,
  subtotal,
  onToggle,
}: {
  label: string;
  accounts: Account[];
  subtotal: number;
  onToggle: (id: string, archived: boolean) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between pb-1.5 px-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          {label}
        </p>
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          {formatAUD(subtotal)}
        </span>
      </div>
      <div className="space-y-1">
        {accounts.map((a) => (
          <Row key={a.id} account={a} onToggle={onToggle} />
        ))}
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
  const balance = parseFloat(account.currentBalance);
  return (
    <>
      <div className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/50 group">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: account.color }}
          />
          <span
            className={`text-sm truncate ${account.isArchived ? "text-muted-foreground line-through" : ""}`}
          >
            {account.name}
          </span>
          <span className="text-[11px] text-muted-foreground/70 hidden sm:inline shrink-0">
            {TYPE_LABEL[account.type] ?? account.type}
          </span>
          {account.institution && (
            <span className="text-xs text-muted-foreground hidden md:inline truncate">
              {account.institution}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          <span
            className={`text-sm tabular-nums ${
              account.isArchived
                ? "text-muted-foreground"
                : balance < 0
                  ? "text-rose-600 dark:text-rose-400"
                  : ""
            }`}
          >
            {formatAUD(balance)}
          </span>
          {/* Edit / Reconcile / Hide — hover-revealed on lg+, always
              visible on touch viewports (feedback_mobile_hover). */}
          <div className="flex items-center gap-0.5 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
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
      </div>
      <EditAccountDialog
        account={account}
        open={editing}
        onOpenChange={(o) => {
          setEditing(o);
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
