"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  HardDrive,
  Loader2,
  RefreshCcw,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";

interface BackupEntry {
  filename: string;
  type: "manual" | "scheduled" | "pre-restore";
  size: number;
  mtime: string;
}

interface ListResponse {
  backups: BackupEntry[];
  schedule: { enabled: boolean; intervalDays: number; retain: number; lastRunAt: string | null };
  disk?: { totalBytes: number; freeBytes: number };
}

function formatGiB(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GiB`;
}

const TYPE_LABEL: Record<BackupEntry["type"], string> = {
  manual: "Manual",
  scheduled: "Scheduled",
  "pre-restore": "Pre-restore",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(d)} ${d.toLocaleTimeString()}`;
}

export function BackupList() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupEntry | "upload" | null>(
    null,
  );
  const confirm = useConfirm();
  const router = useRouter();

  async function load() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/backup", { cache: "no-store" });
      const text = await res.text();
      let body: ListResponse | { error?: string };
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`);
      }
      if (!res.ok) {
        throw new Error(("error" in body && body.error) || "Failed to load backups");
      }
      setData(body as ListResponse);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function takeNow() {
    setBusy("create");
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Backup failed");
      toast.success("Manual backup created");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function deleteOne(entry: BackupEntry) {
    const ok = await confirm({
      title: "Delete backup?",
      description: `Permanently delete ${entry.filename}. This can't be undone.`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    setBusy(entry.filename);
    try {
      const res = await fetch(
        `/api/backup/${encodeURIComponent(entry.filename)}`,
        { method: "DELETE" },
      );
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Delete failed");
      toast.success("Deleted");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="font-medium">Backups</h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setRestoreTarget("upload")}
            disabled={busy !== null}
          >
            <Upload className="mr-1 h-3.5 w-3.5" /> Restore from file
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={load}
            disabled={refreshing || busy !== null}
            aria-label="Refresh"
          >
            <RefreshCcw
              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={takeNow}
            disabled={busy !== null}
          >
            {busy === "create" ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <HardDrive className="mr-1 h-3.5 w-3.5" />
            )}
            Backup now
          </Button>
        </div>
      </div>
      {data?.disk && (() => {
        const freePct = (data.disk.freeBytes / data.disk.totalBytes) * 100;
        const tone =
          freePct < 5 ? "bg-red-500" : freePct < 15 ? "bg-amber-500" : "bg-emerald-500";
        return (
          <div className="border-b px-3 py-2 space-y-1">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Disk free</span>
              <span className="tabular-nums normal-case tracking-normal">
                {formatGiB(data.disk.freeBytes)} of {formatGiB(data.disk.totalBytes)} · {freePct.toFixed(1)}%
              </span>
            </div>
            <div
              className="h-1 rounded bg-muted overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(freePct)}
              aria-label="Disk free space"
            >
              <div className={`h-full ${tone}`} style={{ width: `${freePct}%` }} />
            </div>
          </div>
        );
      })()}
      {!data ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : data.backups.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          No backups yet. Click "Backup now" to take the first one.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-right font-medium">Size</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.backups.map((b) => (
                <tr key={b.filename} className="hover:bg-muted/30">
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {formatStamp(b.mtime)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                      {TYPE_LABEL[b.type]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatSize(b.size)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <a
                        href={`/api/backup/${encodeURIComponent(b.filename)}/download`}
                        className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Download"
                      >
                        <Download className="h-3 w-3" />
                      </a>
                      <button
                        type="button"
                        onClick={() => setRestoreTarget(b)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        disabled={busy !== null}
                        title="Restore"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteOne(b)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:bg-red-500/10 hover:text-red-600"
                        disabled={busy !== null}
                        title="Delete"
                      >
                        {busy === b.filename ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RestoreDialog
        target={restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onSuccess={() => router.replace("/unlock")}
      />
    </div>
  );
}

function RestoreDialog({
  target,
  onClose,
  onSuccess,
}: {
  target: BackupEntry | "upload" | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const open = target !== null;
  const isUpload = target === "upload";
  const [passphrase, setPassphrase] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPassphrase("");
      setConfirmText("");
      setFile(null);
      setError(null);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (confirmText !== "REPLACE") {
      setError("Type REPLACE to confirm.");
      return;
    }
    if (!passphrase) {
      setError("Passphrase is required.");
      return;
    }
    if (isUpload && !file) {
      setError("Choose a backup file to upload.");
      return;
    }
    setBusy(true);
    try {
      let res: Response;
      if (isUpload && file) {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("passphrase", passphrase);
        res = await fetch("/api/backup/restore", { method: "POST", body: fd });
      } else if (target && target !== "upload") {
        res = await fetch("/api/backup/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: target.filename, passphrase }),
        });
      } else {
        return;
      }
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Restore failed");
      }
      toast.success("Restore complete — re-unlock with the backup's passphrase.");
      onClose();
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {isUpload ? "Restore from uploaded file" : "Restore backup"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Replaces the live database with this backup. A{" "}
            <code className="rounded bg-muted px-1">pre-restore</code>{" "}
            snapshot is taken first so you can roll back. Enter the
            passphrase that was active when this backup was taken — if
            you've rotated since, that's the OLD passphrase.
          </p>
          {!isUpload && target && (
            <p className="rounded-md bg-muted/40 px-3 py-2 text-xs">
              <span className="text-muted-foreground">File: </span>
              <span className="font-mono">{target.filename}</span>
            </p>
          )}
          {isUpload && (
            <div className="space-y-1">
              <Label htmlFor="restore-file" className="text-xs">
                Backup file (.sqlite)
              </Label>
              <Input
                id="restore-file"
                type="file"
                accept=".sqlite,application/octet-stream"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
              />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="restore-pass" className="text-xs">
              Backup's passphrase
            </Label>
            <Input
              id="restore-pass"
              type="password"
              autoComplete="off"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="restore-confirm" className="text-xs">
              Type <span className="font-mono">REPLACE</span> to confirm
            </Label>
            <Input
              id="restore-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              required
            />
          </div>
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Restoring…" : "Restore"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
