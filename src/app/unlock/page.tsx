"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Database as DatabaseIcon, ChevronDown } from "lucide-react";

interface DbProfile {
  id: string;
  label: string;
}

interface DatabasesResponse {
  profiles: DbProfile[];
  activeProfileId: string;
  activeProfile: DbProfile;
}

/**
 * Public unlock page. Sits outside the (app) layout group so it never
 * tries to render account/category data — the DB is still locked when
 * it loads.
 *
 * Multi-DB-aware: surfaces the active profile's label so the operator
 * knows which database they're entering the passphrase for, plus a
 * "Switch database" expander that lists the other registered
 * profiles. Picking another one POSTs to `/api/databases/switch`
 * (whitelisted by the proxy while locked) and re-renders the form
 * against the now-active profile.
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
  const [databases, setDatabases] = useState<DatabasesResponse | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);

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

  // Load the profile list so the form knows which profile it's
  // unlocking + the switcher has options to render.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/databases")
      .then((r) => r.json())
      .then((data: DatabasesResponse) => {
        if (cancelled) return;
        if (data && Array.isArray(data.profiles)) {
          setDatabases(data);
        }
      })
      .catch(() => {
        /* ignore — single-DB fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function switchTo(id: string) {
    if (!databases || id === databases.activeProfileId) {
      setSwitcherOpen(false);
      return;
    }
    setError(null);
    const res = await fetch("/api/databases/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Switch failed");
      return;
    }
    setSwitcherOpen(false);
    setPassphrase("");
    // Re-fetch the registry + the unlock-existing state so the form
    // re-renders for the new active profile.
    const [dbsRes, unlockRes] = await Promise.all([
      fetch("/api/databases").then((r) => r.json()) as Promise<DatabasesResponse>,
      fetch("/api/unlock").then((r) => r.json()) as Promise<{
        unlocked?: boolean;
        dbExists?: boolean;
      }>,
    ]);
    if (dbsRes && Array.isArray(dbsRes.profiles)) setDatabases(dbsRes);
    if (typeof unlockRes.dbExists === "boolean") setDbExists(unlockRes.dbExists);
  }

  const activeLabel = databases?.activeProfile?.label ?? null;
  const showSwitcher =
    !!databases && databases.profiles.length > 1;

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
          {activeLabel && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <DatabaseIcon className="h-3 w-3" />
              <span>{activeLabel}</span>
            </p>
          )}
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
                the session — the key lives in this server&apos;s memory only
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
        {showSwitcher && (
          <div className="border-t pt-3 -mx-6 px-6">
            <button
              type="button"
              onClick={() => setSwitcherOpen((v) => !v)}
              className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors"
              aria-expanded={switcherOpen}
            >
              <span>Switch database</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${
                  switcherOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {switcherOpen && databases && (
              <div className="mt-2 space-y-1">
                {databases.profiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => switchTo(p.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-left transition-colors ${
                      p.id === databases.activeProfileId
                        ? "bg-indigo-600/10 font-medium text-indigo-600 dark:text-indigo-400"
                        : "hover:bg-muted"
                    }`}
                  >
                    <DatabaseIcon className="h-3 w-3 shrink-0" />
                    <span className="truncate">{p.label}</span>
                    {p.id === databases.activeProfileId && (
                      <span className="ml-auto text-[10px] uppercase tracking-wider">
                        current
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
