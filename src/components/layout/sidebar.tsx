"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { compareSemver } from "@/lib/semver-compare";
import {
  LayoutDashboard,
  ArrowLeftRight,
  CalendarClock,
  Calendar,
  BarChart3,
  Coffee,
  Tag,
  Settings,
  TrendingUp,
  PiggyBank,
  Wallet,
  Menu,
  Plus,
  X,
  Lock,
  Loader2,
} from "lucide-react";
import { useAccountFilter } from "@/hooks/use-account-filter";
import { useAddCategory } from "@/hooks/use-add-category-dialog";
import { useAddScheduled } from "@/hooks/use-add-scheduled-dialog";
import { useAddTransaction } from "@/hooks/use-add-transaction-dialog";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { useLockDatabase } from "@/hooks/use-lock-database";
import { DatabaseSwitcher } from "./database-switcher";
import { SidebarAccounts } from "./sidebar-accounts";
import { APP_VERSION } from "@/lib/version";

/** Square icon button anchored to the right of a nav row — used for
 * the per-row affordances (import next to Transactions, add-category
 * next to Categories). The bordered square reads as "click me", not
 * just a hover-only icon, so the action is discoverable without
 * hovering. */
const NAV_AFFORDANCE_CLS =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/scheduled", label: "Scheduled", icon: CalendarClock },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/investments", label: "Investments", icon: TrendingUp },
  { href: "/superannuation", label: "Super", icon: PiggyBank },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/categories", label: "Categories", icon: Tag },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { ids } = useAccountFilter();
  const { open: openAddCategory } = useAddCategory();
  const { open: openAddScheduled } = useAddScheduled();
  const { open: openAddTransaction } = useAddTransaction();
  const { lock: lockDb, locking } = useLockDatabase();
  const { prefs } = useDisplayPrefs();

  // Hide /investments and /superannuation links when the matching
  // feature flag is off. Settings → Features owns the toggle.
  const visibleNav = NAV.filter((item) => {
    if (item.href === "/investments") return prefs.featureInvestments;
    if (item.href === "/superannuation") return prefs.featureSuper;
    return true;
  });

  // Carry the global account filter across navigation so clicking a nav link
  // doesn't drop the selection. The hook also restores from localStorage on
  // mount as a fallback, but injecting the query into hrefs avoids a flash
  // of unfiltered data on the destination page.
  const navQuery = ids.length > 0 ? `?accountIds=${ids.join(",")}` : "";

  return (
    <>
      {/* Mobile top bar */}
      <div data-print-hide className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center gap-3 px-4 h-14 border-b bg-background">
        <button
          onClick={() => setOpen(true)}
          className="p-1 -ml-1 text-muted-foreground hover:text-foreground"
          aria-label="Open menu"
        >
          <Menu className="h-6 w-6" />
        </button>
        <Image
          src="/logo.png"
          alt=""
          width={32}
          height={20}
          className="h-5 w-auto"
          priority
        />
        <span className="font-semibold text-lg tracking-tight">Budgets</span>
      </div>

      {/* Backdrop */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        data-print-hide
        className={cn(
          "flex flex-col w-60 border-r bg-background h-screen fixed top-0 left-0 z-50 transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="px-4 py-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Image
                src="/logo.png"
                alt=""
                width={40}
                height={24}
                className="h-6 w-auto"
                priority
              />
              <span className="font-semibold text-lg tracking-tight">Budgets</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="lg:hidden p-1 -mr-1 text-muted-foreground hover:text-foreground"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <DatabaseSwitcher />
        </div>
        <nav className="flex-1 py-4 overflow-y-auto">
          {visibleNav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <div
                key={href}
                className={cn(
                  "flex items-center group pr-3",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Link
                  href={`${href}${navQuery}`}
                  onClick={() => setOpen(false)}
                  className="flex flex-1 items-center gap-3 px-6 py-2.5 text-sm font-medium transition-colors"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </Link>
                {href === "/transactions" && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openAddTransaction();
                      setOpen(false);
                    }}
                    title="Add transaction"
                    aria-label="Add transaction"
                    className={NAV_AFFORDANCE_CLS}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
                {href === "/categories" && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openAddCategory();
                      setOpen(false);
                    }}
                    title="Add category"
                    aria-label="Add category"
                    className={NAV_AFFORDANCE_CLS}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
                {href === "/scheduled" && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openAddScheduled();
                      setOpen(false);
                    }}
                    title="New scheduled transaction"
                    aria-label="New scheduled transaction"
                    className={NAV_AFFORDANCE_CLS}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}

          <div className="mx-3 my-3 border-t" />
          <SidebarAccounts onPick={() => setOpen(false)} />
        </nav>

        {/* Support link. The project is free, self-hostable, and
            developed in spare time; the Buy Me a Coffee link is the
            only ask. Sat above the version footer so it's discoverable
            but doesn't crowd the primary nav. */}
        <div className="px-6 pt-3 pb-1">
          <Link
            href="https://buymeacoffee.com/budgets"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
          >
            <Coffee className="h-3.5 w-3.5" />
            <span>Buy me a coffee</span>
          </Link>
        </div>

        {/* Release tag above the footer actions so the operator can
            see what build they're on (matches the image / GitHub tag
            we cut). Subtle styling — it's reference info, not a CTA.
            When /api/version-check finds a newer tag on GHCR, the
            "New release" line slips in underneath, tinted so it
            draws the eye but doesn't shout. */}
        <VersionFooter />

        {/* Footer actions: drop the SQLCipher key (everyone bounces to
            /unlock) and sign out (clears the auth cookie). Kept at the
            bottom of the sidebar so they're always reachable without
            scrolling past the account list. */}
        <div className="py-1">
          <button
            type="button"
            onClick={lockDb}
            disabled={locking}
            className="flex w-full items-center justify-center gap-3 px-6 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {locking ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <Lock className="h-4 w-4 shrink-0" />
            )}
            Lock database
          </button>
        </div>
      </aside>
    </>
  );
}

