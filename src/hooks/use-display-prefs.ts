"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DISPLAY_PREFS_DEFAULT,
  DISPLAY_PREFS_STORAGE_KEY,
  parseDisplayPrefs,
  type DisplayPrefs,
} from "@/lib/display-prefs";

/** React hook around the display-prefs blob. Defaults render on the
 * server and on first client mount (so SSR and the initial client
 * tree match — see feedback_hydration_localstorage), then a
 * useEffect re-reads from storage and re-renders if the stored value
 * differs from the defaults. */
export function useDisplayPrefs(): {
  prefs: DisplayPrefs;
  setPref: <K extends keyof DisplayPrefs>(key: K, value: DisplayPrefs[K]) => void;
} {
  const [prefs, setPrefs] = useState<DisplayPrefs>(DISPLAY_PREFS_DEFAULT);

  useEffect(() => {
    const stored = parseDisplayPrefs(
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(DISPLAY_PREFS_STORAGE_KEY),
    );
    setPrefs(stored);
    // Cross-tab sync: another tab toggling the setting should propagate
    // here without a refresh. Only fires for changes from OTHER tabs;
    // same-tab writes go through setPref directly.
    function onStorage(e: StorageEvent) {
      if (e.key !== DISPLAY_PREFS_STORAGE_KEY) return;
      setPrefs(parseDisplayPrefs(e.newValue));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPref = useCallback(
    <K extends keyof DisplayPrefs>(key: K, value: DisplayPrefs[K]) => {
      setPrefs((cur) => {
        const next = { ...cur, [key]: value };
        try {
          window.localStorage.setItem(
            DISPLAY_PREFS_STORAGE_KEY,
            JSON.stringify(next),
          );
        } catch {
          /* private mode / quota — fall back to in-memory only */
        }
        return next;
      });
    },
    [],
  );

  return { prefs, setPref };
}
