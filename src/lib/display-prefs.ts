/**
 * User-tunable display preferences. Stored centrally in the
 * `app_settings.display_prefs` JSON column so all client toggles
 * sync across devices instead of living in per-browser localStorage.
 *
 * The shape is the single source of truth for every preference key —
 * adding a new toggle means adding a field here, supplying a default
 * in DISPLAY_PREFS_DEFAULT, and reading/writing it in the parser
 * below. The pure helpers stay test-friendly and keep the hook +
 * API route thin.
 */
export interface DisplayPrefs {
  // ── Scheduled list ────────────────────────────────────────────
  /** Show the per-row "Weekly" column + footer on the scheduled list. */
  scheduledShowWeekly: boolean;

  // ── Main transactions list ─────────────────────────────────────
  /** Show the linked-transactions panel (direction gutter + counterpart
   * cells) on the right of the transactions list. Hide it for a
   * narrower / simpler table when transfer pairs aren't useful. */
  transactionsShowLinkedPanel: boolean;
  /** Inline notes column on the main transactions list. When false,
   * notes render as a hover-icon next to the payee. */
  transactionsShowNotes: boolean;
  /** Show the pair-payee + pair-amount columns inside the linked panel. */
  transactionsShowLinkedDetails: boolean;
  /** Page size for the main transactions list. */
  transactionsPageSize: number;

  // ── Cashflow calendar ─────────────────────────────────────────
  /** "month" or "week" view on the calendar page. */
  calendarViewMode: "month" | "week";

  // ── Scheduled missed-occurrences panel ────────────────────────
  /** Show dismissed missed-occurrences on the schedule view. */
  missedShowDismissed: boolean;

  // ── Reports ───────────────────────────────────────────────────
  /** Subtotal grouping on Reports → Cash Flow. */
  cashflowTotalsLevel: "grandparent" | "parent" | "none";
  /** Show the count-of-transactions column on Reports → Cash Flow. */
  cashflowShowCounts: boolean;
  /** Show the Total column on Reports → Cash Flow. */
  cashflowShowTotal: boolean;
  /** Show the Average column on Reports → Cash Flow. */
  cashflowShowAvg: boolean;
  /** Show the Plan (scheduled + budget) overlay on Reports → Cash Flow. */
  cashflowShowPlan: boolean;
  /** Category IDs hidden on Reports → Cash Flow. Hidden categories
   * are excluded from every total / parent rollup; toggling them
   * back on only requires `cashflowShowHidden` so the user can find
   * them. Cascades to descendants (hiding a parent hides children). */
  cashflowExcludedCatIds: string[];
  /** When true, hidden cashflow categories are still rendered
   * (greyed out) so the operator can un-hide them. They remain
   * excluded from totals regardless. */
  cashflowShowHidden: boolean;
  /** Sankey diagram scope on Reports → Sankey. */
  reportsSankeyScope: "all" | "income" | "expenses";
  /** Sort column for the Envelope report. `name` is the default and
   * matches "tree categories alphabetically"; `period` sorts by the
   * rolled-up total for the selected window. */
  envelopeSortColumn: "name" | "period";
  /** Sort direction for the Envelope report. Applies at every tree
   * level so the same axis ranks roots, sub-parents, and leaves. */
  envelopeSortDir: "asc" | "desc";
  /** Excluded category IDs on Reports → Envelope. */
  envelopeExcludedCatIds: string[];
  /** Per-tab from/to date range on the Reports page. Keyed by tab id. */
  reportsPeriodByTab: Record<string, { from: string; to: string }>;

  // ── Global filters ─────────────────────────────────────────────
  /** Account IDs the user has filtered to in the global account
   * selector. Empty array = "All accounts". Stored centrally so the
   * selection follows the user across devices. */
  globalAccountIds: string[];

  // ── Scheduled / matching ──────────────────────────────────────
  /** How many months back the missed-occurrences panel looks for
   * a candidate transaction to match against. */
  scheduledMatchWindowMonths: number;
  /** How many days an occurrence has to post before it can surface
   * as "missed". A schedule due today still has graceDays of room
   * to post via the bank feed before the panel flags it. */
  scheduledMissedGraceDays: number;
}

export const DISPLAY_PREFS_DEFAULT: DisplayPrefs = {
  scheduledShowWeekly: true,
  transactionsShowLinkedPanel: true,
  transactionsShowNotes: false,
  transactionsShowLinkedDetails: false,
  transactionsPageSize: 200,
  calendarViewMode: "month",
  missedShowDismissed: false,
  cashflowTotalsLevel: "grandparent",
  cashflowShowCounts: false,
  cashflowShowTotal: true,
  cashflowShowAvg: true,
  cashflowShowPlan: false,
  cashflowExcludedCatIds: [],
  cashflowShowHidden: false,
  reportsSankeyScope: "all",
  envelopeSortColumn: "name",
  envelopeSortDir: "asc",
  envelopeExcludedCatIds: [],
  reportsPeriodByTab: {},
  globalAccountIds: [],
  scheduledMatchWindowMonths: 6,
  scheduledMissedGraceDays: 4,
};