const versionFetcher = (url: string) => fetch(url).then((r) => r.json());

/** Sidebar footer block: current version, plus a tinted "New
 * release" line when /api/version-check reports a higher tag on
 * GHCR. Hidden entirely when on the latest, errored, or the
 * upstream couldn't be queried — keeps the footer quiet for the
 * common case. */
function VersionFooter() {
  const { data } = useSWR<{ latest?: string; error?: string }>(
    "/api/version-check",
    versionFetcher,
    {
      // Hourly refresh — the endpoint itself caches with
      // revalidate:3600, so this is just SWR's wake-up cadence on
      // the client.
      refreshInterval: 60 * 60 * 1000,
      revalidateOnFocus: false,
      // Don't surface upstream failures as console errors; the
      // endpoint already returns `{ error }` rather than HTTP 5xx
      // for the "couldn't query" case.
      shouldRetryOnError: false,
    },
  );
  const latest = data?.latest ?? null;
  const hasUpdate =
    !!latest && compareSemver(APP_VERSION, latest) < 0;
  return (
    <div className="border-t px-6 pt-3 pb-1 text-center text-[10px] uppercase tracking-wider text-muted-foreground/60 tabular-nums">
      <Link
        href={`https://github.com/budgets-au/budgets/releases/tag/v${APP_VERSION}`}
        target="_blank"
        rel="noopener noreferrer"
        title="View release notes on GitHub"
        className="hover:text-foreground transition-colors"
      >
        v{APP_VERSION}
      </Link>
      {hasUpdate && (
        <Link
          href="https://github.com/budgets-au/budgets/pkgs/container/budgets"
          target="_blank"
          rel="noopener noreferrer"
          className="block mt-0.5 text-emerald-600 hover:text-emerald-500 transition-colors"
        >
          New release
        </Link>
      )}
    </div>
  );
}
