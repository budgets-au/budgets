"use client";

import { AlertTriangle, CheckCircle2, Database, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSwrJson } from "@/hooks/use-swr-json";
import { cn } from "@/lib/utils";

interface SchemaCheck {
  journalCount: number;
  recordedCount: number;
  newestRecorded: number | null;
  pending: string[];
  missingTables: string[];
  missingColumns: Array<{ table: string; column: string }>;
  lastRun: {
    applied: string[];
    repaired: string[];
    error: { tag: string; message: string } | null;
    at: number;
  } | null;
}

export function SchemaCheckCard() {
  const { data, error, isLoading, mutate } = useSwrJson<SchemaCheck>(
    "/api/maintenance/schema-check",
  );
  const problems =
    !!data &&
    (data.pending.length > 0 ||
      data.missingTables.length > 0 ||
      data.missingColumns.length > 0 ||
      !!data.lastRun?.error);

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-medium">Schema check</h2>
        </div>
        <Button size="sm" variant="outline" onClick={() => void mutate()} disabled={isLoading}>
          <RefreshCw className={cn("mr-1 h-3.5 w-3.5", isLoading && "animate-spin")} />
          Re-check
        </Button>
      </div>
      <div className="space-y-3 px-4 py-4 text-sm">
        {error ? (
          <p className="text-muted-foreground">Couldn&apos;t load the schema check.</p>
        ) : !data ? (
          <p className="text-muted-foreground">Checking…</p>
        ) : (
          <>
            <div
              className={cn(
                "flex items-start gap-2 rounded-md border px-3 py-2",
                problems
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100"
                  : "border-emerald-500/40 bg-emerald-500/5 text-emerald-900 dark:text-emerald-200",
              )}
            >
              {problems ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>
                {problems
                  ? "The database schema doesn't match this version. Details below."
                  : "Schema is up to date with every migration in this version."}
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Migrations recorded</dt>
              <dd className="tabular-nums">
                {data.recordedCount} of {data.journalCount}
              </dd>
              <dt className="text-muted-foreground">Newest recorded</dt>
              <dd className="tabular-nums">{data.newestRecorded ?? "—"}</dd>
              {data.pending.length > 0 && (
                <>
                  <dt className="text-muted-foreground">Pending</dt>
                  <dd className="font-mono break-all">{data.pending.join(", ")}</dd>
                </>
              )}
              {data.missingTables.length > 0 && (
                <>
                  <dt className="text-muted-foreground">Missing tables</dt>
                  <dd className="font-mono break-all">{data.missingTables.join(", ")}</dd>
                </>
              )}
              {data.missingColumns.length > 0 && (
                <>
                  <dt className="text-muted-foreground">Missing columns</dt>
                  <dd className="font-mono break-all">
                    {data.missingColumns.map((c) => `${c.table}.${c.column}`).join(", ")}
                  </dd>
                </>
              )}
              {data.lastRun && (
                <>
                  <dt className="text-muted-foreground">Last migration run</dt>
                  <dd>
                    {new Date(data.lastRun.at).toLocaleString()}
                    {data.lastRun.applied.length > 0 && ` · applied ${data.lastRun.applied.join(", ")}`}
                    {data.lastRun.repaired.length > 0 && ` · repaired ${data.lastRun.repaired.join(", ")}`}
                  </dd>
                </>
              )}
              {data.lastRun?.error && (
                <>
                  <dt className="text-muted-foreground">Last error</dt>
                  <dd className="font-mono break-all text-amber-700 dark:text-amber-300">
                    {data.lastRun.error.tag}: {data.lastRun.error.message}
                  </dd>
                </>
              )}
            </dl>
            {problems && (
              <p className="text-xs text-muted-foreground">
                Migrations re-run on every unlock. Lock and unlock once to retry; if the
                error persists, share this panel when reporting the issue.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
