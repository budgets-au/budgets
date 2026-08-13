import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Viewport-bounded scroll container for a wide and/or long table.
 *
 *  Solves three things at once, which is why it's worth sharing:
 *
 *   1. **The horizontal scrollbar stays reachable.** An unbounded
 *      wrapper puts it at the bottom of the whole table, which on a
 *      long report is far below the fold — you had to scroll to the
 *      end of the data to move the columns.
 *   2. **`sticky top-0` on the `thead` actually works.** Sticky
 *      resolves against the nearest scroll container; with no height
 *      bound that container's own top scrolls away with the page, so
 *      the header went with it.
 *   3. **One rhythm.** Before this, of 21 tables in the app exactly
 *      two were bounded and sticky, one had a sticky first column but
 *      no sticky header (which reads as broken), and the rest had
 *      neither.
 *
 *  Consumers still own their `<thead>` / first-column sticky classes —
 *  this only provides the container those classes need to work
 *  against. Print drops the bound entirely so long tables paginate.
 *
 *  `--table-chrome` (default 180px) is the vertical chrome above the
 *  table: Topbar 56 + sticky filter bar ~48 + any page-level rows.
 *  Override it per page if the real chrome differs. */
export function TableScroller({
  children,
  maxWidth,
  className,
}: {
  children: ReactNode;
  /** Constrain the container's width — e.g. `max-w-3xl` for a
   *  narrow-column summary table that would look stranded at full
   *  page width. Pair with `mx-auto` via `className` if centring. */
  maxWidth?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative rounded-lg border overflow-auto overscroll-contain",
        "max-h-[calc(100dvh-var(--table-chrome,180px))]",
        "print:overflow-visible print:max-h-none",
        maxWidth,
        className,
      )}
      // `stable` keeps the layout from shifting by the scrollbar's
      // width when content grows past the bound.
      style={{ scrollbarGutter: "stable" }}
    >
      {children}
    </div>
  );
}
