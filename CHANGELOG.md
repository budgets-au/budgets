# Changelog

All notable changes to this project are recorded here. The version policy
is **bump minor on every shipped change** (per user directive); patch
remains 0 until released hotfixes warrant it.

The canonical version pointer lives in `src/lib/version.ts`
(`APP_VERSION`). `package.json`'s `version` field is no longer
bumped on each release — it stays pinned so the Docker layer that
runs `npm ci` survives version bumps and rebuilds in seconds.

## 0.45.0 — 2026-05-13

### Fixed
- **Dashboard no longer crashes with React error #185 ("Maximum
  update depth exceeded") when adding a tracked-stock widget.**
  Root cause was a feedback loop between `onLayoutChange` and
  react-grid-layout. Each invocation of my handler returned a
  freshly-allocated `LayoutEntry[]` even when the content was
  identical to what we'd just stored; the new reference flowed
  back into the `layouts` prop, RGL fired `onLayoutChange`
  again, and the cycle compounded until React bailed. The
  handler now compares against the previous draft layout
  field-by-field and returns the *same* reference when nothing
  structurally changed — so a redundant RGL re-fire is a
  no-op. The Recharts "width(-1)/height(-1)" warning that
  appeared alongside the crash was a benign side-effect (the
  chart's parent had no measured size during the offending
  frame) and goes away once the loop stops.

## 0.44.0 — 2026-05-13

### Fixed
- **Tracked-stock widget no longer risks crashing the dashboard.**
  Two defensive guards in `TrackedStockCard`: the SWR fetcher
  now throws on non-2xx responses (so SWR returns `undefined`
  instead of handing the consumer an `{error: …}` body that
  would crash on `.filter()` / `.series`), and the investments
  list falls back to `[]` if the response somehow isn't an
  array.

### Changed
- **`transactionsRowExpandable` defaults to `false`** for new
  operators. Clicking a transaction row no longer toggles the
  expand panel unless the user opts in via Settings → General.

## 0.43.0 — 2026-05-13

### Fixed
- **Dashboard layout (and chart palette, and every other DB-only
  pref) now actually persists across refresh.** Root cause was
  not the save path — that worked fine end-to-end as the
  round-trip test confirmed. The destructive code was a "one-time"
  localStorage-to-DB migration `useEffect` in `useDisplayPrefs`:
  - The migration's "is the server still all-defaults?" check
    compared `data` to the defaults. But on the first render
    `data` is the SWR `fallbackData` — which **is** the defaults.
    So the check was always true on first render.
  - For any browser carrying a legacy `display-prefs`
    localStorage entry (left over from pre-DB versions; nothing
    in the current codebase writes it), the migration fired on
    every page load. It PATCHed the full parsed localStorage
    blob — with `dashboardLayout: []` and every other DB-only
    key defaulted in — and the API merge clobbered the live
    server data with those defaults.
  - The earlier "chart theme not saving" reports were the same
    bug. The earlier `keepalive` and `<ResponsiveGridLayout
    key=…>` fixes addressed real edge cases but were not the
    main culprit.

  The migration `useEffect` has been removed entirely. The
  legacy localStorage entry becomes inert; the new "Reset
  browser data" action below cleans it up if the user wants.

### Added
- **Settings → Security → Reset browser data.** Single button:
  clears `localStorage`, `sessionStorage`, the `theme` cookie,
  and calls NextAuth `signOut({ redirectTo: "/login" })`.
  Server-side prefs are deliberately untouched — those follow
  the account, not the browser, so re-logging in restores them.
  Useful for users carrying any stale browser state from older
  releases, and as a generic "log in fresh" escape hatch.

## 0.42.0 — 2026-05-13

### Fixed
- **Dashboard layout persists across refresh.** Two
  complementary fixes, both pointing at the same user-visible
  "save click but reload shows default" symptom:
  - `fetch("/api/display-prefs")` now carries `keepalive: true`
    on the PATCH so a hit-Save-then-refresh combo doesn't cancel
    the in-flight save. Default browser behaviour aborts
    in-flight requests on unload; the layout never reaches the
    DB and the next load re-reads the previous (default) state.
  - `<ResponsiveGridLayout>` now takes a `key` derived from the
    saved layout's widget-id signature. React-grid-layout caches
    its initial layout state on mount and doesn't always replace
    it from a changed `layouts` prop — so the dashboard would
    keep rendering the SWR fallback (defaults) even after the
    saved layout finally loaded. Remounting on signature change
    forces RGL to pick up the saved layout cleanly.

## 0.41.0 — 2026-05-13

