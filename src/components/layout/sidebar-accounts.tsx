"use client";

import useSWR from "swr";
import { cn } from "@/lib/utils";
import { useAccountFilter } from "@/hooks/use-account-filter";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Account {
  id: string;
  name: string;
  color: string;
  type: string;
  isArchived: boolean;
}

const TYPE_ORDER = ["checking", "savings", "cash", "credit", "loan"];
const TYPE_LABELS: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  cash: "Cash",
  credit: "Credit",
  loan: "Loans",
};

export function SidebarAccounts({ onPick }: { onPick?: () => void }) {
  const { data: accounts = [] } = useSWR<Account[]>("/api/accounts", fetcher);
  const { selectedIds, allSelected, toggle, clear } = useAccountFilter();

  const visible = accounts.filter((a) => !a.isArchived);

  const grouped = TYPE_ORDER.map((t) => ({
    type: t,
    accounts: visible.filter((a) => a.type === t),
  }))
    .concat([
      {
        type: "_other",
        accounts: visible.filter((a) => !TYPE_ORDER.includes(a.type)),
      },
    ])
    .filter((g) => g.accounts.length > 0);

  return (
    <div className="px-3 pb-4 mt-2">
      <p className="px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
        Accounts
      </p>
      <div className="space-y-0.5">
        <button
          onClick={() => {
            clear();
            onPick?.();
          }}
          className={cn(
            "w-full text-left text-sm px-3 py-1.5 rounded-md transition-colors",
            allSelected
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          All accounts
        </button>
        {grouped.map((g) => (
          <div key={g.type} className="pt-2 first:pt-0">
            <p className="px-3 pt-1 pb-0.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
              {TYPE_LABELS[g.type] ?? "Other"}
            </p>
            {g.accounts.map((a) => {
              const active = selectedIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => {
                    toggle(a.id);
                    onPick?.();
                  }}
                  className={cn(
                    "w-full text-left text-sm px-3 py-1.5 rounded-md flex items-center gap-2 transition-colors",
                    active
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: a.color }}
                  />
                  <span className="truncate flex-1">{a.name}</span>
                  {active && <span className="text-[10px] text-muted-foreground/60 shrink-0">✓</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
