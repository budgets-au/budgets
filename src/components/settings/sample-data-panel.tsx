"use client";

import useSWR, { mutate } from "swr";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { toast } from "sonner";

interface SampleCounts {
  sampleAccounts: number;
  sampleTransactions: number;
  sampleScheduled: number;
  samplePayeeRules: number;
  dependentNonSample: { transactions: number; scheduled: number };
  sampleDataSeeded: boolean;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load");
  return res.json();
};

export function SampleDataPanel() {
  const { data, isLoading, error } = useSWR<SampleCounts>(
    "/api/sample-data/remove",
    { revalidateOnFocus: false },
  );
  const confirm = useConfirm();
  const [removing, setRemoving] = useState(false);

  if (error) {
    // Non-admin users get 401 — render nothing so the panel quietly
    // hides for members. Other failures show a toast on first paint.
    return null;
  }

  if (isLoading || !data) {
    return (
      <div className="rounded-xl border bg-card divide-y">
        <div className="px-4 py-3">
          <h2 className="font-medium">Sample data</h2>
        </div>
        <div className="px-4 py-4 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
        </div>
      </div>
    );
  }

  const totalSample =
    data.sampleAccounts +
    data.sampleTransactions +
    data.sampleScheduled +
    data.samplePayeeRules;
  const dependentTotal =
    data.dependentNonSample.transactions + data.dependentNonSample.scheduled;
  const isRemoved = totalSample === 0 && data.sampleDataSeeded;

  async function remove() {
    const dependentClause =
      dependentTotal > 0
        ? ` This will also remove ${dependentTotal} of your own row${dependentTotal === 1 ? "" : "s"} attached to sample accounts.`
        : "";
    const ok = await confirm({
      title: "Remove sample data?",
      description: `Permanently delete all rows tagged as sample (${totalSample} total).${dependentClause} A pre-removal backup is taken automatically.`,
      confirmLabel: "Remove",
      tone: "destructive",
    });
    if (!ok) return;
    setRemoving(true);
    try {
      const res = await fetch("/api/sample-data/remove", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Removal failed");
      }
      toast.success("Sample data removed");
      // Refresh anything that might be displaying the deleted rows.
      mutate("/api/sample-data/remove");
      mutate(
        (key) => typeof key === "string" && key.startsWith("/api/transactions"),
        undefined,
        { revalidate: true },
      );
      mutate("/api/accounts");
      mutate(
        (key) => typeof key === "string" && key.startsWith("/api/scheduled"),
        undefined,
        { revalidate: true },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card divide-y">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-medium">Sample data</h2>
        </div>
      </div>
      <div className="px-4 py-3 space-y-2">
        {isRemoved ? (
          <p className="text-sm text-muted-foreground">
            The starter dataset has been removed. The seeder won&rsquo;t
            re-add it on future unlocks.
          </p>
        ) : totalSample === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sample data on this database — nothing to remove.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Demo accounts and transactions seeded on first unlock so the
              app isn&rsquo;t empty out of the gate. Remove them once
              you&rsquo;ve started importing real data.
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5 ml-1">
              <li>· {data.sampleAccounts} sample account{data.sampleAccounts === 1 ? "" : "s"}</li>
              <li>· {data.sampleTransactions} sample transaction{data.sampleTransactions === 1 ? "" : "s"}</li>
              <li>· {data.sampleScheduled} scheduled item{data.sampleScheduled === 1 ? "" : "s"}</li>
              {data.samplePayeeRules > 0 && (
                <li>· {data.samplePayeeRules} payee rule{data.samplePayeeRules === 1 ? "" : "s"}</li>
              )}
            </ul>
            {dependentTotal > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Heads up: {dependentTotal} of your own row{dependentTotal === 1 ? "" : "s"}
                {" "}attached to sample accounts will also be removed.
              </p>
            )}
          </>
        )}
      </div>
      {!isRemoved && totalSample > 0 && (
        <div className="px-4 py-3 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={remove}
            disabled={removing}
          >
            {removing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1 h-3.5 w-3.5" />
            )}
            Remove sample data
          </Button>
        </div>
      )}
    </div>
  );
}
