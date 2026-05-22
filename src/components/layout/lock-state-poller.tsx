"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Polls `/api/unlock` every 15s and force-navigates to `/unlock` if
 *  the server reports `unlocked: false`. Catches the case where the
 *  Node process restarted (k8s rollout, container redeploy, manual
 *  restart) while the operator had an authenticated browser session
 *  open — pre-poll the UI would happily render against a now-locked
 *  backend until the first API call returned the 3xx redirect,
 *  which only triggers on real network activity. SWR-driven views
 *  do revalidate eventually but pages without active fetches (e.g.
 *  a parked dashboard tab) would sit stale indefinitely.
 *
 *  Polling design:
 *  - 15s interval — frequent enough that a restart is noticed within
 *    one window of attention, infrequent enough that an idle tab
 *    doesn't burn cycles on the backend or the operator's bandwidth.
 *  - Skips when `document.hidden` (Page Visibility API) — a
 *    background tab doesn't need to poll. Resumes on visibility
 *    change with an immediate check so an operator returning to the
 *    tab after a restart sees the redirect promptly.
 *  - Skips the redirect when already on `/unlock` / `/login` — the
 *    redirect itself would be a no-op but the early-return keeps
 *    the network noise off those public pages.
 *  - `next=` query param preserves the destination so a successful
 *    unlock returns the operator to where they were.
 *  - Mounted once at the (app) layout boundary, so every
 *    authenticated route inherits the poll without per-page wiring. */
export function LockStatePoller() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Don't poll on the public routes — they own their own
    // unlock-state UX.
    if (pathname === "/unlock" || pathname === "/login") return;

    let cancelled = false;

    async function check() {
      if (cancelled || document.hidden) return;
      try {
        const res = await fetch("/api/unlock", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          unlocked?: boolean;
          dbExists?: boolean;
        };
        if (cancelled) return;
        if (data.unlocked === false) {
          // Carry the current location so the unlock flow returns
          // the operator where they were. Use a hard nav rather
          // than router.push because the upcoming page may render
          // against a re-keyed DB and we want the full module
          // reload anyway.
          const next = encodeURIComponent(
            window.location.pathname + window.location.search,
          );
          window.location.href = `/unlock?next=${next}`;
        }
      } catch {
        // Network blip / dev-server restart in flight — treat as
        // transient and try again on the next tick. The proxy's
        // 3xx-on-locked behaviour will catch any real action that
        // matters in the meantime.
      }
    }

    const interval = setInterval(check, 15_000);
    // Run once immediately on visibility-return so an operator who
    // tabs back in doesn't wait the full 15s.
    function onVisibility() {
      if (!document.hidden) void check();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pathname, router]);

  return null;
}