### Fixed
- **Dashboard: sanitise saved layout before PATCH.** `saveEdit`
  now drops entries whose `widgetId` isn't in the registry before
  the optimistic mutate fires. React-grid-layout can transiently
  hold placeholder entries (e.g. `__dropping-elem__` during a
  drag) or stale entries for renamed widgets; persisting any of
  those would yield "dashboard resets on refresh" because the
  next load filters them back out and you'd see fewer widgets
  than you placed. Plus a round-trip regression test for the
  per-instance config bag (tracked-stock's `investmentId`) so
  future parser regressions are caught at the API layer.

## 0.40.0 — 2026-05-13

### Added
- **Tracked-stock dashboard widget.** A new card that watches a
  single operator-picked stock or paper-trade position. In edit
  mode the card shows a dropdown of every tracked
  `kind="stock" | "paper"` investment; outside edit mode it renders
  the symbol + current price + day change + a 1-month sparkline
  (Recharts AreaChart wired through the existing
  `/api/investments/[id]/history?range=1m` endpoint). Add the
  widget multiple times if you want to track multiple positions
  side-by-side.

### Changed
- **Widgets can now carry per-instance config.** `dashboardLayout`
  entries gained an optional `config: Record<string, unknown>`
  bag. The display-prefs parser preserves it as opaque data so
  new configurable widgets don't need a parser change; the grid
  threads `{ config, editMode, onConfigChange }` through to each
  widget's `render()`. Existing widgets ignore the props; the
  tracked-stock widget uses `config.investmentId` to remember
  which position it's pinned to.

## 0.39.0 — 2026-05-13

### Changed
- **Net Worth Trend + Budget Progress widgets default to a tighter
  height** (`h:2` rather than `h:3`/`h:4`). Both have small
  content — a chart + a few budget rows — and were squatting on
  more vertical space than they needed. Cards now also fill their
  cell (`h-full flex flex-col`) so resizing taller works cleanly.
- **Budget Progress slices to fit.** Rather than the historical
  fixed top-5, the card now measures its inner-content height and
  renders only as many budget rows as fit (capped at 10). Resize
  the tile to show more or fewer.
- **Upcoming Schedules slices to fit.** Same dynamic-fit treatment
  applied via ResizeObserver — the API hands back up to 50 rows
  and the card picks whatever count fits its rendered height. The
  old hard cap of 10 went away both server-side and client-side.

## 0.38.0 — 2026-05-13

### Fixed
- **Colour-swatch popover trigger now opens reliably.** The
  `PopoverTrigger` was using base-ui's `render={...}` template prop
  with an empty self-closing button. In base-ui 1.4.1 that
  template path didn't wire the click → open-popover handler
  through; the swatch looked clickable but did nothing. Switched
  to the simpler "PopoverTrigger renders its own button + we pass
  className/style/aria-label" pattern (the same shape used in
  searchable-combobox and saved-filters).
- **Dashboard widget drawer z-index bumped to `z-[60]`.** The
  drawer was using `z-60` (no Tailwind default — `z-50` is the
  ceiling unless you use an arbitrary value), so it stacked
  *behind* the navigation sidebar at `z-50`. Result: clicks on
  the drawer's Save button were intercepted by sidebar elements
  in the same screen real-estate, which is why "Save layout"
  appeared to do nothing.
- Added a round-trip test for `dashboardLayout` PATCH → GET that
  confirms the parser preserves the saved layout (caught no bug
  but locks behaviour in against future regressions).

## 0.37.0 — 2026-05-13

### Added
- **Options and Paper-trade dashboard widgets.** Two new
  drag-and-drop widgets siblings of the existing Stocks card:
  `Options` filters investments where `kind="option"` and adds an
  "expiring ≤30d" annotation when relevant; `Paper trades`
  filters `kind="paper"` and shows the position count alongside
  the value/return. Both surface per-currency totals (AUD + USD
  kept separate, never silently FX-added) the same way the
  Stocks card does. Not in the default layout — operators opt in
  via the edit drawer, matching the convention that new widgets
  surface as additions rather than auto-inserts.

## 0.36.0 — 2026-05-13

### Fixed
- **Schedule-chart palette rows: drop the wrapping `<label>`.** Each
  row was a `<label>` element with the radio inside it (the
  textbook "click the row to select the radio" pattern). But that
  wraps a labelable element around interactive controls — the
  colour-swatch popover triggers, the delete button, and the name
  input — and on click, browsers fight between "activate the
  control I'm on" and "activate the label's associated radio".
  Result: clicking a colour swatch sometimes did nothing because
  the radio absorbed the click. Rows are now plain `<div>`s; the
  radio is its own clickable target. `Add palette` is unaffected
  but gets an explicit `type="button"` for symmetry.

### Changed
- Dashboard heading tightened: the Edit-dashboard toolbar drops
  from `p-4/lg:p-6` (16/24 px) to `px-3 pt-2 pb-1` (12/8/4 px) and
  the Edit button shrinks to `size="xs"`. The grid wrapper drops
  to `px-3 pb-3` — the gap between the page title and the first
  widget row was eating an entire card's worth of vertical space.

