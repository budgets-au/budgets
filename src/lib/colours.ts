/** Fixed-hex application colours that aren't theme tokens — the
 * single source of truth for values that used to be copy-pasted hex
 * arrays / inline ternaries across the codebase.
 *
 * Theme tokens (background, foreground, muted, border, ring, …)
 * live in `src/app/globals.css`. Use those whenever possible. Reach
 * here for the few cases where a precise brand value is needed and
 * the consumer is a chart library (Recharts / Sankey props don't
 * accept `var(--…)` references). */

/** Categorical 10-colour wheel used wherever the operator (or the
 * importer) picks one fixed colour per record — account icons +
 * imported-account auto-assignment. Indigo-500 leads because it's
 * the app's brand accent (`#6366f1` matches the default for a
 * freshly-created category, see `src/db/schema.ts`). */
export const CATEGORICAL_PALETTE: readonly string[] = [
  "#6366f1", // indigo-500 (brand)
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
  "#ef4444", // red-500
  "#f97316", // orange-500
  "#eab308", // yellow-500
  "#22c55e", // green-500
  "#14b8a6", // teal-500
  "#06b6d4", // cyan-500
  "#3b82f6", // blue-500
];

/** Trend semantic colours — green for "going up / positive", red for
 * "going down / negative". Used by every sparkline + dashboard
 * delta indicator. Picked from Tailwind's mid-shade
 * (emerald-500 / red-500) so they pop on both the light and dark
 * card surfaces without per-theme overrides. */
export const TREND_UP = "#10b981"; // emerald-500
export const TREND_DOWN = "#ef4444"; // red-500

/** Recharts `<CartesianGrid stroke>` value. Slate-200 in light /
 * slate-700 in dark — a touch more visible than `var(--border)` so
 * the grid registers as a chart affordance rather than a hairline.
 * Pass `isDark` from the consuming component's `useDarkMode()` (or
 * the per-render check it already does). */
export function chartGridStroke(isDark: boolean): string {
  return isDark ? "#334155" : "#e2e8f0";
}
