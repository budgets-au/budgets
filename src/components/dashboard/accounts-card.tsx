"use client";

import useSWR from "swr";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { AccountHeader } from "@/components/accounts/account-header";
import { ImportAccountsButton } from "@/components/accounts/import-accounts-button";
import { cn } from "@/lib/utils";
import type { Account } from "@/db/schema";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const TYPE_ORDER = ["checking", "savings", "cash", "credit", "loan"];
const TYPE_LABELS: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  cash: "Cash",
  credit: "Credit",
  loan: "Loans",
};

/** Per-type-grouped accounts list. Was a server-rendered block on
 * the dashboard; now a self-contained widget so it can move into
 * the editable grid. Type ordering matches the previous layout. */
export function AccountsCard() {
  const { data: allAccounts = [] } = useSWR<Account[]>(
    "/api/accounts",
    fetcher,
  );
  const visibleAccounts = allAccounts.filter((a) => !a.isArchived);
  const groupedAccounts = TYPE_ORDER.map((t) => ({
    type: t,
    label: TYPE_LABELS[t],
    accounts: visibleAccounts.filter((a) => a.type === t),
  }))
    .concat([
      {
        type: "_other",
        label: "Other",
        accounts: visibleAccounts.filter((a) => !TYPE_ORDER.includes(a.type)),
      },
    ])
    .filter((g) => g.accounts.length > 0);

  return (
    <Card className="h-full">
      <CardContent className="p-3 h-full overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
            Accounts
          </h2>
          <div className="flex gap-2">
            <ImportAccountsButton />
            <Link
              href="/accounts/new"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
              )}
            >
              <Plus className="h-4 w-4 mr-1" /> New
            </Link>
          </div>
        </div>
        {visibleAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No accounts yet.{" "}
            <Link href="/accounts/new" className="underline">
              Add your first account
            </Link>
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
            {groupedAccounts.map((g) => (
              <div key={g.type} className="space-y-3">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {g.label}
                </p>
                {g.accounts.map((account) => (
                  <AccountHeader
                    key={account.id}
                    account={account}
                    href={`/transactions?accountIds=${account.id}`}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
