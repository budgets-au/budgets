"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Bite-sized colour picker: a square swatch that opens a popover
 * containing the browser's native <input type="color"> plus a hex
 * input for paste/clipboard flows. Used by the schedule-chart
 * palette editor.
 *
 * Uses PopoverTrigger directly (no `render` prop) — matching the
 * working searchable-combobox pattern. An earlier `render={...}`
 * variant didn't wire the trigger's click → popover correctly in
 * this base-ui version, so the swatch looked like a button but did
 * nothing on click. */
export function ColorPicker({
  value,
  onChange,
  ariaLabel,
  disabled,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  if (disabled) {
    return (
      <span
        aria-label={ariaLabel}
        className={cn(
          "block h-7 w-7 rounded-md border shadow-sm opacity-50",
          className,
        )}
        style={{ backgroundColor: value }}
      />
    );
  }
  return (
    <Popover>
      <PopoverTrigger
        aria-label={ariaLabel}
        className={cn(
          "h-7 w-7 rounded-md border shadow-sm transition-shadow hover:shadow",
          className,
        )}
        style={{ backgroundColor: value }}
      />
      <PopoverContent className="w-48 gap-3 p-3">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${ariaLabel} colour wheel`}
          className="h-12 w-full cursor-pointer rounded border bg-transparent p-0"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value.trim();
            // Only commit valid #rrggbb literals so partial typing
            // doesn't poison the prefs blob.
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v);
          }}
          aria-label={`${ariaLabel} hex value`}
          spellCheck={false}
          className="w-full rounded-md border bg-background px-2 py-1 font-mono text-xs uppercase focus:outline-none focus:ring-1 focus:ring-indigo-500"
          maxLength={7}
        />
      </PopoverContent>
    </Popover>
  );
}
