import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared vertical rhythm for the three async states. `block` is for
 *  a state that fills a card body or report panel (centred, generous
 *  padding); `inline` is for one sitting in a dense list or beside
 *  other content (left-aligned, tight). */
type StateTone = "block" | "inline";

const TONE: Record<StateTone, string> = {
  block: "py-8 text-center",
  inline: "py-2",
};

/** Loading placeholder.
 *
 *  Replaces ~32 hand-written `<p className="text-sm
 *  text-muted-foreground …">Loading…</p>` paragraphs that had
 *  drifted across nine different padding combinations and two type
 *  sizes. Copy defaults to the string 30 of those 32 already used.
 *
 *  Deliberately not a skeleton. Skeletons are worth it when you can
 *  predict the shape of the incoming content; most of these sit
 *  above tables and charts whose row count and height aren't known
 *  until the fetch lands, so a shimmer block of the wrong size reads
 *  worse than a line of text. */
export function LoadingState({
  label = "Loading…",
  tone = "block",
  size = "sm",
  className,
}: {
  label?: string;
  tone?: StateTone;
  /** `xs` for dashboard widget bodies, where the surrounding type is
   *  already one step down. */
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <p
      // aria-live so a screen reader announces the transition into
      // and out of the loading state rather than leaving the user
      // on a silently-stale region.
      aria-live="polite"
      aria-busy="true"
      className={cn(
        size === "xs" ? "text-xs" : "text-sm",
        "text-muted-foreground",
        TONE[tone],
        className,
      )}
    >
      {label}
    </p>
  );
}

/** Empty-result placeholder.
 *
 *  Standardises the container and typography, NOT the copy — the
 *  wording is genuinely per-context and should stay that way.
 *  "No transactions in this category" and "No accounts yet" answer
 *  different questions: the first says your filter matched nothing,
 *  the second says you haven't created anything. Collapsing them
 *  into one string would lose that.
 *
 *  `action` is for the nothing-created-yet case, where the useful
 *  next step is a button rather than adjusting a filter. */
export function EmptyState({
  children,
  tone = "block",
  size = "sm",
  action,
  className,
}: {
  children: ReactNode;
  tone?: StateTone;
  size?: "xs" | "sm";
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        size === "xs" ? "text-xs" : "text-sm",
        "text-muted-foreground",
        TONE[tone],
        className,
      )}
    >
      <p>{children}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

/** Fetch-failure placeholder.
 *
 *  The gap this fills: SWR read failures were silent almost
 *  everywhere. Only two components in the whole app branched on
 *  `error`, so a failed GET left the caller sitting on its loading
 *  text or an empty list forever, with no signal that anything went
 *  wrong. Toasts stay the pattern for *write* failures (99
 *  `toast.error` call sites) — those are user-initiated, so a
 *  transient notice is right. A read failure needs a persistent
 *  marker in the region that failed. */
export function ErrorState({
  label = "Couldn’t load this.",
  tone = "block",
  size = "sm",
  onRetry,
  className,
}: {
  label?: string;
  tone?: StateTone;
  size?: "xs" | "sm";
  /** Wire to SWR's `mutate()` to re-run the fetch. */
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        size === "xs" ? "text-xs" : "text-sm",
        "text-muted-foreground",
        TONE[tone],
        className,
      )}
    >
      <p>{label}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-xs underline hover:text-foreground transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
}
