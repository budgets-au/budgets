"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScheduledEditForm, type ScheduledFormRow } from "@/components/scheduled/scheduled-edit-form";
import { invalidateCashflow } from "@/lib/invalidate-cashflow";
import type { Account, Category } from "@/db/schema";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function blankScheduledRow(): ScheduledFormRow {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: "",
    kind: "schedule",
    payee: null,
    description: null,
    amount: "0.00",
    amountMin: null,
    type: "expense",
    frequency: "monthly",
    interval: 1,
    startDate: today,
    endDate: null,
    isActive: true,
    dayOfMonth: null,
    accountId: "",
    categoryId: null,
    transferToAccountId: null,
  };
}

export function NewScheduledDialog({
  open,
  onOpenChange,
  initialRow,
  title = "New Scheduled Transaction",
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialRow?: ScheduledFormRow;
  title?: string;
  /** Runs after a successful create, before the dialog closes and the route
   * refreshes. Use it to perform follow-up writes such as deleting an
   * obsoleted predecessor when migrating a schedule out of its lineage. */
  onCreated?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const { data: allAccounts = [] } = useSWR<Account[]>(open ? "/api/accounts" : null, fetcher);
  const { data: allCategories = [] } = useSWR<Category[]>(open ? "/api/categories" : null, fetcher);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <ScheduledEditForm
          // Re-key on each open and on row identity so a fresh open after a
          // cancel doesn't leak stale field state.
          key={`${open ? 1 : 0}-${initialRow?.id ?? "blank"}`}
          mode="create"
          row={initialRow ?? blankScheduledRow()}
          allAccounts={allAccounts}
          allCategories={allCategories}
          onSaved={async () => {
            if (onCreated) await onCreated();
            onOpenChange(false);
            router.refresh();
            invalidateCashflow();
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function NewScheduledButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" /> New Scheduled
      </Button>
      <NewScheduledDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
