"use client";

import { useSwrJson } from "@/hooks/use-swr-json";
import { AlertTriangle, CheckCircle2, FolderOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AttachmentsHealth {
  path: string;
  ok: boolean;
  error?: string;
  stage?: "mkdir" | "write" | "read" | "delete" | "verify";
}

/** Settings → Databases: receipts-attachments store diagnostic.
 *
 *  Shows the resolved on-disk path for receipt attachments and the
 *  live result of a write/read/delete probe against that path. A
 *  failing probe raises an inline amber banner naming the OS error
 *  (`EACCES`, `EROFS`, `ENOENT`, `ENOSPC`) so the operator can fix
 *  the mount before the first upload 500s.
 *
 *  Path precedence (matches `attachmentsRootDir()` in
 *  `src/lib/attachments/storage.ts`):
 *    1. `ATTACHMENTS_PATH` env var — a separate volume mount for
 *       receipts; useful if receipt files will dwarf the DB.
 *    2. `<dirname(SQLITE_PATH)>/attachments` — the default, which
 *       keeps receipts beside the SQLite file so one `/data` mount
 *       covers both.
 */
export function AttachmentsStorePanel() {
  const { data, error, isLoading, mutate } = useSwrJson<AttachmentsHealth>(
    "/api/settings/attachments-health",
  );
  const probing = isLoading;

  return (
    <div className="rounded-xl border bg-card">
      <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-medium">Attachments store</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Where encrypted receipt files land on disk. Checked on
            load with a write + read + delete probe.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void mutate()}
          disabled={probing}
          aria-label="Re-run probe"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", probing && "animate-spin")} />
          <span className="ml-1.5">Re-check</span>
        </Button>
      </div>

      <div className="px-4 py-3 space-y-3">
        <div className="flex items-start gap-2">
          <FolderOpen className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">Path</div>
            <code className="text-sm font-mono break-all">
              {data?.path ?? (probing ? "Checking…" : "—")}
            </code>
            <p className="text-[11px] text-muted-foreground mt-1">
              Override with the <code>ATTACHMENTS_PATH</code> env
              var to mount receipts on a separate volume.
            </p>
          </div>
        </div>

        {error ? (
          <ProbeBanner tone="error">
            Couldn&apos;t reach the health endpoint. The server may still
            be booting — try Re-check in a moment.
          </ProbeBanner>
        ) : probing ? (
          <ProbeBanner tone="muted">Probing the attachments store…</ProbeBanner>
        ) : data?.ok ? (
          <ProbeBanner tone="ok">
            Write + read + delete round-trip succeeded. Receipt
            uploads should land here cleanly.
          </ProbeBanner>
        ) : data ? (
          <ProbeBanner tone="error">
            <strong className="font-medium">
              Probe failed{data.stage ? ` at ${data.stage}` : ""}.
            </strong>{" "}
            Receipt uploads will 500 until this is fixed.
            <p className="mt-1 text-xs">{data.error}</p>
          </ProbeBanner>
        ) : null}
      </div>
    </div>
  );
}

function ProbeBanner({
  tone,
  children,
}: {
  tone: "ok" | "error" | "muted";
  children: React.ReactNode;
}) {
  const Icon =
    tone === "ok" ? CheckCircle2 : tone === "error" ? AlertTriangle : RefreshCw;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        tone === "ok"
          ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-900 dark:text-emerald-200"
          : tone === "error"
            ? "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100"
            : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
