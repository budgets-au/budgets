// Enlarge a small icon button's tappable area with an invisible pseudo-element
// without changing layout: ~28px around a 12px glyph, ~36px on touch screens.
export const HIT_AREA =
  "relative after:absolute after:-inset-2 after:content-[''] pointer-coarse:after:-inset-3";

/** Horizontal-only variant for vertically stacked buttons (e.g. up/down). */
export const HIT_AREA_X = "relative after:absolute after:inset-y-0 after:-inset-x-2 after:content-['']";
