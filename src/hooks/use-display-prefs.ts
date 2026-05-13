"use client";

import { useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  DISPLAY_PREFS_DEFAULT,
  DISPLAY_PREFS_STORAGE_KEY,
  parseDisplayPrefs,
  type DisplayPrefs,
} from "@/lib/display-prefs";

const fetcher = async (url: string): Promise<DisplayPrefs> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load display prefs: ${res.status}`);
  return res.json();
};

/** Hook around the DB-backed display preferences. Previously these
 * lived in per-browser localStorage and drifted whenever the
 * operator moved to a different device. They're now centrally
 * stored in `app_settings.display_prefs` so a single setting follows
 * the user across systems.
 *
 * The hook returns the same `{ prefs, setPref }` shape consumers
 * already used; the storage mechanism underneath swaps in
 * transparently. Reads land via SWR (cached, revalidated on focus),
 * writes hit PATCH /api/display-prefs and optimistically update the
 * cache so toggles feel instant. */
export function useDisplayPrefs(): {
  prefs: DisplayPrefs;
  setPref: <K extends keyof DisplayPrefs>(key: K, value: DisplayPrefs[K]) => void;
} {
  const { data, mutate } = useSWR<DisplayPrefs>(
    "/api/display-prefs",
    fetcher,
    {
      revalidateOnFocus: true,
      fallbackData: { ...DISPLAY_PREFS_DEFAULT },
    },
  );
  const prefs = data ?? DISPLAY_PREFS_DEFAULT;

  // One-time migration: if the server's blob is still all-default
  // (i.e. a fresh install) AND the local browser has a legacy
  // localStorage blob from before the DB-backed switch, push that
  // blob to the server so the operator doesn't re-configure from
  // scratch on first run.
  const migrationRanRef = useRef(false);
  useEffect(() => {
    if (migrationRanRef.current) return;
    if (typeof window === "undefined") return;
    if (!data) return; // wait for first fetch
    migrationRanRef.current = true;
    try {
      const stored = window.localStorage.getItem(DISPLAY_PREFS_STORAGE_KEY);
      if (!stored) return;
      const fromLocal = parseDisplayPrefs(stored);
      // Only push if the server's value differs from defaults in
      // none of the keys, and the local has at least one non-default
      // override — otherwise we'd overwrite an intentional change
      // someone made on another device.
      const serverAny = data as unknown as Record<string, unknown>;
      const localAny = fromLocal as unknown as Record<string, unknown>;
      const defaultAny = DISPLAY_PREFS_DEFAULT as unknown as Record<string, unknown>;
      const serverIsDefaults = Object.keys(defaultAny).every(
        (k) => serverAny[k] === defaultAny[k],
      );
      const localHasOverride = Object.keys(defaultAny).some(
        (k) => localAny[k] !== defaultAny[k],
      );
      if (!serverIsDefaults || !localHasOverride) return;
      void fetch("/api/display-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fromLocal),
      }).then((r) => {
        if (r.ok) void mutate(fromLocal, { revalidate: false });
      });
    } catch {
      /* ignore — private mode, blocked storage, etc. */
    }
  }, [data, mutate]);

  const setPref = useCallback(
    <K extends keyof DisplayPrefs>(key: K, value: DisplayPrefs[K]) => {
      const next = { ...prefs, [key]: value };
      // Optimistic update so toggles feel instant; SWR will reconcile
      // with the server response on success. On any non-2xx response
      // the optimistic data rolls back (the toggle visibly snaps
      // back) AND a toast surfaces the failure — silently dropping
      // saves was a long-standing source of "why didn't my hide
      // stick?" reports.
      void mutate(
        async () => {
          const res = await fetch("/api/display-prefs", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [key]: value }),
          });
          if (!res.ok) {
            const detail = await res.text().catch(() => "");
            console.error(
              `[display-prefs] PATCH ${key} → ${res.status}`,
              detail,
            );
            toast.error(
              `Couldn't save preference (${res.status}). Check console for details.`,
            );
            throw new Error(`PATCH /api/display-prefs ${res.status}`);
          }
          return (await res.json()) as DisplayPrefs;
        },
        { optimisticData: next, rollbackOnError: true, revalidate: false },
      );
    },
    [prefs, mutate],
  );

  return { prefs, setPref };
}
