"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { useSwrJson } from "@/hooks/use-swr-json";
import { mutate as globalMutate } from "swr";
import { formatDate } from "@/lib/utils";

interface KeyRow {
  id: string;
  name: string;
  role: "admin" | "member";
  createdAt: string;
  lastUsedAt: string | null;
}

/** Settings → Security → API keys. Admin-only surface for minting
 *  and revoking long-lived Bearer tokens for programmatic access.
 *
 *  The plaintext key is shown ONCE at creation — a modal-ish panel
 *  appears with the value and a copy button, then vanishes as soon
 *  as the operator confirms they've stored it. There's no "reveal
 *  again" affordance because we don't have the plaintext to reveal
 *  (only its SHA-256 lives in the DB). Losing the key means
 *  revoking + re-creating.
 *
 *  Revoke is a hard delete — a leaked key needs to stop working
 *  immediately, not be soft-flagged. */
export function ApiKeysPanel() {
  const confirm = useConfirm();
  const { data = [], isLoading } = useSwrJson<KeyRow[]>(
    "/api/settings/api-keys",
  );
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<{
    name: string;
    key: string;
  } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the key a name (e.g. “home assistant”).");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, role: "admin" }),
      });
      if (!res.ok) {
        toast.error("Failed to mint key");
        return;
      }
      const created = (await res.json()) as KeyRow & { key: string };
      setJustCreated({ name: created.name, key: created.key });
      setName("");
      void globalMutate("/api/settings/api-keys");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(row: KeyRow) {
    const ok = await confirm({
      title: `Revoke "${row.name}"?`,
      description:
        "Every client using this key immediately loses access. The row is " +
        "hard-deleted — there's no way to unrevoke. Mint a new key if you " +
        "need to restore access.",
      confirmLabel: "Revoke",
      tone: "destructive",
    });
    if (!ok) return;
    setRevokingId(row.id);
    try {
      const res = await fetch(`/api/settings/api-keys/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("Revoke failed");
        return;
      }
      toast.success(`Revoked “${row.name}”`);
      void globalMutate("/api/settings/api-keys");
    } finally {
      setRevokingId(null);
    }
  }

  async function copyKey(k: string) {
    try {
      await navigator.clipboard.writeText(k);
      toast.success("Key copied to clipboard");
    } catch {
      toast.error("Clipboard write blocked — copy the value manually");
    }
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-medium">API keys</h2>
      </div>
      <div className="divide-y">
        <div className="px-4 py-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Long-lived bearer tokens for programmatic access. Present via
            the <code className="font-mono text-[11px]">Authorization: Bearer bk_&hellip;</code>{" "}
            header on any API call. Every key issued here has admin scope
            — keep them treated as passphrases. Revoked keys stop working
            immediately.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
              placeholder="Label (e.g. home assistant)"
              className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={creating}
              maxLength={64}
            />
            <Button
              type="button"
              size="sm"
              onClick={create}
              disabled={creating || !name.trim()}
            >
              {creating ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <KeyRound className="mr-1 h-3.5 w-3.5" />
              )}
              Create
            </Button>
          </div>
        </div>

        {justCreated && (
          <div className="px-4 py-3 bg-emerald-500/10 border-t border-b border-emerald-500/30 space-y-2">
            <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
              Key created — copy it now. This is the only time it will be
              shown.
            </p>
            <div className="flex items-center gap-2 rounded-md border bg-background/60 px-2 py-1.5">
              <code className="flex-1 text-[11px] font-mono break-all">
                {justCreated.key}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => copyKey(justCreated.key)}
              >
                <Copy className="mr-1 h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
            <button
              type="button"
              onClick={() => setJustCreated(null)}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              I&rsquo;ve stored the key — dismiss.
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="px-4 py-4 text-xs text-muted-foreground">
            Loading&hellip;
          </div>
        ) : data.length === 0 ? (
          <div className="px-4 py-4 text-xs text-muted-foreground">
            No keys yet. Create one above to get started.
          </div>
        ) : (
          data.map((row) => (
            <div
              key={row.id}
              className="flex items-start justify-between gap-3 px-4 py-3"
            >
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-sm font-medium truncate">{row.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  Created {formatDate(row.createdAt)} · last used{" "}
                  {row.lastUsedAt ? formatDate(row.lastUsedAt) : "never"}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => revoke(row)}
                disabled={revokingId === row.id}
                className="shrink-0 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
              >
                {revokingId === row.id ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                )}
                Revoke
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
