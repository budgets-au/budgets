"use client";

import { useState } from "react";
import { useSwrJson } from "@/hooks/use-swr-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface KeyStatus {
  /** True when env or DB has a token set. */
  configured: boolean;
  /** Which source the resolver would use right now. */
  source: "env" | "db" | "none";
}

/** Settings panel for the Brave Search API key.
 *
 *  The key is used by the investment-detail Announcements panel as
 *  a supplemental web-source feed alongside Yahoo Finance news.
 *  Without a key, the panel runs Yahoo-only (no functional break);
 *  with a key, each headline gains a snippet and the result set
 *  broadens to non-Yahoo publishers.
 *
 *  We deliberately never show the configured key value (would leak
 *  a household-wide secret across a screen-share or screenshot). The
 *  UI shows "Configured" vs "Not configured" and an info line about
 *  whether it came from the env var (container override) or the DB
 *  (set here). Operators replacing a key just retype it.
 *
 *  Admin-gated server-side (the route requires admin auth); the
 *  panel renders for everyone but a non-admin user gets a 401
 *  from GET and the panel hides itself. */
export function BraveSearchKeyPanel() {
  const { data, mutate, error } = useSwrJson<KeyStatus>(
    "/api/settings/brave-search-key",
    { revalidateOnFocus: false },
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Member users get 401 from the admin-gated endpoint — hide the
  // panel rather than render an empty card.
  if (error) return null;
  if (!data) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  async function save(next: string | null) {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/brave-search-key", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Failed to save key");
        return;
      }
      toast.success(
        next === null
          ? "Brave Search key cleared"
          : "Brave Search key saved",
      );
      setDraft("");
      setEditing(false);
      await mutate();
    } finally {
      setSaving(false);
    }
  }

  const statusBlurb =
    data.source === "env"
      ? "Configured via BRAVE_SEARCH_API_KEY env var (overrides any value set here)."
      : data.source === "db"
        ? "Configured. Stored in this database — switch databases and you'll need to set it again."
        : "Not configured. Announcements panel runs Yahoo-only.";

  return (
    <div className="rounded-xl border bg-card">
      <div className="px-4 py-3 border-b">
        <h2 className="font-medium">Brave Search API key</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Optional. Enriches the investment-detail Announcements panel with
          web-source headlines + snippets alongside the Yahoo feed.{" "}
          <a
            href="https://api.search.brave.com/app/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Get a key
          </a>{" "}
          — free tier covers 2000 queries/month.
        </p>
      </div>
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <span
            className={
              data.configured
                ? "inline-block h-2 w-2 rounded-full bg-emerald-500"
                : "inline-block h-2 w-2 rounded-full bg-muted-foreground/40"
            }
            aria-hidden
          />
          <p className="text-sm">{statusBlurb}</p>
        </div>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              void save(draft.trim());
            }}
            className="flex flex-col gap-2"
          >
            <Input
              type="password"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="BSA…"
              aria-label="Brave Search API key"
              className="font-mono text-xs"
            />
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={saving || !draft.trim()}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setDraft("");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              {data.source === "db" ? "Replace key" : "Set key"}
            </Button>
            {data.source === "db" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-red-500/40 text-red-600 hover:bg-red-500/10 hover:text-red-700"
                disabled={saving}
                onClick={() => void save(null)}
              >
                {saving ? "Clearing…" : "Clear"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
