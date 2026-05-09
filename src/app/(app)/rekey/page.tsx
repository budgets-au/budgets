"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Auth-gated form for rotating the SQLCipher passphrase. Validates the
 * current passphrase server-side (same path as /api/unlock) and then
 * issues PRAGMA rekey to re-encrypt every page. The live session keeps
 * working — only future cold starts need the new passphrase.
 */
export default function RekeyPage() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError("New passphrase and confirmation don't match.");
      return;
    }
    if (next.length < 8) {
      setError("New passphrase must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/rekey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const data: { ok?: boolean; error?: string } = await res.json();
      if (res.ok && data.ok) {
        setDone(true);
        setCurrent("");
        setNext("");
        setConfirm("");
        return;
      }
      setError(data.error ?? "Rekey failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Topbar title="Change passphrase" />
      <div className="mx-auto max-w-md p-4 lg:p-6">
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-xs text-muted-foreground">
              Re-encrypts the database file in place with a new
              passphrase. Existing sessions stay open; only future cold
              starts need the new value. <strong>Save the new
              passphrase before submitting</strong> — losing it means
              losing access to the data.
            </p>

            {done ? (
              <div className="space-y-3">
                <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  Passphrase rotated. The new value is required for the
                  next server restart.
                </p>
                <button
                  type="button"
                  onClick={() => router.push("/dashboard")}
                  className="w-full rounded-md border bg-background py-2 text-sm font-medium hover:bg-muted"
                >
                  Back to dashboard
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1">
                  <label
                    htmlFor="current"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Current passphrase
                  </label>
                  <input
                    id="current"
                    type="password"
                    autoComplete="current-password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    disabled={busy}
                    required
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="next"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    New passphrase
                  </label>
                  <input
                    id="next"
                    type="password"
                    autoComplete="new-password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    disabled={busy}
                    required
                    minLength={8}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="confirm"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Confirm new passphrase
                  </label>
                  <input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    disabled={busy}
                    required
                    minLength={8}
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
                  disabled={busy || !current || !next || !confirm}
                  className="w-full rounded-md bg-indigo-600 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {busy ? "Rekeying…" : "Change passphrase"}
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
