"use client";

import { useState } from "react";
import { mutate as globalMutate } from "swr";
import { ArrowLeftRight, BarChart3, Eraser, Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { toast } from "sonner";

/** Settings → Maintenance. Surfaces two transfer-pair housekeeping
 *  ops that were previously buried elsewhere in the app:
 *
 *    - **Re-run transfer backfill**: clears
 *      `app_settings.transfer_backfill_done` and re-runs the
 *      orphan-transfer pass. Mints synthetic counterparts in the
 *      External account for every transfer the matcher can't pair
 *      against a tracked row. Use after a partial delete or a
 *      restore where the flag is stale relative to the data.
 *
 *    - **Reset & re-scan**: deletes every synthetic stub, then
 *      re-runs the transfer matcher across the whole DB. Use when
 *      the backfill paired transfers with External-account stubs
 *      but the real counterparts actually live in tracked
 *      accounts. The same button lives on /transactions inside
 *      the transfer-suggestions panel; this is the discoverable
 *      copy that doesn't require knowing where to look.
 *
 *  Both ops are destructive on the synthetic-stub population, so
 *  each is gated by a `useConfirm()` dialog with the operator
 *  spelling out what's about to happen. */
export function MaintenancePanel() {
  const confirm = useConfirm();
  const [running, setRunning] = useState<
    "backfill" | "reset" | "analyze" | null
  >(null);

  async function runBackfill() {
    const ok = await confirm({
      title: "Re-run transfer backfill?",
      description:
        "Re-runs the orphan-transfer pass that fires once on first unlock. " +
        "Any transfer the matcher can't pair against a tracked row will spawn " +
        "a synthetic counterpart in the External account. Existing pairs " +
        "stay intact. Use when manually-deleted synthetics need to come back.",
      confirmLabel: "Re-run backfill",
      tone: "default",
    });
    if (!ok) return;
    setRunning("backfill");
    try {
      const res = await fetch("/api/transfers/backfill", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Backfill failed");
        return;
      }
      const { paired } = (await res.json()) as { paired: number };
      toast.success(
        `Backfill complete — ${paired} transfer${paired === 1 ? "" : "s"} paired.`,
      );
      void globalMutate(
        (k) => typeof k === "string" && k.startsWith("/api/transactions"),
        undefined,
        { revalidate: true },
      );
      void globalMutate("/api/accounts", undefined, { revalidate: true });
    } finally {
      setRunning(null);
    }
  }

  async function runResetAndRescan() {
    const ok = await confirm({
      title: "Delete synthetic placeholders & re-scan?",
      description:
        "Every transfer placeholder the app auto-minted in External (or " +
        "another untracked-counterparty account) will be deleted. The " +
        "matcher then re-pairs surviving rows against real tracked " +
        "counterparts where possible. Manually-linked external pairs are " +
        "also removed — re-create them via the row's Link icon if needed.",
      confirmLabel: "Reset & re-scan",
    });
    if (!ok) return;
    setRunning("reset");
    try {
      const res = await fetch("/api/transfers/reset-and-rescan", {
        method: "POST",
      });
      if (!res.ok) {
        toast.error("Reset failed");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        syntheticsDeleted?: number;
        paired?: number;
        suggested?: number;
      };
      const parts: string[] = [];
      parts.push(
        `${body.syntheticsDeleted ?? 0} placeholder${
          (body.syntheticsDeleted ?? 0) === 1 ? "" : "s"
        } deleted`,
      );
      if ((body.paired ?? 0) > 0) parts.push(`${body.paired} auto-paired`);
      if ((body.suggested ?? 0) > 0) {
        parts.push(
          `${body.suggested} suggestion${body.suggested === 1 ? "" : "s"}`,
        );
      }
      toast.success(parts.join(" · "));
      void globalMutate(
        (k) => typeof k === "string" && k.startsWith("/api/transactions"),
        undefined,
        { revalidate: true },
      );
      void globalMutate("/api/accounts", undefined, { revalidate: true });
    } finally {
      setRunning(null);
    }
  }

  async function runAnalyze() {
    setRunning("analyze");
    try {
      const res = await fetch("/api/maintenance/analyze", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Analyze failed");
        return;
      }
      const { elapsedMs } = (await res.json()) as { elapsedMs: number };
      toast.success(`Statistics refreshed (${elapsedMs}ms).`);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-6">
    <div className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Wrench className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-medium">Transfer maintenance</h2>
      </div>
      <div className="divide-y">
        <div className="flex items-start justify-between gap-3 px-4 py-4">
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
              Re-run transfer backfill
            </p>
            <p className="text-xs text-muted-foreground">
              Re-runs the orphan-transfer pass that fires once on first
              unlock. Any transfer the matcher can&rsquo;t pair against a
              tracked row spawns a synthetic counterpart in the External
              account. Existing pairs stay intact. Use after a partial
              delete, or after restoring a DB where the
              backfill-already-done flag is stale.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={runBackfill}
            disabled={running !== null}
            className="shrink-0"
          >
            {running === "backfill" ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowLeftRight className="mr-1 h-3.5 w-3.5" />
            )}
            {running === "backfill" ? "Running…" : "Re-run"}
          </Button>
        </div>
        <div className="flex items-start justify-between gap-3 px-4 py-4">
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Eraser className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
              Reset &amp; re-scan
            </p>
            <p className="text-xs text-muted-foreground">
              Deletes every synthetic placeholder, then re-runs the
              transfer matcher across the whole DB. Use when the backfill
              paired transfers with External-account stubs but the real
              counterparts actually live in tracked accounts. Manually-
              linked external pairs are also removed.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={runResetAndRescan}
            disabled={running !== null}
            className="shrink-0 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
          >
            {running === "reset" ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eraser className="mr-1 h-3.5 w-3.5" />
            )}
            {running === "reset" ? "Resetting…" : "Reset & re-scan"}
          </Button>
        </div>
      </div>
    </div>

    <div className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-medium">Database</h2>
      </div>
      <div className="divide-y">
        <div className="flex items-start justify-between gap-3 px-4 py-4">
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-medium">Refresh query-planner statistics</p>
            <p className="text-xs text-muted-foreground">
              Runs SQLite&rsquo;s <code className="font-mono">ANALYZE</code>.
              The planner picks indexes based on column-distribution
              statistics; those numbers go stale after big bulk
              mutations (large imports, sample-data removal, restore)
              and the planner can pick a worse plan than it would on
              fresh stats. Cheap and side-effect-free apart from
              refreshing those tables.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={runAnalyze}
            disabled={running !== null}
            className="shrink-0"
          >
            {running === "analyze" ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <BarChart3 className="mr-1 h-3.5 w-3.5" />
            )}
            {running === "analyze" ? "Analysing…" : "Run ANALYZE"}
          </Button>
        </div>
      </div>
    </div>
    </div>
  );
}