## 0.35.0 — 2026-05-13

### Changed
- **Dashboard edit-mode drawer moves to the left edge.** The
  right-hand drawer was covering the dashboard grid itself,
  obscuring exactly the thing the operator was trying to edit. It
  now slides in from the left at the same width as the navigation
  sidebar (`w-60`) and at a higher z-index, so it covers the
  navigator (which serves no purpose during dashboard editing)
  rather than the content.
- **Schedule chart theme picker is now a radio list.** The single
  active-theme dropdown + separate palette catalogue merge into
  one component: each row is a radio + palette name + four colour
  swatches + a remove button. Fabulous sits at the top with no
  swatches. The combined layout makes the active selection more
  obvious and removes the round-trip through a dropdown for what
  is essentially a one-of-N choice.

### Fixed
- Added a regression test that round-trips
  `chartScheduleTheme: "<custom-id>"` + a custom
  `chartSchedulePalettes` entry through PATCH → GET. Confirms the
  parser broadening from 0.34.0 actually persists a custom-palette
  selection (previously locked to the `"fabulous" | "standard"`
  enum, which would silently drop a custom id back to the default).

## 0.34.0 — 2026-05-13

### Added
- **Schedule-chart palette editor in Settings.** The simple
  Fabulous / Standard dropdown becomes a full palette catalogue:
  the built-in Standard palette renders read-only at the top with
  its four colour swatches (actual / saved / over / forecast), and
  the operator can add as many custom palettes underneath as they
  want. Each editable row is a name field + four swatches; each
  swatch opens a popover with the native colour wheel + a hex
  input. The active-theme selector at the top of the panel lists
  Fabulous, Standard, and every custom palette by name. Deleting
  the currently-active palette falls back to Standard so the chart
  never tries to paint with an undefined colour.
- New colour-picker primitive (`src/components/ui/color-picker.tsx`)
  reusable wherever a palette swatch is needed — the same shape as
  the rest of the popover-based settings affordances.

### Changed
- `chartScheduleTheme` is now a free string (palette id) rather
  than a `"fabulous" | "standard"` union. The chart resolves
  unknown ids back to Standard so a deleted palette can never
  break rendering.
- The schedule chart accepts an optional `palette` prop driving
  the four "standard"-theme colours; Fabulous mode ignores it.

## 0.33.0 — 2026-05-13

### Added
- **Editable widget-grid dashboard.** The fixed Tailwind dashboard
  becomes a 12-column responsive grid where every card is a
  draggable, resizable widget. An "Edit dashboard" button top-right
  reveals a hover overlay on each tile (trash-icon to remove) and
  slides a right-hand drawer in listing widgets that aren't
  currently placed. Drop any drawer pill onto the grid to place it
  at its default size; rearrange and resize freely; hit Save to
  persist the layout to the cross-device display-prefs blob, or
  Cancel to revert. Empty saved layout means "use the
  registry-defined default" so existing operators see no change on
  first load.
- Three previously server-rendered summary cards (Net Worth, Income
  30d, Expenses 30d) and the per-type accounts list become
  self-contained client components fetching via the same `/api`
  routes the rest of the app uses. No new data routes; all
  widget-grid plumbing lives behind the registry at
  `src/lib/dashboard/widgets.tsx`.

### Changed
- Standard schedule-chart palette: Actual is now muted green
  (green-300), Saved matches the forecast grey (slate-300), Over
  stays muted red (red-300). The previous amber Actual + green
  Saved combination read as two cheerful primaries rather than the
  intended neutral baseline.

## 0.32.0 — 2026-05-13

### Fixed
- **CategoryDropdown trigger merges consumer classes instead of
  replacing them.** Bug shape: a caller supplying `triggerClassName`
  was wiping out every default (`border`, `rounded`, `text-foreground`,
  `inline-flex`). Most visible on the scheduled-transaction edit
  form — the Category pill rendered without a border, with default
  text colour against the form's dark background, looking
  unstyled. The base class now lives separately and the caller's
  override is folded in via `cn()` (tailwind-merge handles
  conflicts), so every consumer keeps the same structural shell
  while still being able to override sizing or background.
- Inline cell trigger on the main transactions list opts out of
  the new base's border / bg via `border-0 bg-transparent` so it
  still reads as a bare in-cell affordance.

## 0.31.0 — 2026-05-13

### Added
- **Schedule chart theme dropdown** in Settings → General → Charts.
  Two options to choose between:
    - **Fabulous** (default): per-segment lineage colours +
      hatched delta fills — the original look, packs more info
      per bar.
    - **Standard**: solid muted yellow / green / red for
      actual / saved / over — simpler, matches the rest of the
      site's palette. Forecast bars use a muted slate, missed
      occurrences use the same muted red as over-budget.
  Pref `chartScheduleTheme` follows the operator across devices
  via the DB-backed display-prefs blob. Future "chart theme"
  options will live in the same Charts section.

