/** Schedule-chart colour palettes. Each palette names the four
 * data-type colours the "standard" chart renderer needs: matched
 * actual bars, saved-vs-cap deltas, over-cap deltas, and not-yet-
 * fired forecast bars. The chart's `missed` segments reuse the
 * `over` colour (red-toned) — there's no semantic reason for a
 * fifth slot.
 *
 * "Fabulous" is a separate code path: it uses per-segment lineage
 * colours + hatched delta fills, so it has no configurable palette. */

export interface SchedulePalette {
  id: string;
  name: string;
  actual: string;
  saved: string;
  over: string;
  forecast: string;
}

/** Built-in standard palette — muted Tailwind-300 shades. Saved
 * intentionally matches the forecast grey so a "money you didn't
 * have to spend" delta reads the same neutral tone as "the bar
 * hasn't fired yet". This is read-only; custom palettes live in
 * `display_prefs.chartSchedulePalettes`. */
export const STANDARD_PALETTE: SchedulePalette = {
  id: "standard",
  name: "Standard",
  actual: "#86efac", // green-300
  saved: "#cbd5e1", // slate-300
  over: "#fca5a5", // red-300
  forecast: "#cbd5e1", // slate-300
};

/** The Fabulous theme id — kept as a constant so the chart and the
 * settings UI agree on what "fabulous mode" looks like. Fabulous
 * has no palette; the chart bypasses the colour-resolution path
 * when theme is this id. */
export const FABULOUS_THEME_ID = "fabulous";

/** Resolve the active palette from a theme id + the operator's
 * custom palettes. Returns `null` for the Fabulous theme (callers
 * should switch on `null` to render the lineage-coloured variant).
 * Unknown ids fall back to Standard so a deleted-palette pref can
 * never crash the chart. */
export function resolveSchedulePalette(
  themeId: string,
  custom: SchedulePalette[],
): SchedulePalette | null {
  if (themeId === FABULOUS_THEME_ID) return null;
  if (themeId === STANDARD_PALETTE.id) return STANDARD_PALETTE;
  const found = custom.find((p) => p.id === themeId);
  if (found) return found;
  return STANDARD_PALETTE;
}

/** Built-in palette ids cannot be renamed, recoloured, or deleted
 * from the Settings UI. */
export function isBuiltinPaletteId(id: string): boolean {
  return id === STANDARD_PALETTE.id || id === FABULOUS_THEME_ID;
}
