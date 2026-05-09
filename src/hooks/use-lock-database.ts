"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm-dialog";

/**
 * Shared "lock the SQLCipher key now" action. Confirms with the
 * user, POSTs to /api/lock, and routes to /unlock so the proxy's
 * locked-redirect kicks in immediately on the same tab.
 *
 * Used by Settings → Security and the sidebar footer; keep the
 * messaging in one place so future copy tweaks don't drift.
 */
export function useLockDatabase() {
  const router = useRouter();
  const confirm = useConfirm();
  const [locking, setLocking] = useState(false);

  async function lock() {
    const ok = await confirm({
      title: "Lock the database?",
      description:
        "Drops the in-memory passphrase. Every device using this server will be bounced to /unlock until someone re-enters it.",
      confirmLabel: "Lock",
      tone: "destructive",
    });
    if (!ok) return;
    setLocking(true);
    try {
      const res = await fetch("/api/lock", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Lock failed");
      }
      router.replace("/unlock");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setLocking(false);
    }
  }

  return { lock, locking };
}