## 0.30.0 — 2026-05-13

### Changed
- **All chart tooltips themed via a shared primitive.** New
  `<ChartTooltipCard>` / `<ChartTooltipHeader>` / `<ChartTooltipRow>`
  primitives live at `src/components/ui/chart-tooltip.tsx` and
  every Recharts `<Tooltip>` in the app now uses them via a small
  per-chart `content` component. Replaces the default Recharts
  widget styling with the site's Popover card aesthetic (rounded
  / border / bg-popover / tabular-nums for amounts / coloured
  swatches per series).
  Migrated: dashboard net-worth trend, super-history chart,
  cashflow-calendar daily-balance chart, reports → Monthly,
  reports → Income/Expense by Category pie, reports → Sankey,
  reports → expenses drilldown pie, investments → history,
  investments → watchlist detail. (The schedule chart from 0.29.0
  also picks up the new primitive in place of its inline styling.)

## 0.29.0 — 2026-05-13

### Changed
- **Schedule chart tooltip rewritten.** The previous tooltip fired
  the Recharts default formatter once per stacked-bar segment,
  producing four near-identical rows of `Actual · Cap -$X from
  Jun 25 : $Y` on a single hover. Replaced with a custom themed
  card matching the site's Popover styling (rounded-md / border /
  bg-popover / tabular-nums). One panel per hover, surfacing
  only what the operator cares about: date + status pill,
  segment label, and three rows — Actual, Planned, Over/Under
  (sign- and tone-coded; red for Over, green for Under).

## 0.28.0 — 2026-05-13

### Fixed
- **Cashflow report — header split now sits at the bottom of the
  header cell.** The table's scroll wrapper had a `border` on all
  four sides, so a 1px line was visible at the top of the sticky
  header row. Combined with the per-cell `shadow-[inset_0_-1px…]`
  at the bottom of the header, the user saw the divider in the
  wrong place. Wrapper switched to `border-x border-b`, leaving
  only the inset shadow as the visible header/body separator.

## 0.27.0 — 2026-05-13

### Added
- **Edit mode in the transaction-row expand panel.** A pencil
  icon at the top-right switches the panel into edit mode where
  Date, Payee, Amount and Description become inline inputs. Save
  batches every changed field into one `PATCH /api/transactions/{id}`;
  Cancel discards the draft. Notes (inline NotesCell) and
  Reconciled (Switch) were already interactive — they stay
  unchanged. Bank-derived fields (type, balance, FITID) and
  system fields (timestamps, hashes, transaction ID) remain
  read-only.

### Changed
- **Row click-to-expand toggle moved to Settings → General →
  Display.** Was an inline switch in the transactions list header;
  belongs with the other display preferences. Description on the
  setting now mentions the new Edit affordance so the operator
  knows what flipping it on enables.

## 0.26.0 — 2026-05-13

### Fixed (visibility)
- **Surface `display-prefs` PATCH failures.** A toast + console
  error now fire whenever the API rejects a pref save (non-2xx
  response). Previously the optimistic rollback would silently
  snap a toggle back without telling the operator that anything
  went wrong — which made any persistence regression invisible
  ("I hid this category and it came back" with no signal
  pointing at the save layer).
- 4 new round-trip regression tests at
  `src/__tests__/golden/display-prefs-roundtrip.test.ts` lock in
  the API-layer persistence: fresh-DB defaults, PATCH-then-GET
  round-trip, empty-array unhide-all, and unrelated-key
  preservation across multiple PATCHes. 241/241 tests pass.

## 0.25.0 — 2026-05-13

### Changed
- **YoY report uses the envelope-report collapsing tree style.**
  Replaced the flat top-50 leaf list with a 3-level hierarchy
  (grandparent → parent → leaf) that opens with every parent
  collapsed, mirroring the envelope-report's UX. Click a chevron
  to drill in; `Expand all / Collapse all` button in the header
  applies the same op globally. Each level's children sort by
  |Δ| descending so the biggest movers within each parent surface
  first. Sign-aware tone (red for more-spend / less-income, green
  for less-spend / more-income) preserved. Synthetic parent /
  grandparent rows are filled in when only leaves appear in the
  data, same as the envelope-report's tree builder.

## 0.24.0 — 2026-05-13

### Fixed
- **Budget progress card showed the same category twice.** When the
  operator has multiple active budget schedules targeting one
  category (e.g. a parent-level cap + a child-level cap, or a
  paused-then-replaced budget still flagged active), the dashboard
  card rendered each as a separate row. Now dedupes by
  `categoryId` and sums cap + spent across colliding schedules so
  each category contributes one bar. React key switched from the
  derived label (which could collide) to a stable per-bucket key.

