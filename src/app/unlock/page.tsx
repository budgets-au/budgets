"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Public unlock page. Sits outside the (app) layout group so it never
 * tries to render account/category data — the DB is still locked when
 * it loads.
 */
export default function UnlockPage() {
  const router = useRouter();
  const params = useSearchParams();
  // After a successful unlock, send the user back to wherever they
  // were trying to go before the middleware bounced them here.
  const next = params.get("next") || "/dashboard";

  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = unknown (initial fetch in flight). dbExists distinguishes
  // first-run copy from the unlock-existing case.
  const [dbExists, setDbExists] = useState<boolean | null>(null);
  const isFirstRun = dbExists === false;

  // If another tab/process already unlocked the server, skip ahead
  // immediately rather than making the user re-type.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/unlock")
      .then((r) => r.json())
      .then((data: { unlocked?: boolean; dbExists?: boolean }) => {
        if (cancelled) return;
        if (data.unlocked) {
          router.replace(next);
          return;
        }
        if (typeof data.dbExists === "boolean") {
          setDbExists(data.dbExists);
        }
      })
      .catch(() => {
        /* ignore — user can still unlock manually */
      });
    return () => {
      cancelled = true;
    };
  }, [router, next]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!passphrase) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      const data: { ok?: boolean; error?: string } = await res.json();
      if (res.ok && data.ok) {
        router.replace(next);
        return;
      }
      setError(data.error ?? "Unlock failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border bg-background p-6 shadow-sm"
      >
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <span aria-hidden>{isFirstRun ? "✨" : "🔒"}</span>{" "}
            {isFirstRun ? "Create your database" : "Unlock the database"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {isFirstRun ? (
              <>
                No encrypted database exists yet. The passphrase you set
                here creates one and becomes the only key that can open
                it. Save it in your password manager — losing it means
                losing the data.
              </>
            ) : (
              <>
                The data file is encrypted. Enter the passphrase to start
                the session — the key lives in this server's memory only
                and is forgotten when the process stops.
              </>
            )}
          </p>
        </div>
        <div className="space-y-1">
          <label
            htmlFor="passphrase"
            className="text-xs font-medium text-muted-foreground"
          >
            {isFirstRun ? "New passphrase" : "Passphrase"}
          </label>
          <input
            id="passphrase"
            type="password"
            autoComplete={isFirstRun ? "new-password" : "current-password"}
            autoFocus
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !passphrase}
          className="w-full rounded-md bg-indigo-600 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy
            ? isFirstRun
              ? "Creating…"
              : "Unlocking…"
            : isFirstRun
              ? "Create database"
              : "Unlock"}
        </button>
      </form>
    </div>
  );
}
