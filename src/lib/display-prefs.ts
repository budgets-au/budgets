/** User-tunable display preferences, synced across devices via
 * `app_settings.display_prefs`. Adding a key: add the field below,
 * a default in `DISPLAY_PREFS_DEFAULT`, and a read in the parser. */
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
  /** Whether clicking a transaction row expands it to show full
   * metadata (notes, bank-ID, posted timestamp, import details).
   * Off → clicks are inert; the row stays a single line. */
  transactionsRowExpandable: boolean;
  /** Named filter presets — captures the current transactions-list
   * search params under a name the operator picks. Keyed by a
   * client-generated UUID so renames + re-saves don't collide. */
  transactionsSavedFilters: Array<{ id: string; name: string; query: string }>;

  // ── Cashflow calendar ─────────────────────────────────────────
  /** "month" or "week" view on the calendar page. */
  calendarViewMode: "month" | "week";
  /** When true, the calendar's "planned" dots only fire for bill-shaped
   * schedules: expense category or transfer_kind=external (an outflow
   * to an external loan/CC). Hides salary, internal transfers, and
   * pure-income schedules — useful for an "what's due this month" view. */
  calendarBillsOnly: boolean;
  /** Visual theme for the scheduled-occurrences chart. Either the
   * literal `"fabulous"` (per-segment lineage colours + hatched
   * delta fills) or a palette id — either the built-in `"standard"`
   * or one of the user's custom palettes from
   * `chartSchedulePalettes` below. Stored as a free string so
   * deletes don't break the type — `resolveSchedulePalette()`
   * falls back to Standard on an unknown id. */
  chartScheduleTheme: string;
  /** User-defined "standard"-style palettes. Each palette names
   * four colours (actual / saved / over / forecast) the simpler
   * solid-fill chart renderer consumes. Initially empty — the
   * built-in "Standard" palette lives in code and is always
   * available without needing an entry here. */
  chartSchedulePalettes: Array<{
    id: string;
    name: string;
    actual: string;
    saved: string;
    over: string;
    forecast: string;
  }>;

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
  /** Per-report toggle: when true, drops transfer-typed categories
   * (transferKind in 'internal','external') from the underlying
   * cashflow query. Default true on every tab — transfers are usually
   * noise when reading these visualisations. The cashflow tab also
   * still supports its per-category eye toggle, which is additive. */
  cashflowHideTransfers: boolean;
  sankeyHideTransfers: boolean;
  treemapHideTransfers: boolean;
  scatterHideTransfers: boolean;
  yoyHideTransfers: boolean;
  envelopeHideTransfers: boolean;
  /** Which side(s) the Envelope report shows. `all` is income +
   * expenses with the net row; `income` / `expenses` focus the view
   * on one side and drop the net row (which has no meaning when only
   * one side is visible). */
  envelopeScope: "all" | "income" | "expenses";
  /** Sort column for the Envelope report. `name` is the default and
   * matches "tree categories alphabetically"; `period` sorts by the
   * rolled-up total for the selected window. */
  envelopeSortColumn: "name" | "period";
  /** Sort direction for the Envelope report. Applies at every tree
   * level so the same axis ranks roots, sub-parents, and leaves. */
  envelopeSortDir: "asc" | "desc";
  /** Excluded category IDs on Reports → Envelope. */
  envelopeExcludedCatIds: string[];
  /** Whether the Scheduled Transactions page respects the global
   * account filter from the sidebar.
   *   "all"      — show every schedule regardless of sidebar filter
   *                (the default; the page lives in budget-planning
   *                land where the operator usually wants the whole
   *                picture).
   *   "selected" — defer to the sidebar's selection, like the rest
   *                of the app. */
  scheduledAccountFilterMode: "all" | "selected";
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

  // ── Features ──────────────────────────────────────────────────
  /** Investments feature flag. When false, the /investments page
   * is unreachable (server-side redirect to /dashboard), the nav
   * link is hidden, and the investment-related dashboard widgets
   * (tracked-stock, stocks-summary, options-summary, paper-trade-
   * summary) drop out of the widget drawer + the rendered grid.
   * The saved layout entries are preserved so re-enabling restores
   * them — unless the operator saves a dashboard edit while the
   * feature is off, in which case the now-invisible entries get
   * pruned. */
  featureInvestments: boolean;
  /** Superannuation feature flag. Mirrors `featureInvestments` for
   * the /superannuation page + the super-summary widget. */
  featureSuper: boolean;

  // ── Dashboard widgets ─────────────────────────────────────────
  /** Show budget caps (kind="budget") in the Upcoming widget.
   * Off by default so the list stays focused on planned outflows;
   * the toggle at the top of the widget surfaces it. */
  dashboardUpcomingShowBudgets: boolean;
  /** Show inline transaction notes on the Recent transactions
   * widget. Off by default so the rows stay one-line; toggle
   * sits at the top of the widget. */
  dashboardRecentShowNotes: boolean;

  // ── Dashboard ─────────────────────────────────────────────────
  /** Per-operator dashboard grid layout. Each entry positions a
   * widget (by registry id) at a cell on the 12-col grid. Empty
   * array = use the registry-defined default layout.
   *
   * `config` is an opaque per-widget bag — e.g. the tracked-stock
   * widget stores `{ investmentId: "<uuid>" }` here. Stored as
   * `unknown` so adding a new configurable widget doesn't require
   * a parser change. */
  dashboardLayout: Array<{
    /** Registry id — points at a WidgetSpec. Multiple entries can
     * share a widgetId if the widget opts in to `multiInstance`. */
    widgetId: string;
    /** Stable per-placement identifier. Absent on entries written
     * before multi-instance support landed; the renderer falls back
     * to `widgetId` (safe because single-instance widgets can only
     * appear once). Newly placed multiInstance widgets always get a
     * fresh UUID here. */
    instanceId?: string;
    x: number;
    y: number;
    w: number;
    h: number;
    config?: Record<string, unknown>;
  }>;
}

