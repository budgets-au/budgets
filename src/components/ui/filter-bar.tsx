"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The app's one sticky filter / toolbar strip.
 *
 *  Sits flush beneath the global Topbar (`h-14`, `sticky top-0
 *  z-20`) at `top-14 z-10`, so page-level controls stay reachable
 *  while a long list or table scrolls underneath. The negative
 *  margins cancel the page wrapper's `p-4 lg:p-6` and re-apply the
 *  padding inside, which is what makes the background and bottom
 *  border run edge-to-edge instead of floating in a padded box.
 *
 *  Extracted from the Cashflow and Category reports, which had the
 *  identical class string. Before that there were three unrelated
 *  families: this one, a non-sticky inline flex row (Transactions
 *  filters, Reports date range), and a `CardHeader` variant on
 *  Scheduled — each with its own control sizing. Anything that
 *  wants to be a page-level filter strip should use this.
 *
 *  Print: hidden by default, and `print:static` so it doesn't leave
 *  a sticky gap in the printed flow. Pass `keepInPrint` for a
 *  toolbar whose content is worth printing (rare — most of these
 *  are interactive-only).
 *
 *  `align` covers the two layouts in use: `between` for a bar with
 *  a left cluster and a right cluster (Cashflow's collapse-all vs
 *  its toggles), `end` for a bar that's only controls (Category). */
export function FilterBar({
  children,
  align = "between",
  sticky = true,
  keepInPrint = false,
  innerClassName,
  className,
}: {
  children: ReactNode;
  align?: "between" | "end" | "start";
  /** Set false when something else on the page already owns the
   *  `top-14` sticky slot — two strips at the same offset overlap.
   *  On /transactions the bulk-selection action bar owns it (it
   *  appears contextually and you need it while scrolling and
   *  selecting), and on /reports the active tab's own filter bar
   *  owns it (its toggles are what you adjust mid-scroll), so the
   *  outer date-range row defers. Those pages still get the shared
   *  chrome — edge-to-edge background, bottom border, padding
   *  rhythm — just not the pinning. */
  sticky?: boolean;
  keepInPrint?: boolean;
  /** Extra classes on the inner flex row — e.g. a `max-w-*` to
   *  match a page that constrains its content width. */
  innerClassName?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "-mx-4 lg:-mx-6 px-4 lg:px-6 py-2 bg-background border-b",
        sticky && "sticky top-14 z-10",
        keepInPrint ? "print:static" : "print:hidden print:static",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-2",
          align === "between" && "justify-between",
          align === "end" && "justify-end",
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
