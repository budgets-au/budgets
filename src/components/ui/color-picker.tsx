"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Bite-sized colour picker: a square swatch that opens a popover
 * containing the browser's native <input type="color"> plus a hex
 * input for paste/clipboard flows. Used by the schedule-chart
 * palette editor — overkill for "pick a colour", but the native
 * popup alone is too clunky once the user wants to compare two
 * shades side by side. */
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
  const trigger = (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn(
        "h-7 w-7 rounded-md border shadow-sm transition-shadow hover:shadow disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      style={{ backgroundColor: value }}
    />
  );
  if (disabled) {
    return trigger;
  }
  return (
    <Popover>
      <PopoverTrigger render={trigger} />
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
            // Accept any-length hex while typing; only commit when
            // it parses as a valid #rrggbb literal so we don't push
            // partial junk to the prefs blob.
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