/** Legacy localStorage key — kept so the existing tests still
 * exercise the shape merge logic, and so the one-time migration in
 * the hook can pick up a pre-existing browser blob and write it to
 * the database on first run. */
export const DISPLAY_PREFS_STORAGE_KEY = "display-prefs";

/** Merge a raw value (from localStorage or the database JSON column)
 * with the defaults. Tolerates input that's malformed, missing, or
 * partially populated — every missing or wrongly-typed field falls
 * back to its default. Pure so consumers can call it on any source
 * (parsed JSON object, raw string from localStorage, …) without
 * pulling in storage or DB plumbing.
 *
 * Accepts either a string (which is JSON.parsed inline) or an
 * already-parsed object for direct use from the API route. */
export function parseDisplayPrefs(raw: string | null | unknown): DisplayPrefs {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (!raw) return { ...DISPLAY_PREFS_DEFAULT };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...DISPLAY_PREFS_DEFAULT };
    }
  } else if (raw == null) {
    return { ...DISPLAY_PREFS_DEFAULT };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ...DISPLAY_PREFS_DEFAULT };
  }
  const obj = parsed as Record<string, unknown>;

  function bool(key: keyof DisplayPrefs): boolean {
    return typeof obj[key] === "boolean"
      ? (obj[key] as boolean)
      : (DISPLAY_PREFS_DEFAULT[key] as boolean);
  }
  function pickEnum<T extends string>(
    key: keyof DisplayPrefs,
    allowed: readonly T[],
  ): T {
    const v = obj[key];
    if (typeof v === "string" && (allowed as readonly string[]).includes(v)) {
      return v as T;
    }
    return DISPLAY_PREFS_DEFAULT[key] as T;
  }
  function num(key: keyof DisplayPrefs): number {
    return typeof obj[key] === "number" && Number.isFinite(obj[key] as number)
      ? (obj[key] as number)
      : (DISPLAY_PREFS_DEFAULT[key] as number);
  }
  function stringArray(key: keyof DisplayPrefs): string[] {
    const v = obj[key];
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      return v as string[];
    }
    return [...(DISPLAY_PREFS_DEFAULT[key] as string[])];
  }
  function periodMap(
    key: keyof DisplayPrefs,
  ): Record<string, { from: string; to: string }> {
    const v = obj[key];
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      return { ...(DISPLAY_PREFS_DEFAULT[key] as Record<string, { from: string; to: string }>) };
    }
    const out: Record<string, { from: string; to: string }> = {};
    for (const [tab, range] of Object.entries(v as Record<string, unknown>)) {
      if (
        range &&
        typeof range === "object" &&
        typeof (range as { from?: unknown }).from === "string" &&
        typeof (range as { to?: unknown }).to === "string"
      ) {
        out[tab] = {
          from: (range as { from: string }).from,
          to: (range as { to: string }).to,
        };
      }
    }
    return out;
  }

  return {
    scheduledShowWeekly: bool("scheduledShowWeekly"),
    transactionsShowLinkedPanel: bool("transactionsShowLinkedPanel"),
    transactionsShowNotes: bool("transactionsShowNotes"),
    transactionsShowLinkedDetails: bool("transactionsShowLinkedDetails"),
    transactionsPageSize: num("transactionsPageSize"),
    calendarViewMode: pickEnum("calendarViewMode", ["month", "week"] as const),
    missedShowDismissed: bool("missedShowDismissed"),
    cashflowTotalsLevel: pickEnum(
      "cashflowTotalsLevel",
      ["grandparent", "parent", "none"] as const,
    ),
    cashflowShowCounts: bool("cashflowShowCounts"),
    cashflowShowTotal: bool("cashflowShowTotal"),
    cashflowShowAvg: bool("cashflowShowAvg"),
    cashflowShowPlan: bool("cashflowShowPlan"),
    cashflowExcludedCatIds: stringArray("cashflowExcludedCatIds"),
    cashflowShowHidden: bool("cashflowShowHidden"),
    reportsSankeyScope: pickEnum(
      "reportsSankeyScope",
      ["all", "income", "expenses"] as const,
    ),
    envelopeSortColumn: pickEnum(
      "envelopeSortColumn",
      ["name", "period"] as const,
    ),
    envelopeSortDir: pickEnum("envelopeSortDir", ["asc", "desc"] as const),
    envelopeExcludedCatIds: stringArray("envelopeExcludedCatIds"),
    reportsPeriodByTab: periodMap("reportsPeriodByTab"),
    globalAccountIds: stringArray("globalAccountIds"),
    scheduledMatchWindowMonths: num("scheduledMatchWindowMonths"),
    scheduledMissedGraceDays: num("scheduledMissedGraceDays"),
  };
}
