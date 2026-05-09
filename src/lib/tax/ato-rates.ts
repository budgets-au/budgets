/** ATO fixed-rate WFH method ($/hour). PCG 2023/1 superseded the older
 * 80c/hr COVID shortcut and the 52c/hr running-cost rate. Keys are
 * `fyEndYear` — i.e. 2025 = FY24/25 ending 30 June 2025.
 *
 * Update when the ATO publishes a new rate. Reports for FYs past the
 * latest-known year fall back to `latestKnownRate()` and surface a warning
 * so the user knows to confirm the current figure. */
export const WFH_FIXED_RATE_PER_HOUR: Record<number, number> = {
  2023: 0.67, // FY22/23
  2024: 0.67, // FY23/24
  2025: 0.70, // FY24/25
  2026: 0.70, // FY25/26 — assumed; confirm with ATO before lodging
};

export function rateForFy(fyEndYear: number): { rate: number; fallback: boolean } {
  const direct = WFH_FIXED_RATE_PER_HOUR[fyEndYear];
  if (direct != null) return { rate: direct, fallback: false };
  const latest = latestKnownRate();
  return { rate: latest.rate, fallback: true };
}

export function latestKnownRate(): { fyEndYear: number; rate: number } {
  const years = Object.keys(WFH_FIXED_RATE_PER_HOUR).map(Number).sort((a, b) => b - a);
  const top = years[0];
  return { fyEndYear: top, rate: WFH_FIXED_RATE_PER_HOUR[top] };
}

/** Category paths matched by these patterns are auto-flagged as
 * `bundledInWfh: true` on first load — meaning under the fixed-rate method
 * they're already covered by the hourly rate and shouldn't be claimed
 * separately under actual-cost either. The user can override per category.
 *
 * Patterns match against the full path joined with " / " (e.g.
 * "Utilities / Electricity"). Case-insensitive. */
export const BUNDLED_CATEGORY_PATTERNS: RegExp[] = [
  /utilities\s*\/\s*(electricity|power|gas)/i,
  /^internet(\s*\/|$)/i,
  /^mobiles(\s*\/|$)/i,
  /^phone(\s*\/|$)/i,
];

/** Heuristic for auto-bucketing categories into the "Other deductions"
 * sections. Same rules as bundled patterns but the labels here drive UI
 * grouping, not exclusion. */
/** Section hints drive the UI grouping in the "Other deductions" table.
 * defaultPct is intentionally 0 across the board — auto-classifying a
 * category at 100% would risk silently claiming personal "Gifts" or similar
 * as donations. The user opts in per category via the Settings panel. */
export const OTHER_DEDUCTION_HINTS: Array<{
  section: "donations" | "tax-agent" | "subscriptions";
  patterns: RegExp[];
  defaultPct: number;
}> = [
  {
    section: "donations",
    patterns: [/donation/i, /^charity(\s*\/|$)/i, /^gifts?(\s*\/|$)/i],
    defaultPct: 0,
  },
  {
    section: "tax-agent",
    patterns: [/^tax\s*\/\s*accountant/i, /tax\s*agent/i],
    defaultPct: 0,
  },
  {
    section: "subscriptions",
    patterns: [/^development(\s*\/|$)/i, /subscription/i, /membership/i],
    defaultPct: 0,
  },
];