export const DISPLAY_PREFS_DEFAULT: DisplayPrefs = {
  scheduledShowWeekly: true,
  transactionsShowLinkedPanel: true,
  transactionsShowNotes: false,
  transactionsShowLinkedDetails: false,
  transactionsPageSize: 200,
  transactionsRowExpandable: false,
  transactionsSavedFilters: [],
  calendarViewMode: "month",
  calendarBillsOnly: false,
  chartScheduleTheme: "standard",
  chartSchedulePalettes: [],
  missedShowDismissed: false,
  cashflowTotalsLevel: "grandparent",
  cashflowShowCounts: false,
  cashflowShowTotal: true,
  cashflowShowAvg: true,
  cashflowShowPlan: false,
  cashflowExcludedCatIds: [],
  cashflowShowHidden: false,
  reportsSankeyScope: "all",
  cashflowHideTransfers: true,
  sankeyHideTransfers: true,
  treemapHideTransfers: true,
  scatterHideTransfers: true,
  yoyHideTransfers: true,
  envelopeHideTransfers: true,
  envelopeScope: "all",
  envelopeSortColumn: "name",
  envelopeSortDir: "asc",
  envelopeExcludedCatIds: [],
  scheduledAccountFilterMode: "all",
  reportsPeriodByTab: {},
  globalAccountIds: [],
  scheduledMatchWindowMonths: 6,
  scheduledMissedGraceDays: 4,
  featureInvestments: true,
  featureSuper: true,
  dashboardUpcomingShowBudgets: false,
  dashboardRecentShowNotes: false,
  dashboardLayout: [],
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
  function savedFilters(
    key: keyof DisplayPrefs,
  ): Array<{ id: string; name: string; query: string }> {
    const v = obj[key];
    if (!Array.isArray(v)) {
      return [
        ...(DISPLAY_PREFS_DEFAULT[key] as Array<{ id: string; name: string; query: string }>),
      ];
    }
    const out: Array<{ id: string; name: string; query: string }> = [];
    for (const x of v) {
      if (
        x &&
        typeof x === "object" &&
        typeof (x as { id?: unknown }).id === "string" &&
        typeof (x as { name?: unknown }).name === "string" &&
        typeof (x as { query?: unknown }).query === "string"
      ) {
        out.push({
          id: (x as { id: string }).id,
          name: (x as { name: string }).name,
          query: (x as { query: string }).query,
        });
      }
    }
    return out;
  }
  function schedulePalettes(
    key: keyof DisplayPrefs,
  ): Array<{
    id: string;
    name: string;
    actual: string;
    saved: string;
    over: string;
    forecast: string;
  }> {
    const v = obj[key];
    if (!Array.isArray(v)) {
      return [
        ...(DISPLAY_PREFS_DEFAULT[key] as Array<{
          id: string;
          name: string;
          actual: string;
          saved: string;
          over: string;
          forecast: string;
        }>),
      ];
    }
    const out: Array<{
      id: string;
      name: string;
      actual: string;
      saved: string;
      over: string;
      forecast: string;
    }> = [];
    for (const x of v) {
      if (
        x &&
        typeof x === "object" &&
        typeof (x as { id?: unknown }).id === "string" &&
        typeof (x as { name?: unknown }).name === "string" &&
        typeof (x as { actual?: unknown }).actual === "string" &&
        typeof (x as { saved?: unknown }).saved === "string" &&
        typeof (x as { over?: unknown }).over === "string" &&
        typeof (x as { forecast?: unknown }).forecast === "string"
      ) {
        out.push({
          id: (x as { id: string }).id,
          name: (x as { name: string }).name,
          actual: (x as { actual: string }).actual,
          saved: (x as { saved: string }).saved,
          over: (x as { over: string }).over,
          forecast: (x as { forecast: string }).forecast,
        });
      }
    }
    return out;
  }
  function layoutArray(
    key: keyof DisplayPrefs,
  ): Array<{
    widgetId: string;
    instanceId?: string;
    x: number;
    y: number;
    w: number;
    h: number;
    config?: Record<string, unknown>;
  }> {
    type Entry = {
      widgetId: string;
      instanceId?: string;
      x: number;
      y: number;
      w: number;
      h: number;
      config?: Record<string, unknown>;
    };
    const v = obj[key];
    if (!Array.isArray(v)) {
      return [...(DISPLAY_PREFS_DEFAULT[key] as Entry[])];
    }
    const out: Entry[] = [];
    for (const x of v) {
      if (
        x &&
        typeof x === "object" &&
        typeof (x as { widgetId?: unknown }).widgetId === "string" &&
        typeof (x as { x?: unknown }).x === "number" &&
        Number.isFinite((x as { x: number }).x) &&
        typeof (x as { y?: unknown }).y === "number" &&
        Number.isFinite((x as { y: number }).y) &&
        typeof (x as { w?: unknown }).w === "number" &&
        Number.isFinite((x as { w: number }).w) &&
        typeof (x as { h?: unknown }).h === "number" &&
        Number.isFinite((x as { h: number }).h)
      ) {
        const cfgRaw = (x as { config?: unknown }).config;
        const instRaw = (x as { instanceId?: unknown }).instanceId;
        const entry: Entry = {
          widgetId: (x as { widgetId: string }).widgetId,
          x: (x as { x: number }).x,
          y: (x as { y: number }).y,
          w: (x as { w: number }).w,
          h: (x as { h: number }).h,
        };
        if (typeof instRaw === "string" && instRaw.length > 0) {
          entry.instanceId = instRaw;
        }
        if (cfgRaw && typeof cfgRaw === "object" && !Array.isArray(cfgRaw)) {
          entry.config = cfgRaw as Record<string, unknown>;
        }
        out.push(entry);
      }
    }
    return out;
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
    transactionsRowExpandable: bool("transactionsRowExpandable"),
    transactionsSavedFilters: savedFilters("transactionsSavedFilters"),
    calendarViewMode: pickEnum("calendarViewMode", ["month", "week"] as const),
    calendarBillsOnly: bool("calendarBillsOnly"),
    chartScheduleTheme:
      typeof obj.chartScheduleTheme === "string" && obj.chartScheduleTheme
        ? obj.chartScheduleTheme
        : DISPLAY_PREFS_DEFAULT.chartScheduleTheme,
    chartSchedulePalettes: schedulePalettes("chartSchedulePalettes"),
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
    cashflowHideTransfers: bool("cashflowHideTransfers"),
    sankeyHideTransfers: bool("sankeyHideTransfers"),
    treemapHideTransfers: bool("treemapHideTransfers"),
    scatterHideTransfers: bool("scatterHideTransfers"),
    yoyHideTransfers: bool("yoyHideTransfers"),
    envelopeHideTransfers: bool("envelopeHideTransfers"),
    envelopeScope: pickEnum(
      "envelopeScope",
      ["all", "income", "expenses"] as const,
    ),
    envelopeSortColumn: pickEnum(
      "envelopeSortColumn",
      ["name", "period"] as const,
    ),
    envelopeSortDir: pickEnum("envelopeSortDir", ["asc", "desc"] as const),
    envelopeExcludedCatIds: stringArray("envelopeExcludedCatIds"),
    scheduledAccountFilterMode: pickEnum(
      "scheduledAccountFilterMode",
      ["all", "selected"] as const,
    ),
    reportsPeriodByTab: periodMap("reportsPeriodByTab"),
    globalAccountIds: stringArray("globalAccountIds"),
    scheduledMatchWindowMonths: num("scheduledMatchWindowMonths"),
    scheduledMissedGraceDays: num("scheduledMissedGraceDays"),
    featureInvestments: bool("featureInvestments"),
    featureSuper: bool("featureSuper"),
    dashboardUpcomingShowBudgets: bool("dashboardUpcomingShowBudgets"),
    dashboardRecentShowNotes: bool("dashboardRecentShowNotes"),
    dashboardLayout: layoutArray("dashboardLayout"),
  };
}