## 0.23.0 — 2026-05-13

### Added
- **Year over Year report tab.** Compares per-category totals
  between this Australian FY and the previous one, side by side
  with absolute and percent deltas. Sorted by |Δ| descending so
  the biggest movers lead. Scope segmented control (Expenses /
  Incomes / Both) at the top, with sign-aware tone — more spend
  is red, less spend is green; more income green, less income red.
  Top 50 of any larger result; tab owns its own FY scope (ignores
  the page from/to like the Tax tab does).
- **Shared FY helpers** at `src/lib/financial-year.ts`
  (`startOfFinancialYear`, `endOfFinancialYear`,
  `financialYearLabel`) — pulled the existing inline FY math out
  of `reports-view.tsx` so the YoY tab can reuse it.

## 0.22.0 — 2026-05-13

### Added
- **Net-worth trend card** on the dashboard. 12-month historical
  trajectory of `Σ(starting_balance) + Σ(transactions)` rendered as
  a sparkline with the current value + delta-vs-12-mo-ago summary.
  New API at `/api/dashboard/net-worth-trend` does the SQL — one
  starting-balance pull + one cumulative-sum query per month-end
  (~12ms total on a 10k-row DB). Visible-account convention matches
  the existing Net Worth headline card.
- **Budget progress card** on the dashboard. Top-5 active budget
  schedules sorted by % consumed (over-budget items lead), with a
  green/red progress bar per row. Hides itself when no budget
  schedules exist so it doesn't squat empty for operators who
  haven't set any up. Reuses the existing
  `/api/scheduled/budget-progress` endpoint + `/api/scheduled` +
  `/api/categories` for label lookups.

## 0.21.0 — 2026-05-13

### Added
- **Saved filter presets** on the transactions list. A new
  `Saved` popover next to the existing filter pills captures the
  current URL query under a name (e.g. "Big spends",
  "Internal transfers last quarter") and restores it with a click.
  Storage lives on the DB-backed `transactionsSavedFilters` blob,
  so presets follow the operator across devices. Same-name re-save
  overwrites the existing preset; presets sort alphabetically.

## 0.20.0 — 2026-05-13

### Added
- **Orphan-category cleaner** in Settings → Security. New admin
  panel + API (`/api/categories/orphans`) finds non-system
  categories with zero transactions, zero scheduled rows, and no
  child categories, and removes them with one click. Conservative
  by design — parents with descendants stay even if descendants
  are unused.
- **Quick-add scheduled affordance** in the sidebar. A `+` button
  next to the *Scheduled* nav entry (matching the existing
  Categories / Transactions affordances) pops the New-Scheduled
  dialog from anywhere in the app shell. New
  `useAddScheduled` hook + `AddScheduledProvider` mirror the
  existing category pattern.
- **Reconcile toggle inline.** The expanded transaction-row panel's
  "Reconciled" field is now an interactive `<Switch>` — flip a
  txn's reconciled flag without going through the account-level
  reconcile dialog.
- **Bills-only calendar toggle.** A `Bills only` button in the
  calendar toolbar drops the planned-dot count on every day to
  just expense schedules. Salary, internal transfers, and other
  inflows disappear, so the calendar reads as "what's due this
  month". Pref `calendarBillsOnly` follows the operator across
  devices.

## 0.19.0 — 2026-05-13

### Fixed
- **Sample-data seed race.** Two concurrent unlocks could both pass
  the `sampleDataSeeded=false` gate before either committed, causing
  the seed payload to insert twice. The check / existing-data gate /
  insert / flag-write now all run inside a single
  `db.transaction()`, relying on SQLite's connection-level
  write-lock to serialise the second caller — they observe
  `flag=true` and short-circuit.
- **Reconcile false-positive under float drift.** The
  `Math.abs(diff) > 0.005` tolerance compared two `parseFloat` sums
  in pennies-near-the-boundary, allowing a sub-cent drift across
  100+ transactions to either match-spuriously or report a fractional
  diff. Both sides are now rounded to integer cents before the
  comparison; `diff` is therefore always a clean `0.01` multiple.
- **Inconsistent destination-leg amount format on transfer
  schedules.** `String(-parseFloat(amount))` was producing bare
  `"200"` strings on the destination leg where the source leg has
  `"-200.00"`. Both legs now serialise via `formatAmount()` for
  uniformity.

## 0.18.0 — 2026-05-13

### Changed
- **Centralised amount formatting.** New `formatAmount(n)` helper in
  `lib/utils.ts` is the canonical 2-decimal string serialiser; the
  three import parsers (CSV / QIF / OFX) now call it instead of
  hand-rolling `.toFixed(2)` so every incoming transaction lands in
  the DB with a uniform `"123.45"` / `"-123.45"` shape.
