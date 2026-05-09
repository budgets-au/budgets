import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  parseISO,
} from "date-fns";

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const SUPPORTED_FREQUENCIES = new Set(["weekly", "monthly", "quarterly", "yearly"]);

/**
 * Compute the Nth anchor (period-start) date for a budget. Re-anchors from
 * the original start each step so monthly/quarterly/yearly schedules stay
 * pinned to the original day-of-month even after short-month clamping.
 *
 * For start=Jan 31 monthly, anchors are: Jan 31, Feb 28, Mar 31, Apr 30,
 * May 31, Jun 30, ... — date-fns's addMonths reapplies clamping each call,
 * so nextAnchor(Jan 31, 31) lands on May 31 instead of drifting to May 27.
 */
function nextAnchor(start: Date, frequency: string, periodIndex: number): Date {
  switch (frequency) {
    case "weekly":
      return addWeeks(start, periodIndex);
    case "monthly":
      return addMonths(start, periodIndex);
    case "quarterly":
      return addMonths(start, periodIndex * 3);
    case "yearly":
      return addYears(start, periodIndex);
    default:
      throw new Error(`Unsupported budget frequency: ${frequency}`);
  }
}

/**
 * Compute the [from, to] (inclusive, ISO YYYY-MM-DD) of the budget period
 * containing `today`, anchored on `startISO`. Period length is determined
 * by `frequency`.
 *
 * The anchor matters: a weekly food budget with startISO of a Sunday yields
 * Sun-Sat windows; a monthly utilities budget with startISO of the 31st
 * yields 31st-of-month → day-before-next-31st windows, with month-end
 * clamping for short months. No separate day-of-week field — the start
 * date itself doubles as the anchor.
 *
 * Walks anchor by anchor from `start` until the next one passes `today`
 * — at most ~104 iterations for a two-year-old weekly budget. The earlier
 * `differenceInCalendarMonths`-based shortcut had off-by-one errors on
 * 31st-of-month / Feb-29 anchors because boundary crossings ≠ elapsed
 * periods when a period spans a clamped month.
 */
export function currentBudgetPeriod(
  startISO: string,
  frequency: string,
  today: Date = new Date(),
): { from: string; to: string } {
  if (!SUPPORTED_FREQUENCIES.has(frequency)) {
    // Daily / fortnightly aren't valid budget periods; fall back to a
    // one-day window so the UI doesn't crash if a budget somehow ends up
    // with one of those frequencies.
    const iso = toISO(today);
    return { from: iso, to: iso };
  }

  const start = parseISO(startISO);
  // Today is before the schedule even starts — return the first period
  // so UIs render 0% progress instead of crashing.
  if (today.getTime() < start.getTime()) {
    const next = nextAnchor(start, frequency, 1);
    return { from: toISO(start), to: toISO(addDays(next, -1)) };
  }

  // Walk anchors forward until the next one exceeds today.
  for (let i = 0; i < 5000; i++) {
    const from = nextAnchor(start, frequency, i);
    const next = nextAnchor(start, frequency, i + 1);
    if (next.getTime() > today.getTime()) {
      return { from: toISO(from), to: toISO(addDays(next, -1)) };
    }
  }
  // Defensive — 5000 weekly periods is ~96 years, safer than infinite loop
  // if today is corrupted (e.g. a Date(NaN)).
  const iso = toISO(today);
  return { from: iso, to: iso };
}

/**
 * Enumerate every period boundary [from, to] from the budget's startDate
 * through (and including) the period containing `today`. Optionally clips
 * to a lookback window — periods whose `to` date is before `windowFromISO`
 * are skipped, useful when txns have only been fetched within a rolling
 * window.
 */
export function pastBudgetPeriods(
  startISO: string,
  frequency: string,
  today: Date = new Date(),
  windowFromISO?: string,
): { from: string; to: string }[] {
  if (!SUPPORTED_FREQUENCIES.has(frequency)) return [];
  const out: { from: string; to: string }[] = [];
  const start = parseISO(startISO);
  const windowFrom = windowFromISO ? parseISO(windowFromISO) : start;

  for (let i = 0; i < 5000; i++) {
    const from = nextAnchor(start, frequency, i);
    if (from.getTime() > today.getTime()) break;
    const next = nextAnchor(start, frequency, i + 1);
    const to = addDays(next, -1);
    if (to.getTime() >= windowFrom.getTime()) {
      out.push({ from: toISO(from), to: toISO(to) });
    }
  }
  return out;
}
