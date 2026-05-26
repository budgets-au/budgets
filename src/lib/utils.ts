import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatAUD(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(num);
}

/** `formatAUD` without the `A$` country prefix — just `$1,234.56`.
 *  Used by report cells, dashboard widgets, and per-row summaries
 *  where the AUD context is already established by the surrounding
 *  page so the country prefix becomes visual noise. Centralising
 *  the `.replace("A$", "$")` shortcut removes the entire class of
 *  "I forgot the .replace()" inconsistencies. */
export function formatAUDShort(amount: number | string): string {
  return formatAUD(amount).replace("A$", "$");
}

/** Cent-accurate string representation of a money amount — the
 * canonical form for storing into the `amount` text column.
 * Centralises `.toFixed(2)` so every importer / migration / API
 * writes uniform `"123.45"` / `"-123.45"` strings instead of
 * mixing in `"123"` / `"123.4"`. Accepts string-or-number for the
 * many parse-then-store call-sites. */
export function formatAmount(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(num)) return "0.00";
  return num.toFixed(2);
}

export function formatDate(date: string | Date): string {
  if (typeof date === "string") {
    return format(parseISO(date), "d MMM yyyy");
  }
  return format(date, "d MMM yyyy");
}

export function formatDateShort(date: string | Date): string {
  if (typeof date === "string") {
    return format(parseISO(date), "d MMM");
  }
  return format(date, "d MMM");
}

export function formatMonthYear(date: string | Date): string {
  if (typeof date === "string") {
    return format(parseISO(date), "MMMM yyyy");
  }
  return format(date, "MMMM yyyy");
}

export function amountClass(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return num >= 0 ? "text-emerald-600" : "text-red-500";
}

export function diffDaysISO(a: string, b: string): number {
  return Math.round(
    (new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) /
      86_400_000,
  );
}

/** Date → `YYYY-MM-DD` using the **local** calendar
 *  (matches what the user sees in the UI). The canonical form
 *  for the `transactions.date` text column and every other
 *  user-facing ISO-date field that crosses the JS / SQLite
 *  boundary. Don't swap for `toISOString().slice(0, 10)` —
 *  that's UTC and shifts by ±1 day in non-UTC timezones. */
export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Compact thousands-separated integer formatter used by the
 *  report tables — kept locale-aware (en-AU) so the separator
 *  stays a comma. Heavy enough to warrant a single instance
 *  rather than recreating per render. */
export const numFmt = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 0,
});
