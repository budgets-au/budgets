"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Eraser, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm-dialog";

/** "Reset browser data" — escape hatch for stale client state.
 *
 * Drops everything we durably store on this browser:
 *   - localStorage (only key is the legacy `display-prefs` blob;
 *     `.clear()` is future-proofed against anything we may add
 *     later).
 *   - sessionStorage (nothing today; cheap to wipe defensively).
 *   - The `theme` cookie (set client-side by ThemeToggle; read
 *     server-side in the root layout for SSR theming).
 *   - NextAuth session cookies, via `signOut`.
 *
 * Server-side prefs (`app_settings.display_prefs`) are NOT
 * touched — those follow the account, not the browser. A
 * "reset my preferences" follow-up would be a separate action.
 */
export function ResetBrowserData() {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  async function reset() {
    const ok = await confirm({
      title: "Reset browser data?",
      description:
        "Signs you out of this device, drops the saved theme, and clears any legacy local data. Your saved preferences on the server are untouched.",
      confirmLabel: "Reset & sign out",
      tone: "destructive",
    });
    if (!ok) return;
    setBusy(true);
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
      document.cookie = "theme=; path=/; max-age=0; samesite=lax";
    } catch {
      /* private mode, blocked storage — fall through to signOut */
    }
    // signOut clears the NextAuth session-token cookie and lands
    // the user on /login.
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Reset browser data</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Signs you out of this device and drops anything cached
            locally — theme preference, any legacy storage, and the
            session cookie. Server-side preferences stay attached
            to your account; re-log in to pick them up.
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={reset}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Eraser className="mr-1 h-3.5 w-3.5" />
          )}
          Reset
        </Button>
      </div>
    </div>
  );
}
