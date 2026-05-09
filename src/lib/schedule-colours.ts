// One colour per recurrence cadence. All "Monthly" pills share a colour; all
// "Weekly" share another, etc. Cadence-as-colour means a column scan tells you
// at a glance how often a row recurs.
export const FREQUENCY_COLOURS: Record<string, string> = {
  once:        "#94a3b8", // slate
  daily:       "#ef4444", // red
  weekly:      "#f97316", // orange
  fortnightly: "#eab308", // yellow
  monthly:     "#22c55e", // green
  quarterly:   "#06b6d4", // cyan
  yearly:      "#8b5cf6", // violet
};

// Distinct hues for predecessors in a lineage chain. Chosen so they don't
// clash with the frequency palette above (red/orange/yellow/green/cyan/violet)
// or with each other — at a glance "rose" vs "amber" vs "indigo" reads as
// different segments rather than shades of the same one.
export const LINEAGE_PREDECESSOR_COLOURS = [
  "#ec4899", // rose
  "#6366f1", // indigo
  "#f59e0b", // amber
  "#14b8a6", // teal
  "#a855f7", // purple
];

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (n: number) =>
    Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// 24 evenly-spaced hues across the colour wheel, used to colour budget
// periods so that consecutive periods don't blur together. With 24 distinct
// hues a year of weekly budgets (52 periods) cycles through the spectrum
// twice, and a couple of years of monthly budgets stays unique.
export const BUDGET_PERIOD_COLOURS = Array.from({ length: 24 }, (_, i) =>
  hslToHex(i * 15, 0.7, 0.55),
);

export function colourForBudgetPeriod(rank: number): string {
  const len = BUDGET_PERIOD_COLOURS.length;
  return BUDGET_PERIOD_COLOURS[((rank % len) + len) % len];
}

export function colourForFrequency(freq: string): string {
  return FREQUENCY_COLOURS[freq] ?? "#6366f1";
}

/**
 * Colour for a member of a lineage chain by age rank.
 *  - rank 0 (latest) → the schedule's cadence colour (so an active monthly
 *    schedule still reads as green, etc.)
 *  - rank ≥ 1 → cycles through LINEAGE_PREDECESSOR_COLOURS.
 */
export function colourForLineageRank(rank: number, frequency: string): string {
  if (rank <= 0) return colourForFrequency(frequency);
  return LINEAGE_PREDECESSOR_COLOURS[(rank - 1) % LINEAGE_PREDECESSOR_COLOURS.length];
}

/**
 * Returns a darkened version of a hex colour by mixing it with black.
 * Used to dim the colourful account/frequency badges so the white text on
 * them stays crisp without the saturated background screaming for attention.
 * `factor` is the mix ratio (0 = pure black, 1 = original colour).
 */
export function dimColour(hex: string, factor: number = 0.65): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const r = Math.round(((num >> 16) & 0xff) * factor);
  const g = Math.round(((num >> 8) & 0xff) * factor);
  const b = Math.round((num & 0xff) * factor);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function freqLabel(freq: string, interval: number): string {
  if (freq === "once") return "One-off";
  if (freq === "fortnightly") return "Fortnightly";
  if (interval === 1) return freq.charAt(0).toUpperCase() + freq.slice(1);
  return `Every ${interval} ${freq}`;
}
