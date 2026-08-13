"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional longer description for the accessible name — use when
   *  the visible label is abbreviated ("Full" for "grandparent"). */
  title?: string;
}

/** The app's one segmented control: a joined row of mutually
 *  exclusive options with the selected one filled indigo.
 *
 *  Replaces four hand-rolled variants that had drifted apart across
 *  19 call sites — two shared the same markup but disagreed on the
 *  active fill (indigo vs near-black), a third used an inset-tray
 *  look, and padding came in three sizes. This takes the
 *  majority look (joined + indigo, matching the sidebar's active
 *  nav item and the project's indigo accent) at the majority
 *  padding (`px-2.5 py-1`).
 *
 *  Accessibility: `role="radiogroup"` + `role="radio"` +
 *  `aria-checked`, with a roving tabindex and arrow-key navigation.
 *  That's the correct ARIA for "pick exactly one of N", which is
 *  what this control always is — the calendar's range chips already
 *  had it right and the rest are brought up to match. Deliberately
 *  NOT `role="tablist"` (promises a `tabpanel`, and these reshape
 *  data in place rather than swapping panels) and not bare
 *  `aria-pressed` (that describes independent toggles). Use
 *  `ui/tabs.tsx` for genuine page-level tab bars — that's its job.
 *
 *  The optional `label` renders the caption most call sites paired
 *  with the control by hand (`<span className="text-xs
 *  text-muted-foreground">Plan</span>` + a flex wrapper), so the
 *  whole label-plus-control unit collapses into one element. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  ariaLabel,
  size = "default",
  className,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  /** Visible caption to the left of the control. */
  label?: string;
  /** Accessible name for the group. Falls back to `label`; supply
   *  this when there's no visible caption. */
  ariaLabel?: string;
  /** `compact` for controls that sit inside a CardHeader beside a
   *  CardTitle, where the default scale crowds the heading. Same
   *  visual language either way — only the type size and padding
   *  change, so the two read as one control at two scales rather
   *  than as two different components. */
  size?: "default" | "compact";
  className?: string;
}) {
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /** Arrow keys move the selection and follow it with focus — the
   *  standard radiogroup interaction. Wraps at both ends. Home/End
   *  jump to the first/last option. */
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const idx = options.findIndex((o) => o.value === value);
    if (idx === -1) return;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (idx + 1) % options.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (idx - 1 + options.length) % options.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = options.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    onChange(options[next].value);
    btnRefs.current[next]?.focus();
  }

  const group = (
    <div
      role="radiogroup"
      aria-label={ariaLabel ?? label}
      onKeyDown={onKeyDown}
      className={cn(
        "flex rounded-md border overflow-hidden",
        size === "compact" ? "text-[11px]" : "text-xs",
        // `widget-cancel-drag` so react-grid-layout doesn't swallow
        // the click when one of these sits inside a dashboard widget
        // in edit mode. Harmless everywhere else.
        "widget-cancel-drag",
        className,
      )}
    >
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            // Roving tabindex: the group is one Tab stop, and arrow
            // keys move within it.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt.value)}
            title={opt.title}
            className={cn(
              "transition-colors",
              size === "compact" ? "px-2 py-0.5" : "px-2.5 py-1",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset",
              selected
                ? "bg-indigo-600 text-white font-medium"
                : "bg-background text-muted-foreground hover:bg-muted",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );

  if (!label) return group;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {group}
    </div>
  );
}
