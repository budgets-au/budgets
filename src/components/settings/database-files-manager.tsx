"use client";

import { useState } from "react";
import { useSwrJson } from "@/hooks/use-swr-json";
import {
  Check,
  Database as DatabaseIcon,
  EyeOff,
  Eye,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";


interface DbProfile {
  id: string;
  label: string;
  filename: string;
  createdAt: string;
  archived?: boolean;
}

interface DatabasesResponse {
  profiles: DbProfile[];
  activeProfileId: string;
  activeProfile: DbProfile;
  unlocked: boolean;
}

/** Settings → Database files. Lists every registered profile (the
 *  same set the sidebar switcher dropdown surfaces — including
 *  archived ones, which the sidebar hides) with rename, archive,
 *  and delete affordances. Filename + created-at are read-only.
 *
 *  Active-profile rules (server-side enforced in
 *  `src/lib/db-profiles.ts`):
 *    - rename: always allowed.
 *    - archive: blocked. The archive button is disabled with a
 *      tooltip suggesting the operator switch first.
 *    - delete: blocked. Same reason; plus you can't delete the
 *      last remaining profile (the app needs a DB to talk to).
 *
 *  Delete is gated by a typed-confirmation dialog — the operator
 *  has to retype the label exactly. That's the "suitable gate" for
 *  an action that wipes both the encrypted file AND every backup
 *  in its per-profile subdir. */
export function DatabaseFilesManager() {
  const { data, mutate } = useSwrJson<DatabasesResponse>(
    "/api/databases",
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DbProfile | null>(null);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  function startEdit(p: DbProfile) {
    setEditingId(p.id);
    setDraftLabel(p.label);
  }
  function cancel() {
    setEditingId(null);
    setDraftLabel("");
  }

  async function save(p: DbProfile) {
    const next = draftLabel.trim();
    if (!next) {
      toast.error("Label is required");
      return;
    }
    if (next === p.label) {
      cancel();
      return;
    }
    setSaving(true);
    const res = await fetch(
      `/api/databases/${encodeURIComponent(p.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: next }),
      },
    );
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Rename failed");
      return;
    }
    toast.success("Database renamed");
    cancel();
    mutate();
  }

  async function toggleArchive(p: DbProfile) {
    const next = !(p.archived === true);
    setArchivingId(p.id);
    const res = await fetch(
      `/api/databases/${encodeURIComponent(p.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: next }),
      },
    );
    setArchivingId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to update");
      return;
    }
    toast.success(next ? `Archived "${p.label}"` : `Restored "${p.label}"`);
    mutate();
  }

  function openDelete(p: DbProfile) {
    setDeleteTarget(p);
    setDeleteTyped("");
  }
  function closeDelete() {
    setDeleteTarget(null);
    setDeleteTyped("");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    if (deleteTyped.trim() !== deleteTarget.label) return;
    setDeleting(true);
    const res = await fetch(
      `/api/databases/${encodeURIComponent(deleteTarget.id)}`,
      { method: "DELETE" },
    );
    setDeleting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Delete failed");
      return;
    }
    toast.success(`Deleted "${deleteTarget.label}" and its backups`);
    closeDelete();
    mutate();
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="font-medium">Database files</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every registered database. Rename for clarity, archive to
            hide a DB from the sidebar switcher without losing it, or
            delete to permanently wipe the encrypted file and its
            backups. Switch to another DB first before archiving or
            deleting the active one.
          </p>
        </div>
      </div>
      {!data ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : (
        <div className="divide-y">
          {data.profiles.map((p) => {
            const isActive = p.id === data.activeProfileId;
            const isEditing = editingId === p.id;
            const isArchived = p.archived === true;
            const isOnlyProfile = data.profiles.length <= 1;
            return (
              <div
                key={p.id}
                className={`flex items-center gap-3 px-4 py-3 text-sm ${
                  isArchived ? "opacity-60" : ""
                }`}
              >
                <DatabaseIcon
                  className={`h-4 w-4 shrink-0 ${
                    isActive
                      ? "text-indigo-600 dark:text-indigo-400"
                      : "text-muted-foreground"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <Input
                      autoFocus
                      value={draftLabel}
                      onChange={(e) => setDraftLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          save(p);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancel();
                        }
                      }}
                      disabled={saving}
                      maxLength={80}
                      className="h-8"
                    />
                  ) : (
                    <p
                      className={
                        isActive
                          ? "font-medium text-indigo-600 dark:text-indigo-400"
                          : "font-medium"
                      }
                    >
                      {p.label}
                      {isActive && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                          active
                        </span>
                      )}
                      {isArchived && !isActive && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                          archived
                        </span>
                      )}
                    </p>
                  )}
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground truncate">
                    {p.filename}{" "}
                    <span className="text-muted-foreground/70">
                      · created {formatDate(new Date(p.createdAt))}
                    </span>
                  </p>
                </div>
                {isEditing ? (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={cancel}
                      disabled={saving}
                      aria-label="Cancel rename"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="indigo"
                      onClick={() => save(p)}
                      disabled={saving || !draftLabel.trim()}
                      aria-label="Save rename"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => startEdit(p)}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Rename
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => toggleArchive(p)}
                      disabled={isActive || archivingId === p.id}
                      title={
                        isActive
                          ? "Switch to another DB first"
                          : isArchived
                            ? "Show this DB in the sidebar switcher again"
                            : "Hide this DB from the sidebar switcher"
                      }
                    >
                      {isArchived ? (
                        <Eye className="h-3.5 w-3.5 mr-1" />
                      ) : (
                        <EyeOff className="h-3.5 w-3.5 mr-1" />
                      )}
                      {isArchived ? "Unarchive" : "Archive"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                      onClick={() => openDelete(p)}
                      disabled={isActive || isOnlyProfile}
                      title={
                        isActive
                          ? "Switch to another DB first"
                          : isOnlyProfile
                            ? "Can't delete the only registered database"
                            : "Permanently delete this DB and its backups"
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && closeDelete()}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete database</DialogTitle>
          </DialogHeader>
          {deleteTarget && (
            <div className="space-y-3 mt-1">
              <p className="text-sm text-muted-foreground">
                This permanently removes{" "}
                <span className="font-medium text-foreground">
                  {deleteTarget.label}
                </span>
                , its encrypted file (
                <span className="font-mono text-xs">
                  {deleteTarget.filename}
                </span>
                ), and every backup taken from it. It cannot be undone.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-delete">
                  Type{" "}
                  <span className="font-mono text-xs">
                    {deleteTarget.label}
                  </span>{" "}
                  to confirm
                </Label>
                <Input
                  id="confirm-delete"
                  autoFocus
                  value={deleteTyped}
                  onChange={(e) => setDeleteTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      deleteTyped.trim() === deleteTarget.label &&
                      !deleting
                    ) {
                      e.preventDefault();
                      confirmDelete();
                    }
                  }}
                  disabled={deleting}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={confirmDelete}
                  disabled={
                    deleting || deleteTyped.trim() !== deleteTarget.label
                  }
                  className="flex-1"
                >
                  {deleting ? "Deleting…" : "Delete permanently"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeDelete}
                  disabled={deleting}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
