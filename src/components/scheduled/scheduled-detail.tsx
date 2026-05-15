"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { toast } from "sonner";
import { formatAUD, formatDate, amountClass } from "@/lib/utils";
import { ScheduledEditForm } from "@/components/scheduled/scheduled-edit-form";
import { invalidateCashflow } from "@/lib/invalidate-cashflow";
import type { Account, Category } from "@/db/schema";

interface ScheduledRow {
  id: string;
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
  accountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  transferToAccountId: string | null;
  transferToAccountName: string | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function ScheduledDetail({ row: initial, allAccounts, allCategories }: {
  row: ScheduledRow;
  allAccounts: Account[];
  allCategories: Category[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const row = initial;

  async function handleDelete() {
    const ok = await confirm({
      title: "Delete schedule",
      description: "Delete this scheduled transaction?",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const res = await fetch(`/api/scheduled/${row.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Deleted");
      router.push("/scheduled");
    } else {
      toast.error("Failed to delete");
    }
  }

  if (!editing) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{row.payee || row.description || "Unnamed"}</CardTitle>
              <p className="text-sm text-muted-foreground capitalize">{row.type}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
              <Button size="sm" variant="destructive" onClick={handleDelete}>Delete</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount</span>
            <span className={`font-semibold ${amountClass(row.amount)}`}>{formatAUD(row.amount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Frequency</span>
            <span className="capitalize">{row.frequency}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{row.type === "transfer" ? "From" : "Account"}</span>
            <span>{row.accountName}</span>
          </div>
          {row.type === "transfer" && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">To</span>
              <span>{row.transferToAccountName ?? "—"}</span>
            </div>
          )}
          {row.type !== "transfer" && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Category</span>
              <span>{row.categoryName ?? "—"}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Start date</span>
            <span>{formatDate(row.startDate)}</span>
          </div>
          {row.endDate && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">End date</span>
              <span>{formatDate(row.endDate)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <Badge variant={row.isActive ? "default" : "secondary"}>
              {row.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Edit Scheduled Transaction</CardTitle></CardHeader>
      <CardContent>
        <ScheduledEditForm
          row={row}
          allAccounts={allAccounts}
          allCategories={allCategories}
          canReplace={row.isActive}
          onSaved={() => {
            setEditing(false);
            router.refresh();
            invalidateCashflow();
          }}
        />
      </CardContent>
    </Card>
  );
}
