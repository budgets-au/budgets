"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Account {
  id: string;
  isArchived: boolean;
}

/**
 * URL ↔ DB-backed multi-select for the global account filter. The URL
 * stays the source of truth within a page navigation (so views can
 * read it server-side or via `useSearchParams`); the DB-backed
 * displayPrefs blob remembers the last selection so opening the app
 * on a fresh device restores the same filter.
 *
 * "All accounts" (empty URL filter) expands to every *visible*
 * (non-archived) account, so consumers iterating `ids` never accidentally
 * pull in archived accounts. SWR dedupes the underlying /api/accounts
 * fetch across consumers, so adding this to the hook costs one request
 * per page, not one per consumer.
 */
export function useAccountFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: accounts = [] } = useSWR<Account[]>("/api/accounts", fetcher);
  const { prefs, setPref } = useDisplayPrefs();

  const urlIds = (searchParams.get("accountIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const visibleIds = accounts.filter((a) => !a.isArchived).map((a) => a.id);
  // When the URL filter is empty, expand to all visible accounts so
  // "All accounts" never silently includes archived ones. Once accounts
  // are loaded, every consumer sees an explicit list.
  const ids = urlIds.length > 0 ? urlIds : visibleIds;

  // On first mount: if the URL has no filter but we remembered one, push it
  // back into the URL so all consumers see a consistent value.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    if (urlIds.length > 0) return;
    if (prefs.globalAccountIds.length === 0) return;
    restored.current = true;
    const p = new URLSearchParams(searchParams.toString());
    p.set("accountIds", prefs.globalAccountIds.join(","));
    router.replace(`${pathname}?${p}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.globalAccountIds.join(",")]);

  // Persist whenever the URL ids change. Only the user's explicit
  // selection is stored — never the expanded "all visible" form, since
  // that would freeze the choice if accounts are added/archived later.
  //
  // SKIP the very first run on mount: the URL starts empty until the
  // restore effect above pushes the saved selection back in, so writing
  // `[]` here would clobber the saved value before restore can read it.
  const firstPersist = useRef(true);
  useEffect(() => {
    if (firstPersist.current) {
      firstPersist.current = false;
      return;
    }
    if (urlIds.join(",") === prefs.globalAccountIds.join(",")) return;
    setPref("globalAccountIds", urlIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlIds.join(",")]);

  function setIds(next: string[]) {
    const p = new URLSearchParams(searchParams.toString());
    if (next.length > 0) p.set("accountIds", next.join(","));
    else p.delete("accountIds");
    // replace, not push — toggling shouldn't pollute browser history.
    router.replace(`${pathname}?${p}`);
  }

  function toggle(id: string) {
    // Operate on the explicit URL selection — when the filter is empty
    // ("All accounts") clicking an account should switch to "only that
    // one", not "all-but-that-one".
    const set = new Set(urlIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setIds(Array.from(set));
  }

  function clear() {
    setIds([]);
  }

  return {
    /** Effective list — explicit selection or all visible. Use this for
     * API requests and any in-memory filtering. */
    ids,
    /** Raw URL selection. Use this for "is the All pill active?" /
     * "is this specific account ticked?" UI checks. */
    selectedIds: urlIds,
    /** True when no specific accounts are picked (the All pill is on). */
    allSelected: urlIds.length === 0,
    toggle,
    clear,
    setIds,
  };
}