- Tightened the `display-prefs.ts` preamble (was a 10-line
  docstring; now one sentence — field-level comments stay).

## 0.17.0 — 2026-05-13

### Changed
- **Unified category picker across the app.** The transactions
  list's keyboard-nav-friendly Popover dropdown is now the canonical
  category picker, extracted into a reusable
  `<CategoryDropdown>` (`src/components/categories/category-dropdown.tsx`)
  and adopted by:
    - inline transactions-list cell (was already this widget)
    - Scheduled-transaction edit form (was Base-UI `<Select>`)
    - "Make recurring" dialog on a transaction row (was `<Select>`)
    - Import preview per-row category (was `<Select>` with inline
      padding style)
    - Category-manager create form + edit dialog parent pickers
      (was `<Select>` with hand-rolled depth indent)
  Type-filtering (`typeFilter`), self/descendant exclusion
  (`excludeIds` + `excludeDescendants`), maximum-depth caps
  (`maxDepth`), and the "no category" sentinel label
  (`uncategorisedLabel`) cover every per-call-site constraint that
  used to live in the bespoke widgets.

- **Hierarchy is now conveyed by indentation, not by a
  "Grandparent / Parent / Child" prefix.** Every row in the dropdown
  shows just the leaf name, indented `14px` per depth level. Same
  search scoring (leaf-prefix beats ancestor-prefix beats
  substring), so typing "Grocer" still surfaces "Groceries" even
  though "Food / " is no longer rendered.

## 0.16.0 — 2026-05-13

### Changed
- **"Linked details" toggle moved to Settings → General → Display.**
  Was an inline switch at the top of the transactions list; lives
  better next to the existing Weekly column + Linked panel
  preferences. Behaviour is unchanged — same
  `transactionsShowLinkedDetails` pref, just a single discoverable
  home for it.

## 0.15.0 — 2026-05-13

### Changed
- **Sidebar version label centered.** Was left-aligned under the
  nav padding; now sits visually centred above the Lock / Sign-out
  buttons so it reads as a footer plate rather than a stray line.

### Added
- **`Row expand` toggle on the transactions list.** Click-to-expand
  metadata (notes, bank ID, posted timestamp, import details) is
  now controlled by `transactionsRowExpandable` on the DB-backed
  prefs blob. Default ON (preserves existing UX); when OFF, clicks
  on a row are inert and any already-open row collapses. Pref
  applies to both the main transactions list and the calendar
  day-detail panel that reuses the same `TransactionRow`.

## 0.14.0 — 2026-05-13

### Added
- **Golden Book accounting test suite.** A deterministic 12-month
  fixture (2 accounts, 3-level category tree, schedule supersession,
  internal transfers, a refund + an uncategorised txn) plus a
  hand-computed truth table now exercises `/api/reports/cashflow`
  end-to-end on every `npm test`. 46 new tests catch:
    - opening balance dropping `accounts.starting_balance` (140d53e)
    - hide-transfers leaking into the closing-balance walk (a183ba8)
    - Plan/mo double-counting superseded schedules (9a2c47b)
    - superseded predecessor's historical firings going missing
      (07326cb)
    - per-account reconciliation drift
    - period-continuity drift
    - schedule projection inconsistency
- **Pure accounting-invariant helpers** in
  `src/lib/test-invariants/accounting-invariants.ts` — conservation
  of money, account reconciliation, period continuity,
  categorisation completeness, roll-up integrity, avg idempotency,
  schedule projection consistency. Stateless, exported, reusable by
  any future feature test or admin "validate my data" CLI.
- **In-memory DB test harness** (`src/__tests__/golden/_helpers/`)
  spins up `@signalapp/better-sqlite3` at `:memory:`, runs every
  drizzle migration, and stashes the handle on `globalThis.__dbState`
  so the production `@/db` proxy resolves to the test DB. Route
  handlers run end-to-end without modification.

### Validated
- Temporarily reverted commit 9a2c47b's `isActive` guard during
  development and confirmed the suite fires
  (`expected 1127 to be close to 580`) — proof the regression net
  actually catches what it claims to.

## 0.13.0 — 2026-05-13

### Changed
- **Envelope report sorts by category name by default.** Previous
  behaviour ranked rows by descending period total at every tree
  level; the new default is alphabetical (case-insensitive) so the
  same envelope sits in the same place each visit, regardless of
  the time window.
