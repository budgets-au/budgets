# Changelog

All notable changes to this project are recorded here. The version policy
is **bump minor on every shipped change** (per user directive); patch
remains 0 until released hotfixes warrant it.

The canonical version pointer lives in `src/lib/version.ts`
(`APP_VERSION`). `package.json`'s `version` field is no longer
bumped on each release — it stays pinned so the Docker layer that
runs `npm ci` survives version bumps and rebuilds in seconds.

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
