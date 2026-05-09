"use client";

import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

/**
 * Date input for option-grant fields (service / maturation / expiry). Adds:
 *   - a × button that clears the value
 *   - an optional year-offset dropdown that calculates a date as
 *     `baseDate + N years` (1..5) so the user can express LTI-style "+1y
 *     service period" or "+3y maturation" without picking days from a
 *     calendar.
 *
 * `baseDate` is typically the grant date. Year-offset is hidden when no
 * baseDate is set.
 */
export function OptionDateInput({
  id,
  value,
  onChange,
  baseDate,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  baseDate?: string;
}) {
  function applyOffset(years: number) {
    if (!baseDate) return;
    const d = new Date(baseDate);
    if (Number.isNaN(d.getTime())) return;
    d.setFullYear(d.getFullYear() + years);
    onChange(d.toISOString().slice(0, 10));
  }

  return (
    <div className="flex gap-1 items-stretch">
      <div className="relative flex-1">
        <Input
          id={id}
          type="date" min="1900-01-01" max="2099-12-31"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-8 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label="Clear date"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {baseDate && (
        <select
          aria-label="Set date as years from grant"
          className="h-9 px-1 rounded-md border border-input bg-background text-xs shrink-0"
          value=""
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!Number.isNaN(n)) applyOffset(n);
            // reset the select so the same option can be picked again
            e.currentTarget.value = "";
          }}
        >
          <option value="">+y</option>
          <option value="1">+1y</option>
          <option value="2">+2y</option>
          <option value="3">+3y</option>
          <option value="4">+4y</option>
          <option value="5">+5y</option>
        </select>
      )}
    </div>
  );
}
