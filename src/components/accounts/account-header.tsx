"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatAUD, amountClass } from "@/lib/utils";
import { Pencil, CheckSquare } from "lucide-react";
import { EditAccountDialog } from "@/components/accounts/edit-account-dialog";
import { ReconcileDialog } from "@/components/accounts/reconcile-dialog";
import type { Account } from "@/db/schema";

export function AccountHeader({ account, href }: { account: Account; href?: string }) {
  const [editing, setEditing] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const infoBlock = (
    <div className="flex items-center gap-3 px-3 py-2 flex-1 min-w-0">
      <div
        className="w-2 h-12 rounded-sm shrink-0"
        style={{ backgroundColor: account.color }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{account.name}</p>
        <p className={`text-xl font-bold leading-tight ${amountClass(account.currentBalance)}`}>
          {formatAUD(account.currentBalance)}
        </p>
        <p className="text-xs text-muted-foreground capitalize">
          {account.type}
          {account.institution ? ` · ${account.institution}` : ""}
          {account.accountNumberLast4
            ? ` ····${account.accountNumberLast4}`
            : ""}
        </p>
      </div>
    </div>
  );

  return (
    <>
      <Card data-size="sm" className="overflow-hidden py-0">
        <div className="flex items-stretch">
          {href ? (
            <Link
              href={href}
              className="flex-1 min-w-0 flex hover:bg-muted/40 transition-colors"
            >
              {infoBlock}
            </Link>
          ) : (
            infoBlock
          )}
          <div className="flex flex-col justify-center gap-0.5 pr-2 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label="Edit account"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label="Reconcile account"
              onClick={() => setReconciling(true)}
            >
              <CheckSquare className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      <EditAccountDialog
        account={account}
        open={editing}
        onOpenChange={setEditing}
      />

      <ReconcileDialog
        accountId={account.id}
        open={reconciling}
        onOpenChange={setReconciling}
      />
    </>
  );
}
