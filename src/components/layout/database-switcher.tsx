"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ChevronDown, Database as DatabaseIcon, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

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

/** Sidebar database switcher. Compact pill that surfaces the active
 *  profile's label + a chevron; expands to a dropdown listing every
 *  registered profile + a "Create new database" entry.
 *
 *  Picking another profile POSTs to `/api/databases/switch` (which
 *  locks the current connection + writes the new active pointer to
 *  the registry) and navigates to `/unlock` so the operator enters
 *  the passphrase for the now-active profile. Re-unlock-on-switch
 *  semantics per the user spec — no in-memory key cache. */
export function DatabaseSwitcher() {
  const router = useRouter();
  const { data, mutate } = useSWR<DatabasesResponse>(
    "/api/databases",
    fetcher,
  );
  const [createOpen, setCreateOpen] = useState(false);

  if (!data) {
    return (
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-muted-foreground"
        disabled
      >
        <DatabaseIcon className="h-3.5 w-3.5" />
        <span className="truncate">Loading…</span>
      </button>
    );
  }

  async function switchTo(id: string) {
    if (id === data?.activeProfileId) return;
    const res = await fetch("/api/databases/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Switch failed");
      return;
    }
    // Force a hard refresh — the proxy will see the locked state +
    // bounce to /unlock. Using router.replace lets the page-level
    // SWR caches reload against the new active profile after unlock.
    router.replace("/unlock");
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex w-full items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5 text-xs hover:bg-muted transition-colors text-left"
          title="Active database — click to switch or create another"
        >
          <DatabaseIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate font-medium">
            {data.activeProfile?.label ?? "Default"}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {data.profiles.map((p) => {
            const isActive = p.id === data.activeProfileId;
            return (
              <DropdownMenuItem
                key={p.id}
                // base-ui's Menu.Item uses `onClick` (not `onSelect` —
                // that's the Radix idiom). The previous `onSelect`
                // prop silently did nothing, so picking a profile
                // (or "Create new database") was a no-op.
                onClick={() => switchTo(p.id)}
                // aria-current="page" surfaces the active selection to
                // assistive tech — visual cues (bold + indigo + "active"
                // pill) are duplicated semantically here.
                aria-current={isActive ? "page" : undefined}
                className={
                  isActive
                    ? "font-medium text-indigo-600 dark:text-indigo-400"
                    : ""
                }
              >
                <DatabaseIcon className="h-3.5 w-3.5 mr-2" />
                <span className="truncate">{p.label}</span>
                {isActive && (
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                    active
                  </span>
                )}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-2" />
            <span>Create new database…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateDatabaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          // The POST switched the active pointer AND auto-unlocked
          // the new file with the same passphrase, so we can drop
          // straight onto the dashboard. SWR refresh repopulates
          // every account / category / etc. against the new DB.
          mutate();
          router.replace("/dashboard");
          router.refresh();
        }}
      />
    </>
  );
}

function CreateDatabaseDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [label, setLabel] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setLabel("");
    setPassphrase("");
    setConfirmPassphrase("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      toast.error("Label is required");
      return;
    }
    if (passphrase.length < 1) {
      toast.error("Passphrase is required");
      return;
    }
    if (passphrase !== confirmPassphrase) {
      toast.error("Passphrases do not match");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/databases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: trimmedLabel, passphrase }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Create failed");
      return;
    }
    toast.success(`Created "${trimmedLabel}" — re-enter the passphrase to unlock it.`);
    reset();
    onOpenChange(false);
    onCreated();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create new database</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="db-label">Label</Label>
            <Input
              id="db-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Business, Family Vacation, Test"
              required
              autoFocus
              disabled={busy}
              maxLength={80}
            />
            <p className="text-[11px] text-muted-foreground">
              Display name only. The file on disk gets a generated id-based
              name; rename freely from Settings later.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="db-passphrase">Passphrase</Label>
            <Input
              id="db-passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="new-password"
              required
              disabled={busy}
            />
            <p className="text-[11px] text-muted-foreground">
              Encrypts this database independently from your other ones.
              Lose it and the data is unrecoverable — no recovery flow.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="db-passphrase-confirm">Confirm passphrase</Label>
            <Input
              id="db-passphrase-confirm"
              type="password"
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              autoComplete="new-password"
              required
              disabled={busy}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" variant="indigo" disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