- **Column headers are now sortable.** Click `Category` to flip
  between A→Z and Z→A; click `Period` (or any of `Monthly` /
  `Weekly` / `Daily` — they're derivatives of the same axis) to
  switch to magnitude sorting. The arrow indicator shows on the
  active column; default direction picked per axis (ascending for
  name, descending for money). Sort choice persists in the
  DB-backed display-prefs blob (`envelopeSortColumn` /
  `envelopeSortDir`).

## 0.12.0 — 2026-05-13

### Changed
- **Reports date-range popover baselines with the From/To inputs.**
  Trigger now has a "Quick range" label stacked above it (matching
  the existing date-field pattern), so all three controls line up
  on the same row instead of the popover button floating to the top.
- **Preset tiles drop the absolute date subtitle.** The label
  alone (e.g. "This Quarter") is enough; the dates underneath were
  visual clutter for an action the operator already knows the
  semantics of.

### Cashflow report
- **Total / Avg/mo / Plan/mo columns visually distinct from monthly
  data.** Each calculated column now carries a left border (matching
  the per-month separators) and a subtle `bg-muted/40` tint so the
  operator can tell aggregate figures from raw month-by-month
  values at a glance. Applies in both the header row and every body
  row (category leaves, sub/grandparent headers, TotalsRow).

## 0.11.0 — 2026-05-13

### Optimised
- **Slim actually shrinks the image now.** 0.10.0 moved the slim
  RUN into the runner stage thinking that would reduce image size —
  but `rm` in a later layer only *hides* files via overlay; the
  bytes still ship in the earlier COPY layer, so the published
  image stayed at ~320 MB even with the slimmed runtime view.
  Slimming now happens in the **builder** stage, immediately after
  `npm run build`, so the runner's `COPY --from=builder` transfers
  the already-trimmed tree. The runner-stage RUN keeps the cheap
  source-tree removals (drizzle.config.ts, src/, scripts/, etc.)
  but no longer pretends to slim @signalapp / @img.

## 0.10.0 — 2026-05-13

### Changed
- **Version stamping decoupled from `package.json`.** `APP_VERSION`
  now lives in `src/lib/version.ts` as a string literal. The Docker
  layer that runs `npm ci` is keyed on `package.json`, so bumping
  `package.json.version` on every change was invalidating the
  node_modules layer and forcing a 4-minute `npm ci` re-run per
  release. With the version pointer separated, only the late-stage
  `COPY . .` layer changes — npm-ci stays cached, and rebuilds
  drop from ~13 min to ~3 min for code-only diffs.
  `scripts/docker-release.mjs` reads `APP_VERSION` directly from
  `src/lib/version.ts` via a simple regex.

### Optimised
- **Runtime image trimmed from ~320 MB to ~250 MB.** Two changes
  in the Dockerfile runner stage:
    - `@signalapp/better-sqlite3/build/` is reduced from ~62 MB
      to just `build/Release/better_sqlite3.node` (the only file
      `require()` actually loads). Object files, gyp targets and
      copied SQLite C sources are stripped. The package's own
      `src/`, `deps/`, and `binding.gyp` go too — all build-time
      only.
    - Sharp's glibc-libvips variant (`@img/sharp-libvips-linux-x64`
      + `@img/sharp-linux-x64`, ~16 MB combined) is removed since
      the base image uses Alpine/musl. The musl variant stays.

## 0.9.0 — 2026-05-13

### Added
- **Release version in sidebar footer.** A `v0.x.y` tag now sits
  above the Lock / Sign out panel — single source of truth read
  from `package.json` via `src/lib/version.ts`. Subtle styling
  (small caps, tabular nums); it's reference info, not a CTA.

### Fixed
- **Sign-out redirect now goes to `/login`.** Both the sidebar
  (`signOut` button) and the topbar dropdown were passing
  `callbackUrl: "/login"`. That option is deprecated in NextAuth v5
  and is silently ignored — the user landed on the default
  `<AUTH_URL>/` (which mapped to `0.0.0.0:3000` for this deploy).
  Switched both call-sites to the v5 `redirectTo: "/login"` so the
  redirect honours the supplied path.

## 0.8.0 — 2026-05-13

### Changed
- **Reports date-range filter is now a popover with eight one-click
  presets.** Inline "3 months / 6 months / 12 months" buttons are
  replaced by a single button that opens a 2-column grid:
  `This Month / Last Month`, `This Quarter / Last Quarter`,
  `This Year / Last Year`, `This Financial / Last Financial`.
  Each tile shows the absolute from–to range underneath so the
  operator can see exactly what they're picking. The trigger
  reflects the active preset name (or "Custom range" when manual
  date edits put `from`/`to` between presets). Financial-year
  presets use the Australian 1-July anchor.

## 0.7.0 — 2026-05-13

### Removed
- **Global "Hide transfers" toggle.** The page-level toggle is gone;
  it was binary and only really hid a single internal-transfer
  category row. The cashflow report's per-category eye system
  replaces it with finer-grained control, and the envelope report
  has its own equivalent. Other report tabs now show every category
  regardless of `transfer_kind`. The toggle's pref
  (`reportsHideTransfers`) has been removed from `DisplayPrefs`.

