"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatAUD, amountClass, cn } from "@/lib/utils";
import { Upload, CheckCircle2, FileSpreadsheet } from "lucide-react";
import type { PreviewAccount } from "@/app/api/accounts/import/route";

const ACCOUNT_TYPES = [
  { value: "checking", label: "Everyday / Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit", label: "Credit Card" },
  { value: "loan", label: "Loan / Mortgage" },
  { value: "cash", label: "Cash" },
];

type Step = "upload" | "preview" | "done";

export function ImportAccountsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<PreviewAccount[]>([]);
  const [created, setCreated] = useState(0);
  const [updated, setUpdated] = useState(0);

  function reset() {
    setStep("upload");
    setRows([]);
    setCreated(0);
    setUpdated(0);
    setLoading(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    setOpen(next);
  }

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setLoading(true);

    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch("/api/accounts/import", { method: "POST", body: fd });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Parse failed" }));
      toast.error(error ?? "Failed to parse file");
      setLoading(false);
      return;
    }

    const data: { rows: PreviewAccount[] } = await res.json();
    if (!data.rows.length) {
      toast.error("No accounts found in file");
      setLoading(false);
      return;
    }
    setRows(data.rows);
    setStep("preview");
    setLoading(false);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/csv": [".csv"], "text/plain": [".csv"] },
    multiple: false,
  });

  function toggleRow(idx: number) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, skip: !r.skip } : r)));
  }

  function setType(idx: number, type: string) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, type } : r)));
  }

  async function handleCommit() {
    const toCreate = rows.filter((r) => !r.skip);
    if (!toCreate.length) {
      toast.error("No accounts selected");
      return;
    }
    setLoading(true);

    const res = await fetch("/api/accounts/import/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: toCreate }),
    });

    if (res.ok) {
      const data = await res.json();
      setCreated(data.created ?? 0);
      setUpdated(data.updated ?? 0);
      setStep("done");
      router.refresh();
    } else {
      const { error } = await res.json().catch(() => ({ error: "Import failed" }));
      toast.error(error ?? "Import failed");
    }
    setLoading(false);
  }

  const toImport = rows.filter((r) => !r.skip);
  const toCreateCount = toImport.filter((r) => !r.existingId).length;
  const toUpdateCount = toImport.filter((r) => !!r.existingId).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        <FileSpreadsheet className="h-4 w-4 mr-1" />
        Import CSV
      </DialogTrigger>

      <DialogContent
        className="sm:max-w-3xl max-h-[90vh] overflow-y-auto"
        aria-labelledby="import-accounts-title"
      >
        <DialogHeader>
          <DialogTitle id="import-accounts-title">
            {step === "upload" && "Import Accounts from CSV"}
            {step === "preview" && "Review Accounts"}
            {step === "done" && "Import Complete"}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Upload */}
        {step === "upload" && (
          <div
            {...getRootProps()}
            role="button"
            tabIndex={0}
            aria-label="Upload bank account CSV"
            className={cn(
              "border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors mt-2 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
              isDragActive
                ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30"
                : "border-border hover:border-foreground/40"
            )}
          >
            <input {...getInputProps()} />
            <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
            <p className="text-base font-medium">
              {isDragActive ? "Drop your CSV here" : "Drag & drop your bank account export"}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Supports bank account summary CSVs · ANZ, CommBank, Westpac, NAB and more
            </p>
            {loading && (
              <p className="text-sm text-indigo-600 dark:text-indigo-400 mt-3 animate-pulse">
                Parsing file…
              </p>
            )}
          </div>
        )}

        {/* Step 2: Preview */}
        {step === "preview" && (
          <>
            <div className="flex gap-2 flex-wrap mb-3">
              {toCreateCount > 0 && (
                <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20">
                  {toCreateCount} new
                </Badge>
              )}
              {toUpdateCount > 0 && (
                <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20">
                  {toUpdateCount} balance update{toUpdateCount !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border text-sm">
              <table className="w-full">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="w-8 px-3 py-2" />
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Type</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Institution</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row, idx) => (
                    <tr
                      key={idx}
                      className={cn(
                        row.skip ? "opacity-40" : "",
                        row.duplicate ? "bg-amber-50 dark:bg-amber-500/10" : "hover:bg-muted/40"
                      )}
                    >
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={!row.skip}
                          onCheckedChange={() => toggleRow(idx)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium truncate max-w-[200px]">{row.name}</p>
                        {row.accountNumberLast4 && (
                          <p className="text-xs text-muted-foreground">····{row.accountNumberLast4}</p>
                        )}
                        {row.existingId && (
                          <span className="text-[10px] text-amber-600">will update existing balance</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={row.type}
                          onValueChange={(v) => setType(idx, v ?? row.type)}
                        >
                          <SelectTrigger className="h-7 text-xs w-36">
                            <SelectValue>
                              {ACCOUNT_TYPES.find((t) => t.value === row.type)?.label ?? row.type}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {ACCOUNT_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">
                        {row.institution ?? "—"}
                      </td>
                      <td className={cn("px-3 py-2 text-right font-medium", amountClass(row.startingBalance))}>
                        {row.existingBalance != null && row.existingBalance !== row.startingBalance && (
                          <p className="text-[10px] text-muted-foreground font-normal line-through">
                            {formatAUD(row.existingBalance)}
                          </p>
                        )}
                        {formatAUD(row.startingBalance)}
                        {row.startingDate && (
                          <p className="text-[10px] text-muted-foreground font-normal">
                            as at {row.startingDate}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <DialogFooter className="-mx-0 -mb-0 border-0 bg-transparent p-0 mt-4">
              <Button variant="outline" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button
                onClick={handleCommit}
                disabled={loading || toImport.length === 0}
              >
                {loading
                  ? "Importing…"
                  : (() => {
                      if (toCreateCount > 0 && toUpdateCount > 0) {
                        return `Import ${toCreateCount} & update ${toUpdateCount}`;
                      }
                      if (toUpdateCount > 0) {
                        return `Update ${toUpdateCount} balance${toUpdateCount !== 1 ? "s" : ""}`;
                      }
                      return `Import ${toCreateCount} account${toCreateCount !== 1 ? "s" : ""}`;
                    })()}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 3: Done */}
        {step === "done" && (
          <div className="py-8 text-center">
            <CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto mb-4" />
            <p className="text-lg font-semibold mb-1">
              {created > 0 && `${created} new`}
              {created > 0 && updated > 0 && " · "}
              {updated > 0 && `${updated} balance${updated !== 1 ? "s" : ""} updated`}
              {created === 0 && updated === 0 && "No changes"}
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              Accounts are ready to use.
            </p>
            <div className="flex gap-3 justify-center">
              <Button
                variant="outline"
                onClick={() => { reset(); }}
              >
                Import another file
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
