"use client";

import { useState } from "react";
import useSWR from "swr";
import { Check, Database as DatabaseIcon, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface DbProfile {
  id: string;
  label: string;
  filename: string;
  createdAt: string;
}

interface DatabasesResponse {
  profiles: DbProfile[];
  activeProfileId: string;
  activeProfile: DbProfile;
  unlocked: boolean;
}

/** Settings → Database files. Lists every registered profile (the
 *  same set the sidebar switcher dropdown surfaces) with rename
 *  affordances. Filename + created-at are read-only.
 *
 *  Out of scope for v1:
 *    - Delete a profile + drop its file from disk. Risky to wire
 *      until the active-profile-protection + backup-cleanup flow
 *      is designed.
 *    - Rename the filename on disk. The on-disk name is
 *      `budget-<id>.db` where <id> is the unique slug; renaming
 *      the file would orphan backups under `<base>/<id>/`. */
export function DatabaseFilesManager() {
  const { data, mutate } = useSWR<DatabasesResponse>(
    "/api/databases",
    fetcher,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="font-medium">Database files</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every registered database. The active one is highlighted;
            switch between them via the sidebar dropdown. Rename here
            for clarity — the on-disk filename never changes (it's
            derived from a stable id so backups stay attached).
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
            return (
              <div
                key={p.id}
                className="flex items-center gap-3 px-4 py-3 text-sm"
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
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => startEdit(p)}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Rename
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