### Changed
- **New installs default to transfers-hidden on the cashflow
  report.** When a fresh `app_settings` row is created,
  `cashflowExcludedCatIds` is seeded with the IDs of every
  internal-transfer category — so the operator lands on a clean
  cashflow view out of the box. Existing operators are unaffected;
  their current pref blob keeps whatever they've configured.
  Implemented as a dynamic default in both GET and PATCH on
  `/api/display-prefs`, so a first-time patch doesn't accidentally
  blow away the seeded defaults.

## 0.6.0 — 2026-05-13

### Added
- **Cashflow report — per-category visibility.** Each category row
  now has a hover-reveal eye icon next to its name. Clicking it
  hides that category (and all descendants) from the report. Hidden
  categories are excluded from every total — Total Income, Total
  Expenses, Surplus / Deficit, plus parent / grandparent rollups.
  Closing Balance is unaffected (it's the real bank-balance walk).
- New "Show N hidden" toggle in the cashflow controls bar appears
  whenever there's something hidden. Flipping it reveals a separate
  **Hidden Categories** section at the bottom of the table (greyed
  out, eye-off icon) so the operator can find and un-hide what they
  previously dismissed.
- Exclusion list lives in `cashflowExcludedCatIds` on the DB-backed
  display-prefs blob — follows the operator across devices.

## 0.5.0 — 2026-05-13

### Added
- **Missed-transactions grace period.** Schedules due today (or in
  the last few days) no longer immediately flag as missed — the
  bank feed usually needs a couple of days to post the actual
  transaction. New `scheduledMissedGraceDays` pref controls the
  window; default `4` days swallows a normal weekend + holiday lag.
  Once an occurrence is older than the grace window, it surfaces as
  missed if no matching txn has been claimed for it.
- Header dropdown in the missed-scheduled panel exposes the setting
  (0/1/2/3/4/5/7/10/14 days). The choice lives in the DB-backed
  `display_prefs` blob so it follows the operator across devices.

## 0.4.0 — 2026-05-13

### Changed
- **Cashflow report column headers freeze while scrolling.** The
  table wrapper is now its own vertical scroll container
  (`max-h: calc(100vh - 220px)`), and every `<th>` in the header row
  is `position: sticky` to that container's top. Everything above
  the table — page-level filters, tab bar, and the per-report
  controls — stays naturally pinned because the page itself stops
  scrolling. The left-most Category column keeps its horizontal-
  scroll sticky behaviour; the corner cell takes a higher z-index
  so the top-left intersection paints correctly. Bottom borders
  rendered as inset shadows since collapsed table borders drop
  under sticky cells.

## 0.3.0 — 2026-05-13

### Changed
- **All client settings are now DB-backed.** Every per-user toggle
  that used to live in browser `localStorage` is now stored centrally
  in `app_settings.display_prefs` (JSON) so the same operator picks
  up their preferences on every device they unlock the app from.
  Schema (`DisplayPrefs` in `src/lib/display-prefs.ts`) is the
  single source of truth; the parser tolerates malformed / missing
  / older blobs and merges with defaults. New API route
  `GET / PATCH /api/display-prefs` reads + deep-merges + upserts the
  singleton row. The `useDisplayPrefs` hook wraps it with SWR and
  optimistic updates so toggles feel instant.

  Migrated keys (formerly per-browser, now per-database):
    - Scheduled list weekly column, notes/linked-panel/page-size on
      Transactions, calendar month/week mode, missed-occurrences
      "show dismissed" toggle.
    - Reports → Cashflow: hide-transfers, totals level, show
      counts/total/avg/plan.
    - Reports → Sankey scope, Envelope excluded categories,
      per-tab date range.
    - Global account filter (sidebar multi-select) and scheduled
      match-window months.

  On first run the hook performs a one-time migration: if the
  server's blob is still all-defaults and the local browser has a
  legacy `display-prefs` blob, it patches that across to the
  database so existing operators don't re-configure from scratch.

  Drizzle migration `0006_app_settings_display_prefs.sql` adds the
  nullable `display_prefs TEXT` column to `app_settings`.

## 0.2.0 — 2026-05-12

### Fixed
- **Cashflow report — Plan/mo doubling.** When a schedule was replaced
  (predecessor flipped to `isActive=false` with `endDate` set, successor
  inserted), the report still summed both into the category's monthly
  plan rate, showing e.g. `$1,078/mo` for a `$547/mo` health-insurance
  schedule. Per-month "Plan" cells (which use expanded occurrences with
  per-schedule date windows) were already correct; only the
  monthly-normalised aggregate behind `Plan/mo` was affected. The
  predecessor is now excluded from the Plan/mo aggregate while still
  contributing to historical month columns.
