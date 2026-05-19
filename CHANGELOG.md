# Changelog

All notable changes to this project are recorded here. The version policy
is **bump minor on every shipped change** (per user directive); patch
remains 0 until released hotfixes warrant it.

The canonical version pointer lives in `src/lib/version.ts`
(`APP_VERSION`). `package.json`'s `version` field is no longer
bumped on each release — it stays pinned so the Docker layer that
runs `npm ci` survives version bumps and rebuilds in seconds.

## 0.176.0 — 2026-05-19

### Fixed
- **Category report was missing parent rows whose only
  contribution was through children.** The Cashflow API only
  returns categories with direct transactions (or a
  budget/schedule attached to the category itself), so a parent
  like "Food" with no own transactions never came back — yet its
  children (Groceries, Dining out) still rendered, indented but
  visually orphaned. Added a hierarchy pass that synthesises
  rows for any referenced parent that's missing, rolls up its
  real descendants' totals / plan / count, and emits rows in
  tree order (depth-0 → depth-1 → depth-2). Synthesised rows
  render as italic muted group headers (no link, no hide
  button — they exist as structural anchors only). New helper
  + unit tests in
  [src/lib/category-hierarchy.ts](src/lib/category-hierarchy.ts).
- **Diff column on the Category report computed nonsense for
  expenses.** The Cashflow API returns plan amounts as
  unsigned absolutes (`Math.abs(...)` in both the budget and
  scheduled aggregators), but Total arrives signed — negative
  for expenses. The previous formula `Total − Plan` then
  produced e.g. `−500 − 600 = −1100` for a category that
  actually spent $500 of a $600 budget. Apply the sign from
  `cat.type` so Plan matches Total's convention (negative for
  expenses); Diff = Total − Plan then reads as expected —
  positive when under-spent / outperforming, negative when
  over-spent / shortfall. Same fix applied to the Total
  income / Total expenses summary rows.

## 0.175.0 — 2026-05-19

### Fixed
- **Category report's Plan column overstated non-monthly
  scheduled transactions.** The previous formula was
  `scheduledPerMonth × monthsCount`, which is a smoothed
  average — a bimonthly $200 schedule was reported as "$100
  every month", so a one-month window showed Plan = $100
  even though no occurrence falls in that month. Same bug
  affected budgets stored as non-monthly cadences. Switched
  to summing the API's `scheduledByMonth[m]` and
  `budgetByMonth[m]` across the months actually in the
  selected window — these maps already reflect the real
  recurrence (a bimonthly schedule only contributes in the
  months it fires), so Plan now matches what'll actually
  happen. Total / Diff line up again for
  quarterly / yearly / fortnightly cadences in
  [category-report.tsx](src/components/reports/category-report.tsx).

## 0.174.0 — 2026-05-19

### Changed
- **More print-layout polish.** Round-two pass against the
  print spec uncovered three more issues:
  - The "this month" highlight on Cashflow + Accounts
    (`bg-indigo-500/10` on the column-of-cells) was bleeding
    through to paper as a lavender wash. The `@media print`
    class-attribute selector didn't catch it (Tailwind v4
    escape quirk); added `print:bg-transparent` directly at
    each of the 10 sites in
    [cashflow-report.tsx](src/components/reports/cashflow-report.tsx)
    so the highlight is stripped at source.
  - Table cell padding + font tightened in print (`4px / 9pt`)
    so wide-month tables fit landscape A4 without spilling.
  - Category-name truncation overridden — on paper the full
    name wraps onto a second line rather than ellipsing, so
    YoY / Expenses / Envelope no longer lose category labels
    in narrow columns.
- **Treemap and Tax Deductions now print on landscape A4.**
  Both wanted the horizontal room — Treemap for its
  rectangle layout, Tax for its 3-card Fixed / Actual / Total
  row. Wrapper class `print-landscape` added on each.

### Changed (Category report)
- **Budget + Scheduled columns collapsed into a single Plan
  column** plus a new **Diff** column (Total − Plan). Showing
  two separate plan-shaped figures next to each other was
  redundant — operators mostly think of "what I expected" as
  one number, and the difference from actual is the key
  insight the report's meant to surface.

## 0.173.0 — 2026-05-19

### Changed
- **Reports print layouts overhauled.** Driven through a new
  Playwright `print-screenshots.spec.ts` that captures each
  report's print-media render against A4-paper-shaped viewports
  (portrait or landscape per-report). Iterated until each
  printed render reads cleanly on paper.

  - **Global `@media print`** in
    [src/app/globals.css](src/app/globals.css) hardened: named
    `@page report-landscape` rule (`size: A4 landscape`) so a
    wrapper class can opt-in to landscape; muted backgrounds
    stripped (kept the heatmap's data-bearing
    `bg-indigo-500/N` cells intact); `text-muted-foreground`
    promoted to near-black; the on-screen `text-emerald-500/600`
    and `text-rose-500/600` print as the darker 700 shades so
    income / expense reads on paper; `border-border` upgraded
    to a mid-grey so table grid lines survive the printer;
    `sticky` reset to `static`; `[data-slot="switch"]` and the
    `<label>` that wraps it hidden by default.

  - **Landscape mode** opted into on the three wide reports
    via a `print-landscape` wrapper class:
    [cashflow-report.tsx](src/components/reports/cashflow-report.tsx)
    (many month columns), [accounts-cashflow-report.tsx](src/components/reports/accounts-cashflow-report.tsx)
    (months × accounts), [yoy-report.tsx](src/components/reports/yoy-report.tsx)
    (FY-vs-FY columns).

  - **Per-report chrome hidden** on print across every
    affected tab: page-level toolbars (Subtotals / Total /
    Avg / Plan / Show counts / Hide transfers switches on
    Cashflow), segmented controls (Sankey scope, Treemap
    scope, Heatmap scope, Scatter kind+yScale, YoY scope,
    Payee kind), "Filter to:" category dropdowns on
    Treemap / Heatmap / Scatter, the Financial-year + WFH-
    hours form row on Tax Deductions, and the Root-account
    select on Flow.

  - **Per-report drill-through eye toggles** (the
    `lg:opacity-0 lg:group-hover:opacity-100` icons next to
    category names in Cashflow + Category) marked
    `print:hidden` so they don't sit at the end of every
    category row in print.

  - The on-screen data is preserved exactly — only chrome
    (toggles, segmented controls, hover hints) is suppressed
    for paper.

### Added
- **`tests/e2e/print-screenshots.spec.ts`** captures each
  report's print-media render (portrait/landscape per-tab) so
  any future style change that breaks print is visible in a
  diff. Output lands under `tests/e2e/.data/print-shots/`
  which the global teardown leaves alone.

## 0.172.0 — 2026-05-19

### Changed
- **Reports → Category layout aligned with Cashflow.** First
  pass of the report rendered as plain rows with no separation
  rules. Now matches Cashflow's visual rhythm: depth-based
  indentation on the name column (`px-3` / `pl-9` / `pl-16` for
  root / child / grandchild), vertical `border-l` rules between
  numeric columns, muted "computed" cell background on
  aggregate cells, hover row highlight, `border-b border-border/50`
  between rows. Category names are clickable links to the
  filtered transactions list (same drill-through Cashflow uses).
- **Avg/mo column removed from the Category report.** Cashflow
  still has it; on a single-totals view it was redundant with
  Total since the period is already visible in the date range.

## 0.171.0 — 2026-05-19

### Added
- **Reports → Category** tab. Same data as Cash Flow rolled up
  to one row per category for the selected period — no monthly
  columns, just Total / Avg-per-month / Plan (Budget &
  Scheduled) / Count. Income and Expense sections with
  parent-child indentation, hide-category eye-toggle on each
  row, hidden-cats reveal toggle, and the same Hide-transfers
  switch every other report has. Reuses the existing
  `cashflowShow*` / `cashflowHideTransfers` display-prefs so
  the operator's preferences carry across between Cashflow and
  the Category view (they're the same data summarised
  differently). Reuses `/api/reports/cashflow` — no new
  endpoint needed.

## 0.170.0 — 2026-05-19

### Added
- **Hide-transfers toggle on Reports → Expenses by Category.**
  New `expensesHideTransfers` display-pref keys the toggle (on
  by default — transfer-typed categories obscure "where did the
  money actually go"). Same Switch styling every other report
  uses; the operator's flick persists across reload and devices.

### Changed
- **Reports Print button is now a single Topbar action.** Lives
  in the page Topbar to the left of the profile chip, in the
  indigo variant. Was previously duplicated: a page-level
  outline button on the Reports toolbar and a per-report
  duplicate on the Expenses-by-Category and Accounts panels.
  Both duplicates are gone; the single action covers every
  report tab via the existing `data-print-hide` /
  `print:hidden` machinery.

## 0.169.0 — 2026-05-19

### Changed
- **Add-Transaction dialog reflowed horizontally.** The vertical
  one-field-per-row layout from 0.165 matched
  `useAddCategory()` but felt cramped for a form with eight
  fields. Now uses the same 1/2/3/4-column responsive grid the
  Scheduled-edit form uses — Row 1: Date / Account / Type
  (+ optional counterparty), Row 2: Category / Payee / Amount,
  Row 3: full-width Notes. Tab still walks fields in reading
  order; Cmd/Ctrl-Enter still submits.
- **Transfers can have an empty counterparty.** When Type is
  Transfer-out or Transfer-in, the counterparty picker now also
  carries an italic "External (synthetic)" sentinel; selecting
  it (or leaving the picker empty) mints a synthetic destination
  leg in the App's "External" account — the same shape the
  orphan-transfer backfill creates. Lets the operator record
  outgoing-to-cash / incoming-from-untracked-source transfers
  without the picker forcing them to invent an account first.

### API
- `POST /api/transactions` accepts an optional `syntheticTransfer:
  boolean` field. When `true` and `transferToAccountId` is empty,
  the server finds-or-creates the default `External` account and
  uses it as the destination, marking the dest leg
  `isSynthetic = true`. Pair-linking + balance-recompute behaviour
  is otherwise identical to the existing two-real-account
  transfer path.

## 0.168.0 — 2026-05-19

### Added
- **Settings → Maintenance tab.** Surfaces transfer-pair
  housekeeping that was previously buried elsewhere in the app:
  - **Re-run transfer backfill** — clears
    `app_settings.transfer_backfill_done` and runs the
    orphan-transfer pass. Use after a partial delete, or when
    restoring a DB where the backfill-already-done flag is stale.
    New endpoint `POST /api/transfers/backfill` (admin-only).
  - **Reset & re-scan** — same op as the button buried in the
    transfer-suggestions panel on /transactions; deletes every
    synthetic placeholder and re-runs the matcher. Discoverable
    from Settings now without knowing where to look.
  - **Run ANALYZE** — refreshes SQLite's query-planner
    statistics. The planner picks indexes off
    `sqlite_stat1` / `sqlite_stat4` and those numbers go stale
    after big bulk mutations (large imports, sample-data removal,
    restore). Cheap and side-effect-free apart from rewriting the
    stats tables. New endpoint `POST /api/maintenance/analyze`.

### Performance
- **Three missing indexes filled in** (migration 0011):
  - `payee_rules(normalized_payee)` — every CSV import runs
    `batchLookupPayeeRules()` with `WHERE normalized_payee IN
    (...)` across dozens of distinct payees in a single batch;
    without the index that was a full table scan per payee.
    Biggest user-visible win.
  - `scheduled_transactions(is_active)` — dashboard
    upcoming-schedules + several reports filter on this; tiny
    table today, but the filter runs on every dashboard load.
  - `transactions(transfer_pair_id, date)` — composite that
    prunes `pairTransfersInWindow()`'s self-join to just the
    unpaired rows in the relevant date window. Previously
    ~O(n²) over the unpaired subset.
  All three are `CREATE INDEX IF NOT EXISTS` so the migration is
  safe on a DB that already has them.

## 0.167.0 — 2026-05-19

### Docs
- **`AGENTS.md` grew into a real contributor primer.** It used
  to be a single-line "this is not the Next.js you know" note;
  now it covers local dev quickstart, commit + version policy,
  CHANGELOG style, file / naming conventions, schema migration
  shape, the display-prefs persistence pattern, the multi-DB
  profile model, the codebase's real gotchas (Base UI vs Radix
  idiom, theme `--primary` being near-black, `useState(prop)`
  stale-closure trap, hover-only controls needing `lg:`, the
  TDZ cycle into `src/db/index.ts`), testing, and the release
  flow. `CLAUDE.md` still just `@AGENTS.md`s into it, so Claude
  picks up the same context.

## 0.166.0 — 2026-05-19

### Changed
- **Calendar today-cell accent switched from blue to indigo** so
  the "today" highlight matches the brand-accent convention every
  other Indigo affordance in the app already follows.

### Fixed
- **Two hover-only icons now visible on touch devices.** The
  announcements link arrow ([investments/announcements-panel.tsx](src/components/investments/announcements-panel.tsx))
  and the backup-notes pencil ([settings/backup-list.tsx](src/components/settings/backup-list.tsx))
  used bare `opacity-0 group-hover:opacity-100` without the
  `lg:` prefix, so they stayed invisible on touch viewports
  (no `:hover`). Both now gate the fade on `lg:` only.

### Removed
- **`hideTransfers` prop on every report dropped.** The shared
  toggle was retired in 0.7.0 — each tab has owned its own
  per-report pref since 0.131 — but the dead
  `hideTransfers={false}` was still being threaded through
  every sub-report's interface. Cleaned out of
  [reports-view.tsx](src/components/reports/reports-view.tsx)
  and every sub-report (Cashflow / YoY / Envelope / Sankey /
  Treemap / Heatmap / Scatter / Pareto / Expense-drilldown).
  No behaviour change (the const was hardcoded `false` for two
  major versions); pure plumbing cleanup.

## 0.165.0 — 2026-05-19

### Changed
- **Add-Transaction dialog reworked with a Type dropdown +
  transfer support.** The "negative for outflows" hint is gone —
  amount is now a positive magnitude and the sign is derived from
  a Type select: **Expense**, **Income**, **Transfer out**, or
  **Transfer in**. Picking a transfer type reveals an additional
  "To account" / "From account" picker; on submit the server
  creates BOTH legs in one transaction, cross-linked via
  `transferPairId`, with the dest leg's sign inverted.
- **Field order matches a natural data-entry flow.** Date (pre-
  filled with today) → Account → Type → Other account (when
  transfer) → Category → Payee → Amount → Notes, so plain Tab
  keystrokes walk the operator through the form in the order
  they'd think to enter values. Cmd/Ctrl-Enter submits from any
  field.

### API
- `POST /api/transactions` accepts an optional
  `transferToAccountId` field. When set, the row is treated as
  the source leg and a paired destination leg is auto-created in
  the named account; both legs are cross-linked via
  `transferPairId` and the dest leg's sign is inverted.

## 0.164.0 — 2026-05-18

### Fixed
- **"Create new database" failed with "Profile registered but
  file init failed".** The raw INSERT into `users` inside
  `initProfileFile()` was missing the `name` column, which is
  `NOT NULL` in the schema (legacy of the `email` → `username`
  migration in 0003). The init step crashed with the constraint
  violation, leaving the registry entry orphaned — and because
  the operator's label was now reserved, retrying the same
  label hit the uniqueness guard and reported "duplicate".
  Filled the column in (`'Admin'`), and the API route now also
  rolls back the orphan registry entry on any init failure so
  the operator can retry without a stale lock.
- **Global account filter showed "no accounts" after switching
  databases.** `useAccountFilter` was happily restoring the
  saved `globalAccountIds` from the previous DB into the new
  DB's URL even though those IDs don't exist in the new
  profile, leaving every query filtered to a set of zero
  matching accounts. The hook now intersects both the URL ids
  and the persisted ids against the current DB's visible
  accounts before applying them; if everything turns out to be
  stale (typical post-switch case) the pref is reset and the
  operator lands on a clean "All accounts" state.

## 0.163.0 — 2026-05-18

### Added
- **Manual transaction entry.** New global Add-Transaction dialog
  hosted at the app shell via `AddTransactionProvider`/`useAddTransaction`,
  so the sidebar's right-anchored affordance on the Transactions nav
  row and the toolbar on `/transactions` drive the same single
  instance. The sidebar icon flipped from the Import shortcut to a
  Plus button — Import is still reachable at `/import`. Form fields:
  account (required, defaults to the page's currently-filtered
  account), date (required, defaults today), amount (required —
  negative outflow, positive inflow), payee, category, description,
  notes. POSTs to `/api/transactions`, which mints the normalised
  payee tokens and recomputes the account's running balance; on
  success the dialog mutates all `/api/transactions*`,
  `/api/cashflow*`, and `/api/reports/*` SWR caches so open views
  reshape immediately.
- **Unlink confirmation popup.** Clicking the unlink icon on a paired
  row now stages the pair into a confirmation dialog (instead of
  PATCHing inline). The dialog reuses the shared
  `TransactionCellDialog` so both legs of the transfer render with
  the same Date / Payee / Account / Category / Amount layout the
  report drill-throughs use; the footer surfaces a destructive
  rose-600 "Remove link" button. A new `ids=` query param on
  `/api/transactions` short-circuits the default account scope so a
  pair whose other leg lives in an archived account still resolves.
- The Transactions toolbar now renders its Add / Show-notes controls
  even when the list is empty, so first-time users have the Add
  button visible. Empty-state copy mentions it explicitly.

### Changed
- **Shared `TransactionCellDialog` gains `extraFooter` + optional
  `fullPageHref`.** Lets confirmation-style consumers (e.g. the new
  unlink popup) surface a primary action alongside the standard
  footer link, or hide the link entirely.

### Removed
- **"Bills only" toggle on the cashflow calendar** along with its
  `calendarBillsOnly` display-pref. The planned-dot indicator now
  fires for every unmatched scheduled occurrence regardless of type;
  the bill / non-bill distinction wasn't earning its complexity.

## 0.162.0 — 2026-05-18

### Changed
- **Accounts report drill-through popup gains the inline category
  picker** by sharing a single `TransactionCellDialog` component
  with the cashflow report. Both popups now render the same Date /
  Payee / Account / Category-picker / Amount table, the same SWR
  fetch + recat-revalidation behaviour, and the same footer
  "Open in transactions →" link. Per-report concerns (the query-
  param mapping and the cache key to invalidate after a
  recategorise) stay in each thin wrapper. Picking a new category
  from the accounts popup now reshapes the parent report's totals
  immediately, matching how the cashflow popup already worked.

## 0.161.0 — 2026-05-18

### Added
- **Inline category picker in the cashflow drill-through popup.**
  Clicking a category × month cell on the cashflow report opens a
  list of the underlying transactions; each row now exposes the
  same `CategoryPicker` the main `/transactions` list uses, so the
  operator can recategorise without leaving the report. Picking a
  new category PATCHes the row and revalidates both the popup's
  transaction list and any `/api/reports/cashflow*` SWR cache, so
  the parent report's totals reshape immediately.

### Changed
- **Transactions toolbar consolidates the four toggles into a
  single "View" dropdown.** Replaces the old pair of segmented
  Scheduled / Transfers radio rows with a `SearchableCombobox`
  (same component as Accounts / Categories) exposing five
  mutually-exclusive presets — All transactions, Scheduled only,
  Unscheduled only, Transfers only, Hide transfers. The Saved
  filters button moves up to share the first line with Accounts /
  Categories instead of trailing the toggle cluster.
- **Always-visible indigo icon moves from the link to the unlink
  control.** On the transactions list, the link-as-transfer (Link2)
  icon on unlinked rows is now hover-only and muted; the unlink
  (Unlink) icon on linked rows is always visible in indigo (rose on
  hover). Linked rows are the special case worth surfacing
  prominently — the previous treatment had the colour on the wrong
  side.

## 0.160.0 — 2026-05-18

### Changed
- **Investments page Month/Week/Day/Return toggle now persists.**
  The gain-window picker on the stock + paper-trade tables was
  using local component state, so a reload reset the choice to
  the default ("Return") even after the operator had flicked it
  to "Day". Stored as `display_prefs.investmentsGainRange` so the
  selection survives reload, route changes, and follows the
  operator between devices.

## 0.159.0 — 2026-05-18

### Added
- **Watched-stock dashboard widget.** 2×2, multi-instance,
  gated by the Investments feature flag. Same shape as
  Tracked-stock — in edit mode the card surfaces a selector
  dropdown of every watchlist entry; out of edit mode it
  renders symbol + current price + day-change + a 1-month
  sparkline. Day-change is derived client-side from the tail
  of the history series since the watchlist list endpoint
  doesn't carry a prior-close column. Per-instance config:
  `{ watchlistId: "<uuid>" }`.

## 0.158.0 — 2026-05-18

### Changed
- **Archived databases hidden on the /unlock switcher too.** The
  Switch-database expander on the unlock screen was still
  listing every profile including archived ones, which defeated
  the point of archiving. Archived profiles now fold under a
  secondary chevron ("X archived" → click to reveal) so the
  primary list stays focused on what the operator actually
  unlocks. Matches the sidebar-dropdown behaviour from 0.156.

## 0.157.0 — 2026-05-18

### Fixed
- **CodeQL `js/path-injection` alert #14** on `swapLive()` →
  `renameSync(safe, safeLive)` at
  `src/lib/backup/sqlite-backup.ts:516`. `assertWithinBackupDir`
  only did a containment check; CodeQL's taint analysis didn't
  recognise that as a sanitiser. Added the same basename
  allow-list pattern that resolved alert #13 on `assertLivePath`
  in 0.143 — the resolved basename must match
  `^budgets_(manual|scheduled|pre-restore)_<ts>\.sqlite$` or
  `^budgets_pre-restore_upload-<digits>\.staging$`. Behaviour is
  unchanged for any code path that wasn't already broken; the
  fix is purely about making the sanitiser visible to the
  static-analysis checker.

## 0.156.0 — 2026-05-18

### Added
- **Archive a database.** Settings → Database files grew an
  Archive button per row. Archived databases are hidden from the
  sidebar switcher dropdown (the field that lists "every DB you
  might want to jump to") but remain listed and manageable in
  Settings, with their file + backups untouched on disk.
  Unarchive from the same row to restore. The active DB can't be
  archived — switch to another first.
- **Delete a database.** New trash button per row in the same
  manager. Gated by a typed-confirmation dialog: the operator has
  to retype the database's label exactly before the destructive
  action is allowed. On confirm the registry entry is removed,
  the encrypted SQLCipher file is deleted, and the per-DB backup
  subdirectory is swept. Server-side guards prevent deleting the
  active DB and the last remaining DB.
  New API: `DELETE /api/databases/[id]` (admin-only). The existing
  PATCH endpoint now also accepts `{ archived: boolean }`.

## 0.155.0 — 2026-05-18

### Added
- **Sample-data notice on the transactions page.** When the
  database still has any rows tagged `isSample` (seeded on first
  unlock so the app isn't empty out of the gate), a soft amber
  banner sits above the transactions list with the counts of
  sample accounts / transactions and a one-click "Remove →" link
  to Settings → Security. Server-rendered — no client query, no
  flash on hydrate. Renders nothing once the operator has run
  the removal in Settings.

## 0.154.0 — 2026-05-18

### Changed
- **Undo-import offer auto-dismisses after 60 seconds.** Previously
  the topbar "Undo import (N)" button stayed pinned indefinitely
  until the operator either clicked Undo or hit the × — easy to
  forget about, and the visual chrome lingered every time you
  came back to /transactions in the same tab session. Now the
  button arms a timer on mount and clears itself when the
  `committedAt`-anchored window lapses. A defensive check in
  `readPendingUndoImport()` also drops a stale sessionStorage
  entry if a different tab returns to /transactions after the
  window has already passed.

## 0.153.0 — 2026-05-18

### Changed
- **"Apply new rules to pending rows" toggle now defaults ON and
  persists.** 0.151 introduced the toggle but defaulted it to OFF,
  so a user who categorised a row during import didn't see the
  rule recategorise the rest of the pending file — they had to
  cancel + re-upload to see the rule take effect. That defeated
  the point. The toggle now defaults ON, and the operator's
  choice is stored in `display_prefs.importAutoApplyRules` so it
  follows them between sessions and devices.

## 0.152.0 — 2026-05-17

### Fixed
- **Bulk-category update on the transactions page didn't visibly
  refresh.** Searching for transactions, selecting all, picking a
  category from the toolbar correctly PATCH'd the rows on the
  server, but each row's CategoryPicker stayed showing its old
  trigger label until the page was refreshed. The picker
  initialised local state from the `categoryId` prop with
  `useState(categoryId)` and never re-synced — so the parent's
  optimistic SWR write flipped the prop, but the local state was
  frozen at the post-mount value. Added a `lastSeenProp` ref so
  the picker sees the prop change and syncs local state without
  clobbering any in-flight user pick on the same row.

## 0.151.0 — 2026-05-17

### Added
- **"Apply new rules to pending rows" toggle on the CSV import
  page.** When on, picking a category for a row via the in-row
  picker doesn't just create the payee rule — it also rewrites
  the local category override for every other pending row that
  shares the same normalised payee. Saves hand-categorising
  twenty Coles rows when one rule covers them all. A toast
  reports how many sibling rows were filled in. Off by default
  so existing flows are unaffected; rows the operator already
  overrode by hand are preserved (their pick wins over the
  fan-out).

## 0.150.0 — 2026-05-17

### Added
- **Resolve unknown accounts inline during CSV import.** Imports
  whose source bank-account-id didn't match any existing account
  (no alias, no last-4 hit, no heuristic match) used to flash an
  amber "X rows have no resolved account — won't be committed"
  banner and force the operator out to Settings → Accounts to
  create the account, then come back and re-upload. The unresolved
  rows are now grouped by bank-id directly above the row table;
  each group has a picker for existing accounts plus a "+ New"
  shortcut. Picking or creating an account immediately resolves
  every row sharing that bank-id and writes a bank-account alias
  via `POST /api/import/learn-aliases` so next time the same file
  is parsed it auto-resolves.
- **Global `useAddAccount()` hook + `AddAccountProvider`.** Mirrors
  `useAddCategory()` from 0.147 — a globally-mounted modal with
  name / type / institution / last-4 / starting-balance fields,
  optimistic SWR cache write so the new account shows up in
  pickers across the app the moment it's saved. Available to any
  component under `(app)/layout.tsx`.

## 0.149.0 — 2026-05-17

### Fixed
- **Inline "Create category" *still* didn't fill the import
  row.** 0.148 fixed the SWR-cache plumbing but left a stale-
  closure bug in `RuleCreator.handleChange`: when the picker's
  Create flow fires `onChange`, it does so via the OLD onChange
  closure captured at the time `addCategory.open()` ran — and
  that closure's `categories.find(...)` is reading the prop
  captured at the OLD render, not the live SWR cache. The .find
  returned undefined and the function bailed out before the
  PATCH could land. Synced a `categoriesRef` inline on each
  render so the captured handleChange sees the freshest list at
  call time.

## 0.148.0 — 2026-05-17

### Fixed
- **Inline "Create category" didn't apply to the source row.** The
  0.147 picker affordance closed the dialog cleanly but the row
  it opened from showed the empty placeholder instead of the new
  category, and the picker's option list didn't include the new
  row until the page was refreshed. Two compounding bugs:
  - The Add-Category dialog only *invalidated* the
    `/api/categories` SWR cache after POST; nothing pre-seeded
    the new row, so subscribers stayed stale until the
    background revalidation returned. Switched to an optimistic
    cache write that injects the new row synchronously, then
    revalidates in the background.
  - The CSV import view fetched categories via plain
    `useState + fetch` instead of SWR, so it never subscribed
    to the cache at all — `globalMutate` was a no-op for it.
    Converted to `useSWR("/api/categories")` so the optimistic
    write reaches the import-row picker the same way it reaches
    everywhere else.

## 0.147.0 — 2026-05-17

### Added
- **Create a category from the picker.** Type a name into any
  category picker (transaction row, CSV import row, bulk-action
  bar, scheduled-transaction form, schedule button, dashboard
  widget config, daily-heatmap filter) — if the typed text
  doesn't match an existing category, a "+ Create '<query>'"
  affordance appears at the bottom of the popover. Picking it
  opens the existing Add-Category dialog with the name
  prefilled (and the type preset when the picker has a
  `typeFilter`, e.g. import rows whose sign already implies
  income/expense). On save, the new category id is applied
  back to the field that opened the picker — no extra click,
  no navigation away from where you were working.
- **Generic `onCreate` hook on `SearchableCombobox`.** The
  underlying combobox primitive grew an opt-in `onCreate`
  prop: any caller can wire a "Create '<query>'" empty-state
  row. The transactions bulk-action picker uses it to pop the
  Add-Category dialog; other callers (account / payee
  pickers) are unchanged.

### Changed
- `useAddCategory().open()` now accepts `name` (prefill) and
  `onCreated` (callback fired with the row returned by
  `POST /api/categories`) so picker callers can immediately
  bind the new id to the source field.
- Parent-pickers inside the category editor (New + Edit
  forms) opt out of the create affordance — opening another
  Add-Category dialog from inside an Add-Category dialog is
  recursive and unhelpful.

## 0.146.0 — 2026-05-17

### Added
- **Settings → Databases tab.** A new manager that lists every
  registered database profile alongside its on-disk filename +
  created-at date. Inline rename per row (click the rename
  button → edit → Enter to save, Escape to cancel). The active
  profile is highlighted indigo + tagged "active". Delete is
  intentionally out of scope for v1 — too easy to wipe data by
  accident; the active-profile guard + backup cleanup flow
  needs more thought before that lands.
- **DB switcher dropdown shows the filename.** The sidebar
  dropdown now renders each profile as a two-line cell — label
  on top, filename in monospace below — so duplicate or
  ambiguous labels can still be disambiguated visually. Same
  data, just surfaced in the UI.
  New API: `PATCH /api/databases/[id]` accepts `{ label }`,
  enforces case-insensitive uniqueness.

### Fixed
- **`createProfile()` accepted duplicate labels.** Creating
  "Test DB" three times produced three identical entries in
  the switcher dropdown (the filename slugs were unique, but
  the labels weren't). Added a case-insensitive uniqueness
  check — fails fast with "A database labelled X already
  exists".

## 0.145.0 — 2026-05-17

### Fixed
- **"Create new database" failed with `table categories has no
  column named updated_at`.** The system-categories seeder for a
  fresh DB was running a raw `INSERT INTO categories (... ,
  created_at, updated_at)` — but the `categories` table doesn't
  have an `updated_at` column (unlike every OTHER table on the
  schema). The 0.142 multi-DB rework re-introduced the column
  reference when the seeder switched from drizzle's typed insert
  to raw SQL. Dropped the trailing column + the matching
  `strftime('%s','now')*1000` value; new-DB create now flows
  through.

## 0.144.0 — 2026-05-17

### Fixed
- **Multi-DB switcher dropdown items were silent no-ops.** The
  0.142 implementation used `onSelect` (a Radix idiom) where Base UI's
  `MenuPrimitive.Item` fires `onClick`. Clicking a profile in the
  sidebar dropdown or "Create new database…" did nothing. Both
  handlers swapped to `onClick`.
- **`/api/backup` 500s on a fresh multi-DB install** — the per-
  profile backup subdir (`<base>/<profileId>/`) doesn't exist
  until the first backup is taken, and `diskUsage()`'s single-level
  fallback (`dirname(dir)`) landed on `<base>/` which also doesn't
  exist on a never-backed-up install. Walks up the directory chain
  to the filesystem root before calling `statfs` now.
- **Orphan-transfer backfill crashed silently in production**
  (`ReferenceError: Cannot access 'al' before initialization`).
  `src/lib/backfill-orphan-transfers.ts` was importing `db` at the
  top level, which webpack bundled into a cycle with `src/db/index.ts`
  (`db/index.ts` lazy-requires the backfill module from inside
  `unlock()`, while the backfill's top-level import re-entered the
  still-initialising `db` module → TDZ). Pulled the import inside
  the function so it resolves at call time.

### Changed
- **Audit pass — UX + a11y cleanups:**
  - Switch thumb gets `dark:bg-slate-200` so the dark-theme glare
    goes away (the thumb was bright white on the indigo track).
  - `aria-current="page"` on the active profile entry in the DB
    switcher dropdown — visual cues (indigo + "active" pill) are
    now duplicated semantically.
  - Vest delete in `investments/investment-detail-panel.tsx` gated
    behind `useConfirm()` — was a one-click no-undo data loss.
  - `<span onClick={stopPropagation}>` wrapper in `import-view.tsx`
    rewritten as `<div>` — the click handler was a pure
    bubble-suppressor, not interactive, so it shouldn't carry the
    implicit click-target semantics a `<span onClick>` does.
- **Backups tab is full-width** in Settings. The page-level
  `max-w-2xl` constraint was moved to each non-backup
  `<TabsContent>`; the Backups tab now uses the full Settings
  area to make room for the notes column added in 0.141 + the
  per-DB backup-dir layout from 0.142.
- **TODO.md rewritten.** Every item from the 2026-05-15 "Up
  next" table shipped in 0.131 → 0.143; cleared the table,
  rolled the items into "Done / dropped". New blind-spot section
  for multi-DB coverage gaps.

### Security
- **Rate-limit on `/api/unlock` + `/api/rekey`** — 5 attempts per
  60-second window per process, then 429 + `Retry-After`. Self-
  hosted single-tenant blast radius is small, but the deterrent
  blunts accidental typo bursts + casual scripted scans. New
  helper at `src/lib/rate-limit.ts`. Successful unlock clears
  the counter so legit fat-finger sequences don't waste their
  remaining budget.
- **Reject control characters (CR / LF / TAB / NUL / DEL) in
  passphrases** at the validation boundary. SQLCipher's
  `PRAGMA key = '...'` interpolation escaped single-quotes
  already; the control-char block closes the
  newline-terminates-statement vector. New helper at
  `src/lib/passphrase.ts`, wired into both `/api/unlock` and
  `/api/rekey`.

## 0.143.0 — 2026-05-17

### Fixed
- **CodeQL `js/path-injection` on the restore swap.** After 0.142.0
  turned `livePath` from a constant into a getter resolving through
  the multi-DB registry, the `renameSync(safe, livePath())` call in
  `swapLive()` raised an alert: `livePath()` ultimately reads
  `accounts.filename` from the on-disk `databases.json`, which is
  operator-editable. `parseRegistry()` already enforces a strict
  filename allow-list (`/^[A-Za-z0-9_.\-]{1,80}\.db$/` +
  `basename === filename`), but CodeQL doesn't see that as a
  sanitiser when the value flows through a getter and back into
  `fs.*`. Fix follows the same shape as the existing
  `assertWithinBackupDir` guard — new `assertLivePath()` helper
  asserts `resolve(p).startsWith(resolve(dirname(p)) + sep)` AND
  re-applies the allow-list regex on `basename()`, then returns
  the sanitised path. The caller in `swapLive` binds the return
  value before the fs operations, which is the dataflow pattern
  the CodeQL checker recognises.

## 0.142.0 — 2026-05-17

### Added
- **Multiple databases.** A single install can now host several
  independently-encrypted databases side-by-side. Each profile is a
  `{ id, label, filename }` triple registered in a new
  `databases.json` file at the data-directory root (next to the
  encrypted SQLite files). Per-DB passphrase, re-unlock on switch,
  no cross-DB views.
  - **Switcher** in the sidebar header: lists every profile, picking
    one POSTs to `/api/databases/switch`, locks the current
    connection, and routes the operator to `/unlock` for the new
    profile.
  - **Create flow:** "Create new database…" entry in the switcher
    dropdown. Prompts for a label + passphrase, registers the
    profile, creates a fresh SQLCipher file with that passphrase,
    auto-runs drizzle migrations + seeders (default user + system
    categories — no sample data), and auto-unlocks the new file so
    the operator lands on the empty dashboard ready to use.
  - **On the /unlock page**, a "Switch database" expander surfaces
    every registered profile and lets you re-target the unlock form
    without re-typing the current profile's passphrase first
    (useful when you've forgotten the passphrase or just want a
    different one). The form's title also shows which profile
    you're entering the passphrase for.
- **Per-DB backup directory.** Backups now live in
  `<base>/<profileId>/budgets_<type>_<timestamp>.sqlite` rather than
  the flat `<base>/`, so multiple databases' backups don't collide.
  On first unlock after upgrade, any legacy single-DB backups
  sitting in the old `<base>/` location are auto-moved into
  `<base>/default/` — fully idempotent, no operator action needed.

### Changed
- **Backup schedule moves from `app_settings` to the registry.** The
  scheduled-backup config (enabled / intervalDays / retain) is now
  stored in `databases.json` so a single global schedule governs
  every profile, per the user spec. Existing installs whose
  schedule was set in `app_settings.backup_schedule` will need to
  re-toggle it on Settings → Backups after upgrade — the old
  config isn't auto-migrated to avoid silently re-enabling
  something the operator had disabled.
- **`db.livePath` is now a function.** Previously a constant
  exported from `src/db/index.ts`, it's been converted to a getter
  (`livePath()`) that resolves through the registry to the active
  profile's filename. Internal callers in the backup module update
  accordingly — no external surface affected.

### Schema
- New module: `src/lib/db-profiles.ts` — profile registry + the
  global backup schedule.
- New API routes:
  - `GET /api/databases` (public — no auth, surfaces profile labels
    + active id only; safe because labels aren't sensitive and the
    encryption keys never leave the operator's head).
  - `POST /api/databases` (admin) — create + auto-unlock.
  - `POST /api/databases/switch` (public — same security model as
    GET; switching just changes which encrypted file the next
    unlock attempt targets).
- New helpers in `src/db/index.ts`: `switchProfile(id)`,
  `initProfileFile(profileId, passphrase)`.

## 0.141.0 — 2026-05-17

### Added
- **Notes field on backup rows.** Each backup in Settings →
  Backups now has an inline-editable Notes column. Click "Add
  note…" (or an existing note) to type a short annotation —
  Enter to save, Escape to cancel. Useful for tagging
  snapshots like "before the 2024 tax cleanup" or "pre-import
  prod data".
  Notes live in a `<backup-filename>.meta.json` sidecar next to
  the backup file, intentionally OUTSIDE the encrypted SQLCipher
  payload so the annotation is readable without the passphrase,
  survives restore swaps, and is easy to inspect from a shell.
  Empty / whitespace-only notes delete the sidecar so the
  directory stays clean.
  New API: `PATCH /api/backup/[filename]` with body
  `{ notes: string }`.

## 0.140.0 — 2026-05-17

### Added
- **"Reset & re-scan" button on the Transactions page.** Sits next
  to "Re-scan transfers" in the TransferSuggestionsPanel. Deletes
  every `is_synthetic=true` placeholder row (FK's `ON DELETE SET
  NULL` clears the surviving partner's `transfer_pair_id`
  automatically) and then runs `pairTransfersInWindow({})` over
  the whole DB so any orphan whose real counterpart exists in a
  tracked account gets auto-paired. Useful when the 0.137.0
  backfill minted synthetics in External for transfers whose real
  counterparts actually do live in tracked accounts (e.g. after
  restoring a DB where partial deletes had cleared the pair_ids).
  Confirmation dialog before firing — destructive op.
  New endpoint: `POST /api/transfers/reset-and-rescan`.

## 0.139.0 — 2026-05-17

### Fixed
- **Orphan-transfer backfill is now once-per-DB.** The unlock-time
  backfill introduced in 0.137.0 was scanning + minting synthetics
  on every unlock, which surprised users who restored an older DB:
  any rows in the restored snapshot that had the legacy
  `is_transfer=1` flag but no `transfer_pair_id` were treated as
  orphans and paired with new synthetic counterparts in the
  External account — even when the user considered those rows
  "fully matched" already. New idempotency flag
  `app_settings.transfer_backfill_done` (drizzle 0010) gets set
  to 1 after the first successful pass on any given DB; subsequent
  unlocks short-circuit and leave the data alone. Re-running can
  be triggered manually by clearing the flag (Settings →
  Maintenance UI to come).

## 0.138.0 — 2026-05-17

### Changed
- **Accounts report cells open an inline popup, not a full-page
  navigation.** Clicking any non-zero numeric cell in the
  Accounts-cashflow table now opens a dialog listing the underlying
  transactions in place — same pattern the Cashflow report uses for
  its category cells. Includes Date / Payee / Account / Category /
  Amount columns, a transaction count + total in the header, and an
  "Open in transactions →" link in the footer for the rare case
  where you want the full filter view. Balance cells stay
  unclickable (they're closing-balance snapshots, not transaction
  sums). New component:
  `src/components/reports/accounts-cell-dialog.tsx`.

## 0.137.0 — 2026-05-17

### Added
- **"Link as transfer" supports external (untracked) counterparties.**
  The Link-transfer dialog gains a second action below the tracked-
  account candidate list: a text field where you type the
  counterparty name ("HSBC savings", "Mom", "PayPal", etc.). The
  backend finds-or-creates an `isExternal=true` account with that
  name, inserts a synthetic counterpart transaction there (opposite
  sign, same date, marked `is_synthetic=true`), and links both
  sides via `transfer_pair_id`. Subsequent links to the same name
  reuse the account; autocomplete in the input surfaces existing
  external accounts so duplicates from casing differences don't
  pile up.
- **Synthetic-leg reconciliation on CSV import.** If the user later
  imports the real bank CSV for an account that has synthetic
  stubs (e.g. they decide to start tracking HSBC savings after
  having linked transfers to it), the commit-batched route now
  matches each incoming row against existing synthetics in that
  account (±3 day window, exact amount), and PROMOTES the
  synthetic in place — preserving `id` and `transfer_pair_id` so
  the source-leg's pointer stays valid. The synthetic's
  `is_synthetic` flag is cleared on promotion. No duplication, no
  manual re-linking.

### Changed
- **Single source of truth for "is this a transfer?" — the
  `transfer_pair_id` column.** The `isTransferRow` SQL helper
  introduced in 0.136.0 has collapsed to a one-signal predicate
  (`transfer_pair_id IS NOT NULL`). The auto-matcher
  (`pairTransfersInWindow`), `manualPair`, and the new
  `manualPairExternal` all stop writing `is_transfer` — the
  column is now legacy data. Cashflow report's `hideTransfers`
  uncategorised branch swaps `is_transfer = 0` for the equivalent
  `transfer_pair_id IS NULL`.
- **`/api/transactions/[id]/transfer-pair`** accepts a new body
  shape: `{ external: "<counterparty name>" }`. The original
  `{ pairId: <uuid | null> }` shape is unchanged.
- **`manualUnpair` deletes synthetic counterparts.** When the
  unpaired row's partner was an auto-minted synthetic stub, the
  stub has no remaining purpose — it's deleted outright instead
  of being left as orphaned noise in the external account.

### Fixed (data backfill)
- **Orphaned legacy transfer rows get pair_ids on first unlock.**
  A one-shot startup backfill mints synthetic counterparts in a
  default "External" account for every row matching:
  `is_transfer = 1 AND transfer_pair_id IS NULL`, OR a category
  whose `transfer_kind` is internal/external with no pair. This
  closes the divergence the 0.136.0 audit found between the three
  legacy signals and gives every transfer-flavoured row a real
  pair_id going forward. Idempotent — second runs find zero
  orphans. After this lands, every existing query that filters on
  "is this a transfer" agrees, regardless of which historical
  signal was used to mark it.

### Schema
- New column: `transactions.is_synthetic` (boolean, default false).
  See `drizzle/0009_transactions_is_synthetic.sql`.

### Not removed (yet)
- The `transactions.is_transfer` column and the
  `categories.transfer_kind` enum stay in the schema — read by
  the backfill to find orphans, and still surfaced in API
  responses for UI compatibility. A future release will drop
  them once we've confirmed no consumer (in-app or in users'
  scripts) still relies on the values.

## 0.136.0 — 2026-05-17

### Fixed
- **Import crash on modest CSVs (~100 KB or more).** The
  categorise dry-run endpoint's stage-2 trigram pass ran
  `suggestCategoryByHistory()` inside `Promise.all(stage2.map(...))`,
  and that helper did its own full table scan of `transactions`
  on every call. For a 99 KB CSV with ~800 stage-2 rows that
  fanned out to ~800 concurrent full-table scans, each holding a
  copy of the result buffer in V8 memory — straight OOM kill on
  the container.
  Fix: extend `suggestCategoryByHistory()` with a
  `preloadedCandidates` parameter and pass the trigram pool that
  the categorise route ALREADY fetches once at the top of the
  block. The outer loop also drops `Promise.all` for a plain
  `for…of` — better-sqlite3 is synchronous internally, so the
  Promise.all gave no real concurrency; it just kept N copies of
  the buffer alive at once. Memory now stays at one pool's worth
  for the whole import regardless of CSV size.
- **Scheduled-transfer false-positive "missed payment" warning.**
  When a recurring transfer schedule's two real legs are correctly
  paired (`transfer_pair_id` set, `is_transfer = 1`), the destination
  leg still surfaced as MISSED. Root cause: `expandRecurrence()`
  projected BOTH legs per occurrence, and `matchSchedule()`'s
  per-occurrence category filter rejected the destination leg
  because the transfer auto-matcher only categorises the SOURCE
  side — the destination keeps its original (usually NULL)
  category.
  Fix: add a `transferDualLeg?: boolean` option to
  `expandRecurrence()` (default `true`, preserves existing
  cashflow / dashboard behaviour). The scheduled list view and
  the missed-scheduled panel pass `transferDualLeg: false` so
  matching runs against the source leg only; the pair-display
  block in the list view recovers the destination row by walking
  the source's `transfer_pair_id` instead.

### Changed
- **Shared transfer-row predicate.** New
  `src/lib/transfer-filter.ts` exposes a canonical
  `isTransferRow` SQL fragment (`category.transfer_kind IN
  ('internal','external') OR transactions.is_transfer = 1`). The
  Accounts-cashflow endpoint's two inline copies of this OR are
  now expressed via the named helper. Cashflow's
  `hideTransfers` filter — which is intentionally narrower
  (`transfer_kind != 'internal'` only, so external transfers like
  loan payments still count as real cashflow) — is left alone;
  the helper's JSDoc spells out the divergence so future
  developers don't blindly unify them.

## 0.135.0 — 2026-05-17

### Changed
- **Print button promoted to the page-level Reports toolbar.** Sat
  inside the Envelope card's header before, where it got crowded
  by the All / Income / Expenses + Hide transfers controls and
  forced them onto a second row. Now sits at the far-right of the
  page toolbar next to Quick range — works for every report tab,
  not just Envelope. Window.print() + existing data-print-hide /
  data-print-area CSS rules carry the scoping through unchanged.
- **Envelope card title row no longer wraps.** With Print gone,
  All / Income / Expenses + Hide transfers + Expand all all fit
  on the same line as the "Envelope" title.

## 0.134.0 — 2026-05-17

### Changed
- **App logo replaces the 💰 emoji.** Custom illustration (calendar
  + bar-chart card + gold coin stack) replaces the placeholder
  emoji in three places: mobile topbar, desktop sidebar header, and
  the login card. The asset's white background was knocked out to
  transparent so it sits cleanly on both light and dark themes — no
  white rectangle bleeding through in dark mode.
- **Favicon updated.** Both `src/app/icon.png` (modern browsers)
  and a regenerated multi-size `src/app/favicon.ico` (16/32/48/64/
  128/256) now use the new logo.

## 0.133.0 — 2026-05-17

### Fixed
- **Accounts report drill-through respects the clicked
  counterparty.** Clicking a "Transfer in from B" / "Transfer out
  to B" cell used to land on `/transactions` filtered only by
  direction + `transfersFilter=only` — so the resulting list
  showed every transfer in that direction (from B, C, D,
  External…), not just the ones paired with B. The list summed
  to the wrong number.
  - New URL param on `/api/transactions`:
    `transferPairAccountId=<uuid|external>`. UUID restricts to
    rows whose `transfer_pair_id` points to a transaction in that
    account; `external` restricts to unpaired transfers (the
    "External" counterparty bucket in the report). The SQL
    condition mirrors the accounts-cashflow API's grouping on
    `pair.account_id` so the resulting list sums to the cell.
  - `buildCellHref()` + `<MetricRow>` in the accounts report
    thread the counterparty through; per-counterparty rows now
    emit `transferPairAccountId=<…>` on every cell.
- **Per-month Balance cells in the accounts report are no longer
  clickable.** They were linking to "every transaction in this
  account for this month," which doesn't sum to the closing-balance
  snapshot displayed in the cell. Same logic that already kept the
  Balance Total column unlinked (it's a snapshot, not a sum)
  applies per-month — `buildCellHref()` now returns `null` for
  every `balance` cell.

## 0.132.0 — 2026-05-17

### Fixed
- **Flow report: archived counterparty accounts no longer render
  as "Unknown".** The Sankey's account-name lookup was built only
  from `/api/accounts` (which omits archived rows by default), so
  any archived account on the other end of a transfer fell through
  to the "Unknown" fallback. The cashflow API already carries
  `counterpartyName` + `counterpartyColor` for every leg (server
  resolves them from a full accounts scan that INCLUDES archived
  rows), matching what the Accounts report uses for its
  per-counterparty rows — so the fix is to merge those into the
  client-side lookup table. No API change.

## 0.131.0 — 2026-05-17

### Added
- **Envelope report — All / Income / Expenses three-way toggle.**
  Sits next to the other report toolbar controls; defaults to All
  (current behaviour). Picking one side drops the other section
  and the bottom "Affordability / Shortfall" net row (which has
  no meaning when only one side is visible). Persisted via
  `displayPrefs.envelopeScope`.
- **Scheduled Transactions page — All / Selected accounts toggle
  in the topbar.** Defaults to **All accounts** so the page opens
  showing every schedule regardless of the sidebar's account
  filter (matches how operators actually use the page — budget
  planning is rarely scoped to a single account). Switch to
  **Selected accounts** to defer to the sidebar like the rest of
  the app. Persisted via `displayPrefs.scheduledAccountFilterMode`.
- **Hide-transfers toggle on every analytics report.** Cashflow,
  Sankey, Envelope, YoY, Treemap, and Scatter each grow their
  own `Hide transfers` switch in the header. Default is **ON**
  on every tab — transfer-typed categories (transferKind in
  `internal`/`external`) were polluting the totals on most
  reports. Flip off per-tab to include them again. Each tab owns
  its own pref so the choice on the Cashflow tab doesn't change
  the Sankey, etc.: `cashflowHideTransfers`,
  `sankeyHideTransfers`, `treemapHideTransfers`,
  `scatterHideTransfers`, `yoyHideTransfers`,
  `envelopeHideTransfers` (all default `true`).

## 0.130.0 — 2026-05-17

### Changed
- **Flow report — root-account view becomes a 3-column ribbon:
  `inbound | root | outbound`.** Picking a root account now puts
  that account in the middle of the Sankey as a single shared node;
  every account that sent money INTO root sits in the left column,
  every account that received money FROM root sits in the right
  column. An account that's on both sides of root in the window
  appears once on each side (separate copies), which is correct —
  the two ribbons represent independent legs. The root rectangle
  gets an indigo outline + label so it stays the focal point. In
  "All accounts" mode the layout is unchanged (left-source /
  right-destination split-by-side).
- **Flow report — counterparties render regardless of the sidebar
  account filter** (mirrors the Accounts report's per-counterparty
  rows). Specifically:
    - Root-mode fetches only the root account's cashflow and walks
      its own `transferInBy[]` / `transferOutBy[]`, so every
      counterparty leg is captured even if the sidebar filter
      excludes the other end.
    - All-mode now also walks each filtered account's
      `transferInBy[]` for inbound legs whose source is OUTSIDE the
      sidebar — previously only `transferOutBy[]` was iterated, so
      a non-filtered account paying a filtered one was missed.
    - Internal pairs are deduped against the filtered-set so an
      A→B leg with both A and B in the sidebar is still counted
      exactly once.

## 0.129.0 — 2026-05-17

### Added
- **Flow report — Sankey of money between accounts.** New tab on
  `/reports` (sits next to Accounts) visualising transfers as
  variable-width ribbons between source and destination accounts.
  Each account splits into a left "source" and right "destination"
  node so two-way pairs render cleanly without cycles. A root-account
  picker narrows the chart to ribbons touching a single chosen
  account; a "Hide external" switch drops any leg whose other end
  isn't a tracked account.
  Reuses `/api/reports/accounts-cashflow` — no new endpoint, no
  schema change — and iterates each account's `transferOutBy[]`
  exactly once so internal pairs aren't double-counted.

### Changed
- **Super page: "Add person" moves to the topbar as an indigo CTA.**
  Mirrors the Transactions page's Import button placement — the
  primary affordance for the page lives next to the profile dropdown
  rather than below the people grid. Inline naming flow is preserved
  (input + Add + cancel inline in the topbar). Driven by
  `<AddPersonButton />`; `SuperPageBody` now only owns the people
  grid + delete callback.

## 0.128.3 — 2026-05-17

### Fixed
- **Super page: new people showed every other person's snapshots.**
  The `/api/super` GET endpoint still validated the `?person=…`
  query parameter with `z.enum(["self","partner"])` — a leftover
  from before 0.127's N-people refactor. Any new person key
  (e.g. `bob` from "Add person → Bob") silently failed the parse,
  the route fell through to the unfiltered query branch, and
  returned **every** snapshot regardless of person. So adding
  "Bob" appeared to inherit data from "self" and "partner". Fixed
  by replacing the enum with a free-text `z.string().min(1).max(60)`
  in three places:
  - `/api/super/route.ts` GET filter
  - `/api/super/route.ts` POST `createSchema` (also broke new-snapshot
    creation for arbitrary keys)
  - `/api/super/[id]/route.ts` PATCH `updateSchema` (broke snapshot
    edits for arbitrary keys)

  No data was lost or rewritten — the snapshots are correctly
  stored under each person's key. The bug was strictly in the read
  path. Adding a new person on the upgraded image will now show
  the empty state it should have shown all along.

## 0.128.2 — 2026-05-17

### Fixed
- **Transfer matcher now runs automatically after every import
  commit.** Up to this release the `/api/import/commit-batched`
  endpoint explicitly skipped transfer-pair matching — and no UI
  surfaced the `/api/transfers/repair` endpoint either — so a
  user importing a CSV that contained a transfer would never see
  it auto-paired unless they happened to know the secret URL.
  That was the actual cause behind "imports are missing the
  match": the matcher was never running. Two changes:
  - `pairTransfersInWindow({})` now runs after the commit succeeds
    (inside a try-catch so a matcher failure can't fail the
    commit). The response payload gains `transfersPaired` and
    `transfersSuggested`; the import view surfaces a toast like
    "3 transfers auto-paired" so the behaviour is visible.
  - **`TransferSuggestionsPanel` always renders** (was: only when
    suggestions existed) and includes a new "Re-scan transfers"
    button that hits `/api/transfers/repair` directly. The user
    can retroactively pair anything that landed before this
    release. The panel collapses to a quiet single-row state when
    suggestions are zero so it doesn't crowd the page.

### Added
- **6 new transfer-matcher integration tests** covering the
  realistic single-bank flows that were untested:
  - Lenient account-name match (one payee mentions the other
    account, score crosses AUTO_THRESHOLD without needing
    transfer-kind categories).
  - ±3 day gap handling — bank posts the credit a day late.
  - Refusal to pair across a >3 day gap (out of window).
  - Loan-boundary pair auto-assigns "Loan Payment" category on
    the source side.
  - Existing pairs (manual or auto) survive a re-run untouched.
  - Idempotency — running the sweep twice produces zero new
    pairs on the second pass.

  Brings the integration test count from 4 → 10. Total suite
  is 294 passing.

## 0.128.1 — 2026-05-17

### Fixed
- **Accounts report: manually-paired transfers now appear in the
  counterparty breakdown.** Both the per-account aggregate and the
  per-counterparty rows in
  `/api/reports/accounts-cashflow` were filtering on
  `c.transfer_kind IN ('internal','external')` only, which silently
  dropped any transaction paired via the manual-link dialog (those
  rows have `is_transfer = 1` but the category's `transfer_kind`
  stays `'none'` — `manualPair()` sets the pair link without
  touching the user's category). Both filters now also accept
  `t.is_transfer = 1`, so manually-paired rows land under the right
  counterparty without losing the user's category choice. Pure
  read-side change; no schema migration, no data rewrite.

### Changed
- **Transaction-row link icon is now always visible in the indigo
  CTA colour.** The chain-link "Link as transfer" affordance on
  unpaired rows used to be hover-revealed in muted grey, which
  buried a useful action behind discovery friction. It's now shown
  on every unpaired row in `text-indigo-600 dark:text-indigo-400`
  so the affordance is obvious at a glance. The Unlink button on
  paired rows stays hover-revealed in rose — it's destructive, so
  nagging the operator with it on every row would be the wrong
  energy.

## 0.128.0 — 2026-05-17

### Removed
- **Boxplot report tab.** The per-category quartile distribution
  added in 0.110 turned out to be the report the operator actually
  reaches for least; the scatter + treemap tabs cover the same
  "where does the variance live" question more legibly. Deleted:
  the tab + `<BoxplotReport>` component, the
  `/api/reports/category-quartiles` endpoint, the `quartiles.ts`
  helper, and its test file. Saved 7 tests (288 total, was 295) +
  removed the long-window default for the boxplot tab.

### Fixed
- **Scatter report tooltip now shows every point on the hovered
  date instead of one.** With ~20 transactions on a busy day, the
  default Recharts tooltip surfaced a single point that often
  wasn't the one the cursor's vertical guideline was over —
  reading as "the tooltip zooms in from the left and doesn't hit
  the target". The custom tooltip now derives the hovered
  timestamp from the active payload, filters every point with that
  same x, and lists them all (capped at 12 rows; surplus appears
  as "+N more"). When the day has more than one transaction the
  tooltip also shows a Total at the bottom. Also passes
  `isAnimationActive={false}` so the tooltip jumps directly to its
  position instead of tweening across the chart on every hover.

## 0.127.0 — 2026-05-17

### Changed
- **Superannuation page: 1 or more people, not fixed at 2.** The
  page used to render two `<SuperView>` columns (`self` + `partner`)
  regardless of household size, which left a perpetually-empty
  "Partner" column for single-person households. Replaced with a
  dynamic list managed via a new `app_settings.super_people` JSON
  column (migration `0008_super_people.sql`).
  - **Add person**: button at the bottom of the page accepts a
    free-text label (e.g. "Sarah"), auto-slugs it into a stable key,
    and appends to the list. Numeric-suffix collision avoidance so
    two people can share a first name.
  - **Rename person**: click the heading on any `<SuperView>` and
    edit inline — same affordance as before, now routed through
    the new `/api/super/people/[key]` PATCH instead of the old
    label-pair endpoint.
  - **Remove person**: trash icon next to the heading (hover-revealed
    on desktop). Confirmed via the same `useConfirm` dialog the
    transactions list uses; on confirm, every snapshot for that
    person is deleted alongside the people-list entry. The last
    remaining person can't be removed (the trash icon is hidden so
    the page always has something to render).
  - **Layout**: 1 person → full-width single column; ≥2 → two-column
    grid on lg+, single-column below. Wraps gracefully past two
    people on lg+ (they stack into rows).
  - **Migration**: `loadSuperPeople()` lazy-derives the initial list
    from existing snapshots + the legacy `super_self_label` /
    `super_partner_label` columns. No data migration needed; older
    installs land on the new page with their existing self / partner
    setup intact, and the first write to the people list (rename or
    add) snapshots it into the JSON column.

### Removed
- **`/api/super/labels` endpoint** — replaced by the new
  `/api/super/people` CRUD endpoints. The legacy
  `super_self_label` / `super_partner_label` columns remain on
  `app_settings` for one release as a backfill source for
  `loadSuperPeople()`; planned for removal in a later cleanup.

### Security
- **Code-scanning: 5 path-injection alerts dismissed as
  false-positive.** The flagged dataflow passes through
  `assertWithinBackupDir(p)` which resolves the path and asserts
  `startsWith(backupDir())`, returning the validated value for the
  caller to re-bind. The runtime guard is correct; CodeQL's heuristic
  doesn't recognise this particular sanitiser pattern. Filenames
  are also pre-validated via `isSafeBackupFilename()` on every API
  route. Documented the rationale on each dismissed alert.

## 0.126.1 — 2026-05-17

### Fixed
- **Investments announcements were showing generic financial news.**
  v0.125's `getNews` filter accepted items with no `relatedTickers`
  tag, which Yahoo applies to general Wall-Street roundups — those
  ended up in the panel even when nothing recent existed for the
  specific ticker. Tightened the filter:
  - Items must have a non-empty `relatedTickers` (drops generic
    feeds).
  - The list must include the searched symbol *or its bare form*
    — e.g. searching for `CBA.AX` accepts items tagged `CBA` or
    `CBA.AX`, since Yahoo sometimes drops exchange suffixes from
    its own tags.
  Item-count window widened from 10 to 20 so the strict filter
  still has a reasonable pool. When the symbol genuinely has
  nothing recent, the panel correctly shows "No recent
  announcements" instead of irrelevant noise.

## 0.126.0 — 2026-05-17

### Added
- **Accounts report: every numeric cell drills into
  /transactions.** Click any value in the Credits / Debits / Net /
  Transfer in / Transfer out / Balance rows and you land on the
  transactions list pre-filtered to that account + month + metric
  (e.g. Credits in May = the source account scoped to a `direction=in`
  filter for that month's window). The Total column links to the
  whole-period view. The all-accounts footer rows skip the account
  filter so the drill-down spans every visible account. The Balance
  row's Total cell stays unlinked because it's a closing-balance
  snapshot, not a sum that would round-trip against a transaction
  list.

### Fixed
- **Migration 0007 now applies cleanly under better-sqlite3.** The
  driver doesn't accept multi-statement SQL strings; the original
  `0007_investment_news.sql` jammed CREATE TABLE + two CREATE INDEX
  statements together, which broke every test that booted the
  in-memory DB. Reformatted with `--> statement-breakpoint`
  separators (drizzle's convention; see `0000_narrow_black_panther.sql`
  for prior art). Existing prod DBs won't re-run the migration; this
  only affects fresh installs and the test DB.

## 0.125.0 — 2026-05-17

### Added
- **Investments: "Recent announcements" panel** on every
  investment's detail page (stocks, paper-trades, RSUs, options).
  Pulls 10 most-recent headlines for the ticker from Yahoo
  Finance's news endpoint, filters to items whose
  `relatedTickers` includes the symbol, and renders title +
  publisher + relative-published-time + thumbnail. Items link
  out to the original publisher's page in a new tab. Cached
  server-side in a new `investment_news` table (migration
  `drizzle/0007_investment_news.sql`); refreshed when the most
  recent cache row is older than 24h. Yahoo upstream failures
  fall back to the cached payload tagged `stale: true` rather
  than 5xx-ing the panel.

### Security
- **CodeQL: path-injection sanitiser pattern.**
  `assertWithinBackupDir(p)` now RETURNS the resolved safe path
  rather than just asserting in place — callers (`verifyBackup`,
  `looksLikeSqlcipher`, `swapLive`) re-bind via
  `const safe = assertWithinBackupDir(path)` and use the
  returned value downstream. CodeQL's `js/path-injection`
  checker walks the dataflow through the return value to
  recognise the sanitiser; the prior assert-and-discard pattern
  left the original tainted variable in scope.
- **CodeQL: one more `<Link href>` interpolation encoded.**
  Caught a third interpolated href in `cashflow-report.tsx`
  (line 930, the grandparent-header `<HierRow>` call) that the
  first sweep missed. Now wraps `group.grandparentId` / `from`
  / `to` in `encodeURIComponent`.

## 0.124.4 — 2026-05-17

### Fixed
- **Transaction row: Search icon now stays at a consistent
  x-position across paired and unpaired rows.** The chain-link
  "Link as transfer" button was only rendered on unpaired rows,
  so the icon-cluster width differed and the Search icon shifted
  left on paired rows. Paired rows now render an Unlink button
  in the same slot — same width, plus a useful affordance: click
  to break the transfer pair directly from the row without
  digging into the linked-details panel. Both buttons follow the
  existing hover-revealed pattern (`lg:opacity-0
  lg:group-hover:opacity-100`).

## 0.124.3 — 2026-05-16

### Added
- **LICENSE — PolyForm Noncommercial 1.0.0.** Personal /
  household use, hobby projects, charities, education, public
  research, and government use are all permitted. Commercial
  use is **not** granted. The licence is the canonical PolyForm
  text plus a "Required Notice" line at the bottom referencing
  this repo. README's Licence section summarises the practical
  scope.

### Security
- **CodeQL: path-injection sanitisers on every backup function.**
  Added `assertWithinBackupDir(path)` to
  [src/lib/backup/sqlite-backup.ts](src/lib/backup/sqlite-backup.ts)
  — resolves the candidate path and throws if it isn't rooted in
  `backupDir()`. Called at the top of `verifyBackup`,
  `looksLikeSqlcipher`, and `swapLive`. The existing
  `isSafeBackupFilename` validator on the routes was already
  blocking traversal; this is belt-and-braces so any future caller
  that skips the filename check can't pass an arbitrary path. The
  pattern (resolve → assert startsWith root+sep) is the canonical
  one CodeQL recognises as a sanitiser, so it also closes the 5
  open `js/path-injection` alerts.
- **CodeQL: URL-encode interpolated values in cashflow-report
  hrefs.** The two `<Link href={...}>` interpolations in
  [src/components/reports/cashflow-report.tsx](src/components/reports/cashflow-report.tsx)
  wrap every value (categoryId, from, to, uncatDirection) in
  `encodeURIComponent` even though they're DB-controlled (UUIDs +
  ISO dates). Closes the 2 open `js/xss-through-dom` alerts.

## 0.124.2 — 2026-05-16

### Security
- **Transitive-dep CVE sweep via `pnpm.overrides`.** Dependabot
  reported 15 open advisories across the lockfile (8 high, 6
  medium, 1 low). Pinned the floor on every affected package
  in `package.json`'s `pnpm.overrides` block so future installs
  can't regress:
  - `tar ≥ 7.5.11` — 7 high-severity advisories: hardlink &
    symlink path traversal, drive-relative linkpath traversal,
    APFS-Unicode race condition. Pulled in via
    `@signalapp/better-sqlite3`'s prebuild fetcher (no runtime
    surface — already stripped by the Linux Dockerfile, but the
    install-time tooling itself was vulnerable).
  - `postcss ≥ 8.5.10` — medium XSS via unescaped `</style>`
    in CSS stringify; via Next's build pipeline.
  - `esbuild ≥ 0.25.0` — medium: dev server allowed cross-origin
    requests to read responses (dev only).
  - `fast-uri ≥ 3.1.2` — 2 high: host confusion + path traversal
    via percent-encoded segments (dev tooling).
  - `ip-address ≥ 10.1.1` — medium XSS in HTML-emitting methods
    (dev tooling).
  - `hono ≥ 4.12.18` — 3 advisories: CSS declaration injection
    via JSX SSR, NumericDate validation in JWT verify, cache
    middleware leak across users (all dev tooling).

  Side effect: `@signalapp/better-sqlite3`'s prebuild fetcher
  doesn't recognise tar 7's tarball format and falls back to
  compiling from source on first install. Slower deps-stage
  install (~2.5 min vs seconds) but the resulting `.node`
  binary is identical at runtime.

  All 295 tests still pass against the upgraded tree.

## 0.124.1 — 2026-05-16

### Security
- **Next.js 16.2.4 → 16.2.6** (closes GitHub issue #1 / Dependabot
  advisory bundle). The patch release contains 7 high-severity
  fixes:
  - GHSA-8h8q-6873-q5fj — DoS via Server Components
  - GHSA-267c-6grr-h53f / GHSA-26hh-7cqf-hhc6 — App-Router
    middleware/proxy bypass via segment-prefetch routes (and the
    incomplete-fix follow-up)
  - GHSA-mg66-mrh9-m8jx — DoS via connection exhaustion in
    Cache-Components apps
  - GHSA-492v-c6pp-mqqv — middleware/proxy bypass via dynamic
    route parameter injection
  - GHSA-c4j6-fc7j-m34r — SSRF via WebSocket upgrades
  - GHSA-36qx-fr4f-26g5 — Pages-Router middleware bypass under i18n

  Plus 4 moderate fixes (CSP-nonce XSS, beforeInteractive XSS,
  Image-Optimization DoS, RSC cache poisoning) and 2 low (RSC
  cache-busting collisions, redirect cache-poisoning). `eslint-
  config-next` bumped in lockstep to match.

## 0.124.0 — 2026-05-16

### Added
- **Sidebar: "Buy me a coffee" link** above the version footer,
  pointing at <https://buymeacoffee.com/budgets>. Small coffee icon,
  amber hover tint, muted at rest — discoverable but not noisy.
- **`.github/FUNDING.yml`** so the repo's "Sponsor this project"
  button on GitHub points at the same Buy Me a Coffee page.

## 0.123.1 — 2026-05-16

### Fixed
- **Transaction row's Google-search icon no longer floats centred.**
  Adding the new chain-link button in 0.123 gave the payee cell's
  `justify-between` flex container three direct children instead of
  two, so the Search icon ended up midway between the payee and the
  link button. Wrapped both right-side buttons in a single
  `inline-flex` cluster so the parent's `justify-between` keeps the
  payee on the left and all action icons flush right.

## 0.123.0 — 2026-05-16

### Fixed
- **Transfer auto-matcher: same-day same-amount collisions now
  resolve more often.** The matcher's `bestFor()` was returning null
  whenever a transaction's top-2 candidates tied on score+gap, which
  meant generic-payee multi-transfer days left everything unpaired.
  Two coordinated changes in
  [src/lib/transfer-match.ts](src/lib/transfer-match.ts):
  - **Posted-order tiebreaker** — added `tiebreakDistance(c)` as a
    third sort key after score/gap. Smaller = the two halves of the
    candidate posted closer together. Fallback chain:
    `postedSeq → postedAt → createdAt`. The greedy outer loop and
    `bestFor()` both use it.
  - **Live-filter on `taken` candidates** — `bestFor()` now ignores
    candidates whose other side has already been paired. So when the
    first correct pair commits, the surviving candidates' ambiguity
    collapses naturally and the second pair can also commit. Without
    this, the second pair would stay stuck on the now-unreachable
    cross-candidate.
  Genuinely indistinguishable candidates (every signal ties) still
  defer to suggestions — pinned by a regression test.

### Added
- **Manual "Link as transfer" button on every unpaired
  transaction row.** Chain-link icon in the payee cell
  (hover-revealed on desktop, always visible on mobile) opens a new
  `<LinkTransferDialog>` pre-filtered to:
  - Unpaired transactions only.
  - Other accounts (not the source's).
  - Opposite-sign amount within ±$1 of the source.
  - Date within ±7 days.
  A "Show all" toggle relaxes the amount filter for the
  fee-adjusted-transfer case ($500 sent / $499.95 received).
  Clicking a candidate calls the existing manual-pair API
  (`PATCH /api/transactions/<id>/transfer-pair`) and refreshes the
  transactions list. Handles every case the auto-matcher can't —
  the matcher now defers to suggestions safely, and the dialog is
  the user's escape hatch when neither suggestions nor the matcher
  can resolve a pair.
- Test coverage for the matcher's new behaviour: 3 helper-level
  tests for `tiebreakDistance` (posted_seq / postedAt / createdAt
  fallback chain) + 4 integration tests against an in-memory
  SQLite covering the four-way collision happy path, the
  truly-indistinguishable case, the single-pair regression, and
  the below-threshold case. New file:
  [src/lib/transfer-match.integration.test.ts](src/lib/transfer-match.integration.test.ts).

## 0.122.0 — 2026-05-16

### Changed
- **Accounts report: transfer rows now broken down by counterparty.**
  The single "Transfer in" / "Transfer out" sub-rows per account
  rolled every internal/external transfer into one number, hiding
  the actually-useful detail: *where* the money came from / went to.
  Replaced with one row per paired account — e.g. "Transfer in from
  Savings", "Transfer out to Mortgage" — each with its own per-month
  series and total. Counterparty resolved via `transfer_pair_id`
  joined back to the transactions table; transfers with no recorded
  pair surface under the synthetic "External" label. Each row gets
  a small colour-dot swatch matching the counterparty account so the
  paired account is identifiable at a glance.
- `/api/reports/accounts-cashflow`: `AccountsCashflowAccount` gains
  `transferInBy[]` and `transferOutBy[]` arrays. The existing
  `transferInByMonth` / `transferOutByMonth` aggregates stay (still
  used in the all-accounts footer).

## 0.121.0 — 2026-05-16

### Removed
- **Windows desktop build (Electron) — reverted.** Versions
  0.120.0 through 0.120.8 added an Electron-based portable .exe
  alongside the Linux container. Maintaining the second artifact
  produced too much churn (repeated CI failures from
  pnpm-isolated-linker / NFT-trace gaps, oversized installers,
  Windows-specific env handling) for what the household actually
  needs. Deleted:
  - `electron/main.cjs`, `electron-builder.yml`,
    `scripts/electron-prepare.mjs`,
    `scripts/electron-build-win.mjs`,
    `scripts/release-notes.mjs`,
    `.github/workflows/electron-windows.yml`
  - `electron`, `electron-builder` devDependencies + all
    `electron:*` npm scripts + the `main`/`description`/`author`
    fields that electron-builder needed in `package.json`
  - GitHub releases v0.120.0 through v0.120.8 (and the
    corresponding git tags)
  The Linux container release flow (`pnpm docker:release` →
  `registry.service.local`, `ghcr.io/budgets-au/budgets`) is the
  only release artifact again. Functionality at this commit is
  the same as 0.119.0 — no app-code changes were carried in the
  0.120.x lineage.

## 0.119.0 — 2026-05-16

### Added
- **Accounts report: three new per-account sub-rows.** Between
  Debits and Balance every account (and the all-accounts footer)
  now renders:
  - **Net (credits − debits)** — signed monthly net, emerald when
    positive, rose-parenthesised when negative; Total column is the
    period net so the operator sees at a glance whether the
    account ran a surplus over the window.
  - **Transfer in** — the subset of credits whose category has
    `transferKind` in {internal, external}; tinted sky so it reads
    as a different signal from regular income.
  - **Transfer out** — the subset of debits with the same category
    filter; tinted amber.
  Transfers stay included in the existing Credits / Debits rows
  (they're real cashflow on a single-account view); the new rows
  decompose those totals into transfer vs non-transfer so the
  operator can see how much movement is just shuffle between own
  accounts vs genuinely entering or leaving the household.

## 0.118.0 — 2026-05-16

### Added
- **New /reports tab: "Accounts" — per-account balance over time.**
  Same column layout as the cashflow report (months across the top,
  Total on the right) but the row axis is account instead of
  category. Each active account is a parent row that expands to
  three sub-rows:
  - **Credits** — sum of positive transactions per month (emerald).
  - **Debits** — absolute sum of negative transactions per month (rose).
  - **Balance** — closing balance at the end of each month, with
    negatives parenthesised in rose. The Total column on the Balance
    row is the closing balance at `to` (a snapshot, not a sum).
  Bottom "All accounts" footer aggregates the same three series
  across the selected accounts. Default range is 11 months (long-
  window tab) so the trend has room to read. Endpoint:
  `/api/reports/accounts-cashflow?from=&to=&accountIds=` — opening
  balance per account is `starting_balance + Σ(txns before from)`,
  matching how the calendar's per-account series is back-computed.

## 0.117.0 — 2026-05-16

### Fixed
- **Left-nav sidebar now reflects account archive / edit changes
  without a page refresh.** Settings → Accounts toggled archived
  state via `PATCH /api/accounts/:id` and the edit dialog saved
  name/colour/type the same way, but both only called
  `router.refresh()` (or nothing). The sidebar's account list is a
  client component subscribed to SWR(/api/accounts), which a server
  refresh doesn't touch — the rail kept showing the pre-change
  state until a full reload. Added `mutate("/api/accounts")` to the
  archive toggle and edit-dialog success paths so the SWR cache
  invalidates alongside the server-tree refresh.

## 0.116.0 — 2026-05-16

### Fixed
- **Envelope "X hidden" badge now counts only categories actually
  present in the current view.** Previously it reported the raw size
  of the excluded-category preference. If you hid a category on a
  multi-year window and then narrowed to a period where that
  category had no activity, the badge still said "1 hidden" with
  nothing visibly suppressed — confusing. The count now ignores
  excluded categories whose rolled total is zero in both the income
  and expense trees for the active period, so the badge only shows
  up (and only ticks up) when there's something the operator could
  reveal by toggling it.

## 0.115.0 — 2026-05-16

### Added
- **Envelope report shows income above expenses and an affordability
  total at the bottom.** The report was previously an expense-only
  envelope; the headline "set aside this much per envelope" answered
  half the question without anchoring it to what was coming in. Two
  new sections in the same table:
  - **Income** rows at the top (emerald section header), with a
    subtotal at the bottom of the section. Same tree expand/collapse
    + eye-off exclude as the expense rows, sharing the same display
    prefs.
  - **Expenses** below (rose section header), with their own subtotal.
  - **Affordability / Shortfall** footer: signed net (income −
    expenses) across the period, broken out per month, week, and
    day. Green when positive (money left to save or spend), red
    when negative (you outspent income).
  The empty-state copy now reads "No income or expenses in this
  period" since either side can populate the report. The row
  rendering itself was extracted to an internal helper so income
  and expense rows render via the same code path.

### Fixed
- **Calendar day panel: "scheduled match" pills now stay attached
  to the correct real transaction.** The matcher
  (`matchScheduledToReal`) keyed its result set by the position of
  each real event inside cashflow's own merged `events` array, but
  the day-detail panel renders real rows from a separate
  `/api/transactions` fetch sorted by the user's chosen column.
  The two index spaces almost never agreed, so when more than one
  match existed for a day the pills appeared one (or more) rows off
  from the row they actually described. Re-keyed `claimedReal` /
  `realToSched` by the transaction's own `id` so both consumers
  (day panel and the grid cell's planned-dot check) look up matches
  by identity instead of position. The matcher's scheduled side
  stays positional inside `scheduledEvents` — that source array
  is identical for matcher and consumers, so it can't drift.

## 0.113.0 — 2026-05-16

### Fixed
- **Calendar: budget schedules no longer falsely claim real
  transactions.** A scheduled budget ("$200 weekly Groceries"
  — a spending cap, not a single planned outflow) was running
  through the same real-vs-scheduled matcher as scheduled
  payments. Any random $200 grocery purchase within ±5 days
  ended up tagged as the fulfilment of that budget — the day
  panel popover then showed a "matched" pill linking the txn
  to a budget instead of leaving it as an unscheduled purchase,
  and a separate scheduled-payment that genuinely should have
  claimed it stayed orphaned. Two-part fix:
  - `CashflowEvent` gains an optional `kind` field; the cashflow
    builder tags projected events with `s.kind` so the calendar
    can tell budgets apart from payments downstream.
  - `matchScheduledToReal` in `cashflow-calendar.tsx` skips
    events with `kind === "budget"` when populating the
    candidate list. Budgets still render as planned rows in the
    day panel; they just no longer participate in matching.

## 0.112.0 — 2026-05-16

### Changed
- **Heatmap is now a category × month grid.** The GitHub-
  contributions-style 7-row × N-week day grid was answering the
  wrong question — "which day had a spike" rarely matters. The
  redesigned heatmap is a true matrix: rows = leaf categories
  (sorted by total spend descending), columns = months in the
  window, cell colour = sqrt-scaled spend amount for that
  category-month. Hovering a cell shows the dollar figure;
  clicking opens `/transactions` filtered to that category +
  month. Reuses `/api/reports/cashflow` — no new endpoint. The
  expense / income toggle and the category-root filter dropdown
  (the same one the other reports use) work here too. The
  orphaned `/api/reports/daily-spend` endpoint is removed.

### Fixed
- **Scatter tooltip really does read the scatter datum now.**
  0.111's fix matched the payload entry by `name === "Transactions"`,
  but Recharts sometimes shadows `name` with the dataKey on
  ComposedChart, so the search missed and every tooltip fell
  back to "Uncategorised". Now the tooltip finds the entry whose
  datum has a `categoryName` field at all — robust against
  future Recharts churn. Colour swatch wired into the row so the
  dot's category-colour shows next to the label.
- **Scatter / Boxplot / Pareto exclude internal-transfer
  categories by default.** Money moved between own accounts isn't
  real spending and was distorting the boxplot's per-category
  distribution + the Pareto's payee ranking. SQL now always
  filters `c.transfer_kind != 'internal'`; external transfers
  (real outflow to outside banks) stay visible. The existing
  `?hideTransfers=true` query escape hatch still excludes all
  transfer kinds entirely.
- **Heatmap also drops internal-transfer categories** via cross-
  reference with `/api/categories` (the cashflow payload doesn't
  carry `transferKind`, so the report joins the two SWR-loaded
  payloads client-side). Replaces a brittle regex-on-name hack
  that incorrectly included some external-transfer rows.

## 0.111.0 — 2026-05-16

### Fixed
- **Treemap rectangles weren't rendering.** The custom tile-content
  component was reading data fields off `props.payload.*`, but
  Recharts' `<Treemap content={...}>` spreads the per-cell data
  directly onto `props` (alongside its computed
  `x/y/width/height/depth/name/value/children`) — there is no
  `payload` envelope. Switched to reading `props.name`,
  `props.value`, `props.paletteIndex`, etc. directly; depth-0
  synthetic container is now skipped instead of painting the
  whole viewport.
- **Scatter tooltips showed every dot as "Uncategorised".** The
  scatter's `<ComposedChart>` carries two series — the scatter
  itself and the 14-day-mean line — and the tooltip's `payload`
  array contains entries for both. The naïve `payload[0]` was
  often the line's data point (which has no `categoryName`), so
  every tooltip fell back to the placeholder. Tooltip now finds
  the scatter entry by `name === "Transactions"` and reads its
  datum.

### Added
- **Drill-down via category root on treemap / scatter / boxplot.**
  Each chart gains a "Filter to:" `<CategoryDropdown>` that picks
  the current root of the view. Two backend changes:
  - `/api/reports/transactions-points` and
    `/api/reports/category-quartiles` accept
    `?rootCategoryId=<uuid>`; the server resolves the subtree
    via `categoryDescendantIds()` and adds
    `AND t.category_id IN (...)` to the WHERE.
  - Treemap's existing click-to-drill now sets the same `drillId`
    state the dropdown writes to, so the two interactions drive
    one source of truth. "Back" becomes "Up" and steps one level
    via the tree's `parentId` pointer (was previously jumping all
    the way to root).
  Dropdown shows every category in the household tree so the
  operator can jump anywhere (Groceries → Fresh produce →
  Supermarket) without click-walking through each level.

## 0.110.0 — 2026-05-15

### Added
- **Five new reports tabs** — Treemap, Heatmap, Scatter, Boxplot,
  Payees. The previous 8 tabs were all aggregated views; these
  five surface different axes the existing reports couldn't:
  - **Treemap** (`?tab=treemap`) — Recharts `<Treemap>`,
    rectangles sized by absolute spend, nested by category
    hierarchy (grandparent → parent → leaf), colour from
    `CATEGORICAL_PALETTE`. Click a non-leaf rectangle to drill
    in; "← Back" returns. Reuses
    `/api/reports/cashflow` — no new endpoint. Expense / income
    toggle.
  - **Daily heatmap** (`?tab=heatmap`) — GitHub-contributions-
    style 7-row × N-week grid, cell colour intensity =
    sqrt-scaled day-total absolute spend, hovered cells show
    date + total + transaction count, clicked cells navigate to
    `/transactions?from=<day>&to=<day>`. Backed by a new
    `/api/reports/daily-spend` route.
  - **Transaction scatter** (`?tab=scatter`) — `<ComposedChart>`
    with `<Scatter>` per transaction (X = date, Y = absolute
    amount, colour = category) plus a white 14-day rolling-mean
    `<Line>` overlay. Linear / log Y toggle; expense / income /
    all toggle. Capped at 5 000 rows; the cap surfaces a warning.
    New endpoint `/api/reports/transactions-points` + new
    `src/lib/reports/rolling-mean.ts` pure helper (vitest
    coverage).
  - **Per-category boxplot** (`?tab=boxplot`) — inline-SVG row
    per category showing whiskers (min..max), Q1..Q3 box,
    median tick, outliers (Tukey's 1.5·IQR) as dots. Recharts
    has no native boxplot so it's rendered as absolutely-
    positioned tinted divs against a shared 0..globalMax scale
    so categories are visually comparable. New endpoint
    `/api/reports/category-quartiles` (SQLite has no
    `PERCENTILE_CONT`; quartiles computed in Node via the new
    `src/lib/reports/quartiles.ts` helper).
  - **Payee Pareto** (`?tab=payees`) — top-25 payees by absolute
    spend, `<ComposedChart>` with `<Bar>`s + a cumulative-%
    `<Line>` on a right Y axis. `<ReferenceLine>`s at 80% and
    95% anchor the eye on the 20/80 boundary. Bar click →
    `/transactions?q=<payee>` so the operator can drill into the
    raw rows. A trailing "(other N)" bar accounts for the
    long-tail rows past the 25 cap. New endpoint
    `/api/reports/payee-totals`.

### Changed
- **Sidebar "Lock database" button is centered.** Was
  left-aligned with the icon hugging the left padding; now
  uses `justify-center` so the icon + label sit in the middle
  of the row, matching the visual weight of the version footer
  above.

### Internal
- `src/lib/reports/rolling-mean.ts` — pure sliding-mean helper
  with vitest coverage (`rolling-mean.test.ts`).
- `src/lib/reports/quartiles.ts` — type-7 quantile + Tukey
  five-number summary with vitest coverage
  (`quartiles.test.ts`).

## 0.109.0 — 2026-05-15

### Changed
- **Import-review row style matches `/transactions` for new
  rows.** Pre: new rows (will-INSERT) had a yellow tint, matched
  rows had a green tint. Post: new rows render with the same
  neutral `hover:bg-muted` the live transactions table uses, so
  the import-review reads like the same surface the operator
  will land on after commit. Matched rows keep their emerald
  tint — that "already in the DB" state is the important visual
  signal worth keeping a distinct colour.
- **Stronger indigo on the import-review CategoryDropdown when a
  row needs a category.** Bumped from `bg-indigo-500/15
  border-indigo-500/40 text-indigo-700` (light) to
  `bg-indigo-500/30 border-indigo-500/70 text-indigo-800`
  (dark: `bg-indigo-500/40 border-indigo-400 text-indigo-100`).
  Reads as "this needs your attention" rather than a hint.

## 0.108.0 — 2026-05-15

### Changed
- **Schedule editor: Delete moves to per-row trash in the
  lineage members table.** 0.107 put the Delete affordance at
  the form's top-right which conflated "the form's commit axis"
  with "this lineage member" — destructive on something the
  cursor wasn't necessarily on. Trash icon now sits next to the
  GitBranch (migrate) button in each lineage member row's last
  column. Click → existing `setConfirmDelete` dialog (handles
  single-member-lineage cleanup) → `performDelete`. The
  `onDelete` prop on `ScheduledEditForm` is removed entirely.

## 0.107.0 — 2026-05-15

### Changed
- **Selected lineage member background matches selected-schedule
  background.** Pre: the schedule list row used
  `bg-indigo-500/30 dark:bg-indigo-500/40`, the lineage members
  table used `bg-muted` — same selection role, two different
  treatments. Both now use the indigo-500/30 palette so the
  visual rhyme is consistent across the two CTAs.
- **Scheduled editor: Delete moves top-right, Save moves to where
  Delete was + uses indigo.** Pre: Save (default variant) lived
  on the left of the action row; Delete (destructive) at the
  right. Post: Delete moves to the top-right of the form (next
  to the Schedule/Budget kind toggle) as a small ghost Trash
  icon, removing the risk of a misclick on a destructive op
  while the cursor's on Save. Save sits at the right-end of the
  action row with the indigo CTA variant — the primary commit
  reads as the primary action.

## 0.106.0 — 2026-05-15

### Changed
- **Sidebar Sign-out button removed.** Wasn't carrying weight —
  the operator can lock the database (still in the sidebar) or
  let the session cookie expire. Reduces sidebar footer to a
  single Lock-database action.
- **Dashboard edit-mode Save layout button uses the indigo CTA
  variant.** The Cancel + Save pair now reads as a proper
  "primary commit, secondary cancel" pattern matching the
  topbar CTAs (Import, New Scheduled, etc).

## 0.105.0 — 2026-05-15

### Security
- **Default-password nag banner across the app shell.** When the
  user's stored password still matches the `admin/admin` seed
  (detected server-side at NextAuth `authorize` time via a
  `compare("admin", user.passwordHash)` re-check after the
  login compare succeeds), the JWT carries
  `session.user.mustChangePassword = true`. A new amber strip
  at the top of the (app) layout reads "Default admin/admin
  password still in use. Change it before exposing this server
  beyond your LAN." with a link to Settings → Security. The
  banner stays until the user changes their password AND signs
  back in (next login re-runs the compare and the flag clears).
  Non-blocking: navigation still works, but the strip is
  persistent on every route until resolved. No schema change,
  no migration — pure runtime check on login (one extra ~80 ms
  bcrypt compare).

## 0.104.0 — 2026-05-15

### Security / Added
- **Password-change Dialog replaces `window.prompt`.** Settings →
  Users → KeyRound now opens a proper `<Dialog>` with two
  `<Input type="password">` fields (new + confirm), an 8-character
  minimum, and a mismatch check. Replaces a native `window.prompt`
  that was plaintext, single-field, unmaskable, and with no
  confirm. Submits to the existing `PATCH /api/users/[id]`
  endpoint. The KeyRound button gains an
  `aria-label="Change password for <username>"` so screen
  readers announce the target.

## 0.103.0 — 2026-05-15

### Added
- **Undo on the /transactions bulk-delete toast.** Pre: deleting
  a batch popped a "Deleted N transactions" toast with no
  recovery path. Post: bulk-delete now snapshots the rows before
  the DELETE fires and sonner's toast carries an `action: {
  label: "Undo" }` that re-POSTs each row to `/api/transactions`
  via `Promise.allSettled`. ~10 s window before the toast
  auto-dismisses. Caveat documented in the snapshot comment:
  transfer-pair links don't survive an undo cycle — POST doesn't
  carry `transferPairId`, so a previously-paired row gets
  recreated as a standalone transaction and needs manual re-pair.
  Pragmatic trade-off vs. a full soft-delete schema change.

## 0.102.0 — 2026-05-15

### Added
- **"+" button on each widget-drawer pill.** Drag-and-drop placement
  isn't keyboard-reachable (HTML5 `draggable` doesn't have an Enter
  equivalent), so each pill in the dashboard's edit-mode drawer now
  carries a `<button aria-label="Add … to dashboard">` that appends
  the widget at the bottom of the grid (y = current max y, x = 0).
  Same flow as a drop — `multiInstance` widgets get a fresh
  `instanceId`, single-instance widgets are guarded against
  double-placement — but no pointer needed. Keyboard users can Tab
  to the pill, Tab to the +, Enter to place.

## 0.101.0 — 2026-05-15

### Removed
- **Cancel button on the scheduled-transaction editor.** It wasn't
  carrying weight — the form had no unsaved-changes warning and
  the user could already dismiss by clicking another row,
  navigating away, or closing the page. Dropped from the
  `ScheduledEditForm` action row + the `onCancel` prop on the
  component and its three callers (`scheduled-detail.tsx`,
  `scheduled-list-view.tsx`, `new-scheduled-dialog.tsx`). The
  Cancel button inside the Replace sub-dialog stays — that one
  is a real modal exit.

## 0.100.0 — 2026-05-15

### Fixed
- **Saved-filter rows are keyboard-reachable.** Pre: each row in
  the /transactions filter-preset popover was a `<li onClick>` —
  the click worked, but Tab/Enter never landed on it. Now each
  preset is a real `<button type="button">` for the apply action,
  with the existing delete icon as a sibling `<button>`; both
  share the hover-row treatment.
- **Payee-rules delete asks for confirmation + has `aria-label`.**
  Pre: clicking the trash icon next to a payee rule fired the
  DELETE request immediately and the icon-only button had only a
  `title` attribute. Post: deletion routes through `useConfirm()`
  with a rule-specific message; the button gains
  `aria-label="Delete payee rule for <normalizedPayee>"` so
  screen readers announce what's being deleted.

## 0.99.0 — 2026-05-15

### Added
- **New `indigo` button variant + four headline CTAs migrated to
  it.** `Button` / `buttonVariants` gain a brand-accent solid
  variant: `bg-indigo-600 hover:bg-indigo-700 text-white` (dark:
  `bg-indigo-500 hover:bg-indigo-400`). Migrated:
  - Import — `ImportTransactionsButton`
  - New Scheduled — `NewScheduledButton`
  - Edit dashboard — `DashboardShell`
  - Add Investment — `AddInvestmentButton`
  Per-page primary actions now stand out from the neutral
  Primary buttons that live inside forms.

### Changed
- **Import commit redirects to `/transactions` + Undo moves to
  the topbar.** Pre: the import-review page replaced its Commit
  button with a red Undo card and left the operator stranded on
  `/import`. Post: a successful commit stashes `importLogIds`
  in `sessionStorage` and immediately routes to `/transactions`
  where a new `UndoLastImportButton` sits next to the Import
  affordance in the topbar. The operator sees the rows they just
  landed and can roll back if anything looks wrong; a × button
  next to Undo dismisses the affordance once they're happy. The
  inline post-commit card in `import-view.tsx` is gone (~90 lines
  removed). `src/lib/import-undo.ts` carries the shared
  sessionStorage interface.
- **Import-review CategoryDropdown tints indigo when the row
  needs a category.** Per-row CategoryDropdown trigger picks up
  `bg-indigo-500/15 border-indigo-500/40 text-indigo-700` (light)
  / `text-indigo-300` (dark) when `currentCategoryId` is empty
  and the row has a normalised payee. Once a category is picked
  the tint clears. Scope is the dropdown trigger only — the row
  background stays its existing yellow/emerald state colour so
  the new/duplicate distinction remains obvious.

## 0.98.0 — 2026-05-15

### Added
- **Budgets toggle on the Upcoming dashboard widget.** Small
  pill at the top right next to "See all →" — when active the
  widget includes `kind="budget"` schedules in the next-30-days
  list (defaults off, so the list stays focused on planned
  outflows). Persisted via `dashboardUpcomingShowBudgets` in
  display-prefs. `/api/dashboard/upcoming` now accepts
  `?includeBudgets=true` and passes through to `expandRecurrence`'s
  existing `includeBudgets` option; the "already paid" filter
  is skipped for budget rows (caps don't match 1:1 against
  transactions). `UpcomingScheduleRow` gains a `kind` field so the
  widget could render budget rows with a different affordance in
  the future.
- **Notes toggle on the Recent transactions dashboard widget.**
  Same pill pattern; when active, each row gets a second
  text-[10px] italic line under the payee with the transaction
  note (only when present). Dynamic-row-count accounting adjusts
  from 32 px to 48 px per row so ResizeObserver still picks a
  sensible visible count. Persisted via `dashboardRecentShowNotes`
  in display-prefs. `/api/dashboard/recent-transactions` returns
  the `notes` field; the prior payload didn't include it.

## 0.97.0 — 2026-05-15

### Fixed
- **`lg:` prefix on every hover-only `opacity-0 group-hover:*`.**
  Five affordances were invisible on touch devices because their
  `opacity-0` started fully transparent and only un-hid on
  `:hover`, which mobile never gets. Sweep across:
  - `super-view.tsx` heading edit pencil
  - `transaction-row.tsx` transfer-unlink button
  - `transactions/schedule-button.tsx` "+ schedule" affordance
  - `envelope-report.tsx` per-row exclude eye
  - `transactions/saved-filters.tsx` per-preset delete
  All now `lg:opacity-0 lg:group-hover:*`, so mobile shows them
  fully and `lg+` keeps the hover-reveal behaviour. Matches the
  `feedback_mobile_hover.md` convention.

## 0.96.0 — 2026-05-15

### Changed
- **`/scheduled` no longer auto-selects the top row on naked cold
  load.** The eager auto-pick used to fire a ~10 k-row
  `/api/transactions` fetch for the right panel on every cold
  navigation, which is wasted work for users arriving without a
  specific schedule in mind. URLs that carry `?id=` are still
  honoured (deep-links from the transactions list still land on
  the named row). On a naked `/scheduled` the user clicks a row
  to populate the panel.

## 0.95.0 — 2026-05-15

### Security
- **Admin-only gate on rekey / lock / backup endpoints.** Used to
  check `session` only, which meant any logged-in member could
  rotate the SQLCipher key, drop the in-memory key (bouncing every
  device on the LAN to `/unlock`), or list / download / delete /
  restore backups (each of which contains every household
  member's data). All seven endpoints now also gate on
  `session.user.role === "admin"` and return 403 to members:
  - `POST /api/rekey`
  - `POST /api/lock`
  - `GET / POST /api/backup`
  - `DELETE /api/backup/[filename]`
  - `GET /api/backup/[filename]/download`
  - `POST /api/backup/restore`
  - `PATCH /api/backup/schedule`
  Matches the existing posture on `/api/users/*`. The two duplicate
  inline `isAdmin` helpers in users routes are folded into a single
  exported `isAdmin(session)` in `src/lib/auth.ts`.

## 0.94.0 — 2026-05-15

### Fixed
- **`/api/accounts/import` now caps uploads at 5 MB.** Defence
  in depth — legitimate account-list CSVs are kilobytes, but
  the route used to read the whole body via `formData()` with
  no `Content-Length` check, so a malicious uploader could
  starve the parser with a multi-gigabyte file. Mirrors the
  backup-restore route's `MAX_UPLOAD_BYTES` pattern (the
  cap there is 200 MB because backups can legitimately be
  large; account CSVs can't).

## 0.93.0 — 2026-05-15

### Fixed
- **Seed races on cold start (e2e + dev HMR).** Two concurrent
  module evaluations could both pass the "is the DB seeded?"
  check before either had committed, producing
  `UNIQUE constraint failed: users.username` and
  `SQLITE_BUSY` / `SQLITE_BUSY_SNAPSHOT` errors in the logs that
  hid real problems. Two-part fix:
  - `seedDefaultUserIfMissing` now uses
    `INSERT … ON CONFLICT(username) DO NOTHING` so the losing
    racer silently no-ops; the "Seeded default admin/admin"
    log only fires when `changes > 0`.
  - `seedSampleDataIfMissing` adds a fast-path flag check
    outside the transaction, and the transaction itself is now
    `behavior: "immediate"` so the second racer blocks on the
    write lock (with the existing `busy_timeout = 5000`)
    instead of erroring out.

## 0.92.0 — 2026-05-15

### Fixed
- **Sidebar "New release" link points at the GHCR package page.**
  Previously linked to `releases/tag/<latest>` which 404s — the
  repo doesn't publish GitHub Releases. Now opens
  `github.com/budgets-au/budgets/pkgs/container/budgets`, where
  the operator can actually see the tag list + pull URL.

## 0.91.0 — 2026-05-15

### Added
- **Edit + Reconcile affordances on Settings → Accounts.** Each
  account row now has Pencil (open `EditAccountDialog` — name,
  type, colour, institution, last-4) and CheckSquare (open
  `ReconcileDialog` — adjust the current balance to match a
  statement) buttons in addition to the existing Eye/EyeOff
  archive toggle. Hover-revealed on `lg+`, always visible on
  mobile (the standard hover-fallback). Restores the editor
  functionality the deleted Accounts dashboard widget used to
  carry — the operator can now manage account details without
  leaving Settings. Both dialogs call `router.refresh()` on
  close so the server-rendered list picks up any saves.

## 0.90.0 — 2026-05-15

### Changed
- **Scheduled view: drop the per-group subtotal row from the matched-
  transactions list.** Each group's `{n} txns · ${avg} avg` /
  `{total}` subtotal `<li>` is gone — the numbers weren't pulling
  their weight given the operator reads the list top-down by date.
  Inter-group gap bumped from `mt-[5px]` → `mt-7` (28 px) so the
  visual breathing room between groups stays roughly the same as
  when the subtotal row occupied that slot. Removed the now-unused
  `groupTotals` map, `subtotalSign`, `nextRow` / `nextKey` /
  `isLastInGroup` declarations.
- **Scheduled view: schedule editor wrapper drops the slate dark-
  mode override.** Was `bg-muted/40 dark:bg-slate-800/60`; now just
  `bg-muted/40` so the editor panel uses the same surface tone as
  the lineage table header + the rest of the muted surfaces (no
  one-off slate that didn't appear anywhere else in the app).
- **Investments → Options: drop the Service column.** Options
  tables now show Symbol · Vested/Granted · Granted · Maturation ·
  Value · Return — Service date was rarely the cell the operator
  was checking and Maturation already conveys "when does this
  vest". One column lighter.

## 0.89.0 — 2026-05-15

### Changed
- **Investments tables: Day / Week / Return → one dynamic column.**
  Stocks + Paper-trade panels used to render four right-side
  columns (Value, Day, Week, Return). Day + Week + Return are now
  collapsed into a single column whose header + content track a
  per-panel **Month / Week / Day / Return** chip-group picker in
  the panel's top-right corner. Default = Return (matches the cell
  that previously dominated the right-most slot). Picker styling
  mirrors the chart's `RangePicker` (`rounded-md border
  bg-muted/30 p-0.5`; active pill `bg-background text-foreground
  shadow-sm`). Each panel's picker is independent React state —
  changing Stocks doesn't move Paper-trade and vice versa. RSU
  and Options panels are unchanged — they only ever had Return.

### Internal
- **`/api/investments` returns `monthAgoClose`.** Price-fetch
  window widened from 2 weeks → ~6 weeks (42 days) per symbol so
  the response can surface a `monthAgoClose` field (close ~22
  trading days back). Sparse-history symbols return `null` for
  any baseline the cache can't reach, and the table cell falls
  back to "—" the same way Day/Week already did.

## 0.88.0 — 2026-05-15

### Changed
- **Lineage members table: drop per-rank background tints.** The
  editor stack's lineage members table used to paint each row with
  `${lineageColour}1f` (12% tint) and the selected row with `4d`
  (30% tint) + a coloured inset stripe, all keyed off the
  per-rank palette (rose / indigo / amber / teal / purple). The
  tints fought every other coloured affordance in the editor and
  the matching back to the chart's predecessor segments was
  visual noise once the matched-transactions stripes went away in
  0.86. Rows are now plain (`hover:bg-muted/40` only); the
  selected row gets `bg-muted` + a 2-px inset `var(--ring)` for a
  neutral selection indicator that matches the rest of the app.
  `colourForLineageRank` stays in use for chart bar segments,
  where the palette still does distinguishing work.

## 0.87.0 — 2026-05-15

### Added
- **Sparkline on the Options dashboard widget.** Mirrors the Stocks
  widget shipped in 0.61 — a 1-month aggregated-value AreaChart at
  the bottom of the tile, tinted by first-to-last delta (`TREND_UP`
  / `TREND_DOWN`). Backed by a new `/api/dashboard/options-trend`
  route + a refactor of `getStocksTrend` → `getInvestmentTrend(kind,
  range)` that the stocks-trend route now delegates to. Same
  forward-fill semantics, same multi-currency-mixed shape-not-dollar
  caveat. Reads cached closes from `investment_prices`; empty cache
  → number-only fallback.
- **FY bar chart on the Super dashboard widget.** Household totals
  per FY rendered as a small `BarChart` at the bottom of the tile.
  Bars (not a line) because each FY is one discrete snapshot — a
  line would imply between-FY interpolation that doesn't exist in
  the data. YAxis is hidden but domain-clamped to `dataMin*0.95 →
  dataMax*1.05` so the smallest year doesn't collapse into nothing.
  Tone follows the latest YoY delta. Data derived from the existing
  `/api/super` payload — no new endpoint.
- **Daily bar chart on the Category-spend dashboard widget.** Daily
  signed totals (absolute value rendered upward, fill tone follows
  the category sign) over the 30-day window. Backed by an additive
  `series[]` field on `/api/dashboard/category-spend` — the existing
  total/count fields stay unchanged. Zero-activity days are filled
  in so the time axis is dense.

## 0.86.0 — 2026-05-15

### Changed
- **Scheduled view: drop the per-lineage colour stripe on the
  matched-transactions list.** Each row + subtotal in the right-hand
  category transactions list used to carry an `inset 3px 0 0 <rowColour>`
  ribbon matched to the lineage member that claimed it (or to the budget
  period for budget rows). The visual matching to the lineage members
  panel wasn't carrying its weight — operators read the list top-down
  by date, not by ribbon — so the stripes are gone. The red `MISSED_ROW_COLOUR`
  stripe stays on missed rows + missed subtotals because that signals
  status (expected, no match) rather than lineage identity.
- **Scheduled view: subtotal background matches the lineage table
  header.** Group subtotals dropped their `dark:bg-slate-800/60`
  override; both light and dark modes now use the same `bg-muted/40`
  the lineage `<thead>` uses. The list reads as one consistent
  surface instead of switching greys at every group break.

### Internal
- **Colour-constant module + cross-file dedup.** New
  `src/lib/colours.ts` exports `CATEGORICAL_PALETTE` (the 10-hex
  picker wheel — indigo / violet / pink / red / orange / yellow /
  green / teal / cyan / blue), `TREND_UP` / `TREND_DOWN` (`#10b981`
  / `#ef4444` — emerald-500 / red-500), and `chartGridStroke(isDark)`
  (Recharts `CartesianGrid` stroke). Replaced four copies of the
  10-colour palette (accounts/new, accounts/import/commit,
  edit-account-dialog, category-manager — the last inline-extends
  with three slate slots), four copies of the trend up/down
  ternary, four copies of the `isDark ? "#334155" : "#e2e8f0"` grid
  stroke (and fixed scheduled-occurrences-chart which was missing
  its dark variant entirely). Semantic green/red usages in
  sankey/scheduled/investment/report code now reference the
  constants. Removed the dead `PIE_COLORS` declaration in
  reports-view.tsx. `expenses-drilldown.tsx` builds its 12-slot
  pie palette from `[...CATEGORICAL_PALETTE, "#a855f7", "#f43f5e"]`.

### Docs
- **`theme.md` — UI chrome colour matrix.** New top-level doc with
  every theme token grouped by *distinct value* (so the eight tokens
  that resolve to `#f5f5f5` in light or to `#fafafa` in dark show as
  one row each). Covers surfaces, foregrounds, primary, borders,
  brand indigo accent, status text (positive / negative / warning),
  and the scrollbar — explicitly excludes data-viz / picker palettes,
  which live in their own modules. Includes an "Adding a new colour"
  guide so future hex literals have a clear home. Sample swatches
  via placehold.co render on GitHub + VS Code preview.

## 0.85.0 — 2026-05-15

### Added
- **Settings → General → Features panel.** New toggles for
  Investments and Superannuation under General. When off, the
  matching sidebar link disappears, the page itself becomes
  unreachable (server-side `redirect("/dashboard")` in the route
  handler reading `getDisplayPrefs()`), and the related dashboard
  widgets drop out of both the edit-mode drawer and the rendered
  grid — `tracked-stock` / `stocks-summary` / `options-summary` /
  `paper-trade-summary` for Investments, `super-summary` for
  Super. Saved layout entries are preserved in
  `display_prefs.dashboardLayout`, so re-enabling restores them
  in place. Saving a dashboard edit while a feature is off does
  prune those now-invisible entries (the filtered draft is what
  persists). Defaults stay ON for new installs.
- **URL-backed Reports + Settings tabs.** The eight reports tabs
  (Cash Flow / Monthly / YoY / Expenses / Income / Envelope /
  Sankey / Tax) and the five settings tabs (General / Accounts /
  Rules / Backups / Security) now mirror their active tab as a
  `?tab=` query param. Side effects:
  `/reports?tab=sankey` is deep-linkable, the browser Back button
  walks between tabs as expected, and screen-reader nav by URL
  works the same as for any other view. Default tabs are
  stripped from the URL to keep clean addresses. Follows the
  existing `useAccountFilter` convention (`useSearchParams` read,
  `router.replace` write).
- **WidgetSpec.feature.** New optional `"investments" | "super"`
  field on `WidgetSpec`; tagged the five affected widgets. The
  drawer + grid renderer call `isFeatureEnabled(widgetId)` to
  decide whether to surface them. Mechanism extends cleanly to
  future feature flags — add the field, add the prefs toggle,
  done.

### Internal
- **Server-side display-prefs reader.** New
  `src/lib/display-prefs-server.ts` exports `getDisplayPrefs()`
  — the SSR equivalent of the `useDisplayPrefs` hook. Reads
  `app_settings.display_prefs` directly via Drizzle and merges
  with defaults via `parseDisplayPrefs`. Used by the
  `/investments` and `/superannuation` page routes for the
  feature-flag redirect; available to any other server component
  that needs to consult prefs.

### Tooling
- **Screenshot regeneration captures every page in both
  themes.** `tests/e2e/screenshots.spec.ts` now runs 24 captures
  (12 pages × light + dark) instead of cherry-picking one theme
  per page. The PAGES list dropped its per-entry `themes`
  override; the test loops a fixed `["light", "dark"]` instead.
  Reports + settings tabs are reached via URL now that the tabs
  are URL-backed, so the `getByRole("tab", …)` click-by-name
  step is gone — simpler and immune to a future re-label.

## 0.84.0 — 2026-05-15

### Docs
- **README rewritten in plain English.** Dropped the
  technical-stack / stats / project-layout / migrations sections;
  kept the screenshot grid and added a short "What it does"
  pitch in operator language (no Drizzle/Recharts/SQLCipher
  mentions until you're already running it). Install collapsed
  to a single `podman pull` + `podman run` snippet against
  `ghcr.io/budgets-au/budgets:latest`. Dropped from 297 lines
  to a focused product README.
- **Screenshot regeneration is now a Playwright spec.**
  `tests/e2e/screenshots.spec.ts` runs against the e2e dev
  server, seeds a handful of investments / super snapshots /
  paper-trade rows on top of the existing sample-data autoseed,
  and writes both light + dark variants of every page the
  README references into `screenshots/`. Run when the visuals
  drift: `pnpm test:e2e tests/e2e/screenshots.spec.ts`.

## 0.83.0 — 2026-05-15

### Added
- **In-app release check from GHCR.** New
  `/api/version-check` endpoint polls
  `ghcr.io/budgets-au/budgets`'s `tags/list` (anonymous Bearer
  token for public packages; falls back to `GITHUB_TOKEN` env
  for private), filters semver tags, returns the highest one.
  Sidebar footer renders a tinted "New release" line directly
  under the existing `v0.X.Y` label when the upstream tag is
  newer than `APP_VERSION` — links to
  `github.com/budgets-au/budgets/releases/tag/<latest>`. SWR
  polls hourly; Next route segment is `revalidate: 3600` so
  multiple browser tabs / nodes de-dupe to one upstream call
  per hour. Indicator stays hidden when on the latest, when
  upstream errored, or when the package is private without a
  configured token. Comes with 6 new tests for
  `compareSemver` (catches the classic "0.10.0 vs 0.2.0"
  string-sort bug).

## 0.82.0 — 2026-05-15

### Changed
- **Transactions table: tighter columns + denser rows.** Date /
  Account / Category / Linked-account headers no longer carry
  explicit `w-[…px]` widths — columns auto-size to their widest
  content the way HTML tables already do by default, so short
  cells like "Bills" or "Loan" stop leaving 60-80 px of dead
  space inside an oversized column. Cell padding tightened from
  `px-3 py-2` to `px-2 py-1.5` across every header and body cell
  in both `TransactionRow` and `ScheduledTransactionRow`. Payee
  still `w-full max-w-0` so it absorbs whatever's left.

## 0.81.0 — 2026-05-15

### Changed
- **Edit dashboard button moved into the topbar.** Sits in the
  Topbar's actions slot, immediately left of the profile
  dropdown, instead of floating above the first row of widgets.
  New `DashboardShell` client wrapper hoists `editMode` state up
  out of `DashboardGrid` so the button can live in a sibling
  (Topbar). Save / Cancel stay inside the widget drawer.

### Removed
- **Dead import endpoints:** `/api/import/parse/route.ts` and
  `/api/import/commit/route.ts` had no client / test callers
  since the import view moved fully to the batched endpoint.
  Pulled out along with `src/lib/import/detect-account.ts` (only
  used by the dead parse route) and two `src/lib/categorize.ts`
  exports (`lookupPayeeRule`, `batchSuggestCategoryByHistory`)
  whose only callers were the deleted routes.

### Hygiene
- Stale comments in `categorise/route.ts` and
  `commit-batched/route.ts` (referring to the deleted "wizard"
  commit endpoint and the no-longer-existing tester upstream)
  rewritten to describe the actual flow.

## 0.80.0 — 2026-05-15

### Fixed
- **Import client was dropping `postedSeq` in the commit payload.**
  The parser computed bank-chronological order via balance
  reconciliation (0.78), but the request body the client sent to
  `/api/import/commit-batched` omitted the `postedSeq` field
  entirely. Commit-batched then inserted `NULL`, the
  running-balance subquery's `COALESCE(posted_seq, 0)` tied every
  row, and the tuple compare fell through to `created_at` / `id`
  — i.e. file insertion order. On a newest-first CSV, same-day
  rows ended up reversed in the DB even though the parser had the
  right answer all along; the transactions list then flagged
  every affected row with a ✗ balance mismatch.
  One-line fix: `postedSeq: r.postedSeq ?? null` in the commit
  payload mapper. The previous releases that tried to detect /
  repair this state (0.74-0.78) were band-aiding the symptom of
  this dropped field.

## 0.79.0 — 2026-05-15

### Added
- **Category-spend dashboard widget.** New 2×2 multiInstance
  tile — picks a single category in edit mode, renders the total
  + transaction count over the last 30 days. Headline shows the
  signed magnitude (tinted via `amountClass`), drilling into
  `/transactions?categoryId=…&includeChildren=true` for audit.
  Rolls up descendants by default (matches cashflow report).
  Backed by new `/api/dashboard/category-spend?categoryId=<uuid>&days=30`.

## 0.78.0 — 2026-05-15

### Fixed
- **assignPostedSeq's balance-aware tier was sorting by balance ASC
  — wrong direction on mixed-sign days.** A day with net outflow
  ends at a LOWER balance than it started, so the smallest balance
  is the LATEST row, not the first; sort-asc reversed those rows.
  Replaced the sort with the same balance-reconciliation algorithm
  the commit-batched repair pass uses: walk the day, and at each
  step pick the unique row whose `balance - amount` equals the
  previous balance. Handles mixed signs correctly; for the file's
  first date (no anchor) it tries each row as the potential start
  and accepts only the unambiguous resolution. If reconciliation
  can't resolve the day (round-trips, missing balances, NaN),
  falls back to file position with the strict newest-first
  detector from 0.74. Two new test cases pin the mixed-sign cases.

## 0.77.0 — 2026-05-15

### Added
- **CSV Balance-column detector now matches more variants.**
  Was strict equality on `"balance"` / `"running balance"` —
  banks that name the column `"Bank Balance"`, `"Account
  Balance"`, `"Balance After"`, `"Balance After Transaction"`,
  or `"Closing Balance"` were silently treated as having no
  balance column. All five variants now register; the importer
  picks up the running balance and feeds it into the chain
  check / posted_seq derivation.

### Fixed
- **Commit-batched now repairs broken intra-day posted_seq order
  even when the file has no Balance column.** 0.74's per-row
  correction required `row.balance != null` (file-supplied
  balance), so a re-import of a CSV without one would detect the
  mismatch via 0.76 but couldn't act on it — Commit button
  greyed out as "Nothing to commit". Replaced with a date-level
  repair pass that runs post-insert/backfill: walks the DB chain
  in canonical tuple order, identifies any `(account, date)`
  pair where stored bank balances disagree with the chain-
  predicted values, and re-derives the bank's true intra-day
  order via reconciliation (`prev + amount = next` is solvable
  whenever every row on the date carries a stored balance). The
  affected rows then get the SAME set of `posted_seq` values
  they already had, just permuted into the correct order — no
  new values minted, per-account uniqueness preserved.
- **Commit button no longer says "Nothing to commit" when only
  chain mismatches need fixing.** Includes `chainMismatchCount`
  in the work-detection so a re-import whose sole effect is
  re-ordering existing rows enables the button and labels it
  "Fix N balance mismatches".

## 0.76.0 — 2026-05-15

### Fixed
- **Import balance-vs-DB check now runs even when the new file has
  no Balance column.** 0.74.0 gated the DB-chain check on
  `r.runningBalance` (the file's column), which meant a re-import
  of a CSV that lacked the column couldn't surface a wrong
  posted_seq order — even though the transactions list was
  flagging the same row with a ✗ from the DB-stored balance alone.
  The chain check only needs the *DB's* stored balance to compare
  against (importHash is just the link to find which DB row); the
  file's runningBalance is now optional for the detection path.
  Auto-correction in commit-batched still requires the file to
  supply a balance (otherwise the parser's posted_seq isn't
  balance-aware and isn't trustworthy as a fix).

## 0.75.0 — 2026-05-15

### Changed
- **Upcoming + Recent widgets switch to CSS subgrid for column
  alignment.** Per-row grids couldn't share column widths across
  rows — fixed-width columns gave alignment with dead space,
  auto-widths gave tightness but staggered cells. The cards now
  use a single grid container with `gridTemplateColumns:
  "auto auto minmax(0,1fr) auto"`; each `<li>` and `<Link>` uses
  `grid-cols-subgrid` to inherit the parent tracks, so date and
  account columns auto-size to the widest content across the
  whole list AND every row's cells line up. Visible result:
  dates like "Today" / "2d ago" no longer leave 30-50 px of
  whitespace before the account badge. `<Link>` semantics
  preserved — middle-click open in new tab still works.

## 0.74.0 — 2026-05-15

### Fixed
- **posted_seq is now derived from supplied running balance when
  the file carries one.** Was per-file 0..N-1 with a direction
  flip only when `rows[0].date > rows[N-1].date` — so a same-date
  file the bank emitted newest-first never tripped the strict
  greater check and kept reversed intra-day order. New rule in
  `assignPostedSeq`: if every row carries a strictly-monotonic
  `runningBalance`, sort by (date, balance) and use that as the
  canonical order. Otherwise fall back to file position with a
  stricter newest-first detector (any date inversion anywhere in
  the sequence triggers the flip, not just first-vs-last).
  Covered by 11 new tests in `src/lib/import/posted-seq.test.ts`.
- **Existing posted_seq gets corrected on re-import when the file's
  balance proves the stored order is wrong.** `commit-batched`
  walks the existing DB chain (same `(date, posted_seq,
  posted_at|created_at, id)` tuple the running-balance view
  uses), predicts each row's balance, and when a duplicate-matched
  row's stored bank balance disagrees with the chain, overwrites
  the existing posted_seq with the file's balance-aware value.
  New `correctedPostedSeq` counter is surfaced in the post-commit
  toast ("N sequences re-ordered") so the operator sees how many
  rows got their intra-day order fixed.

### Added
- **`balanceCheckVsDB` on the import review.** Categorise
  endpoint cross-checks every duplicate-matched row's existing
  DB-chain-predicted balance against what the file (and the bank)
  claims. The import-view expand panel for a matched row now
  shows either a green "✓ DB balance chain agrees with the file"
  or a red "✗ DB balance chain says X here, file says Y" with
  the prediction. The red case explicitly notes that committing
  will rewrite posted_seq for that row.

### Answer to "do imported rows' sequence ever change?"
With this release, **yes — on re-import of a file that proves the
existing DB chain is wrong**. New imports still get the offset
treatment from 0.71.0 to stay unique per account; duplicates with
a wrong stored order now also get corrected. Existing data
without a re-importable CSV stays as-is — fix is forward-only on
data the operator has files for.

## 0.73.0 — 2026-05-15

### Changed
- **Upcoming + Recent row columns aligned again, tighter than
  before.** 0.69.0 set the date column to `auto` to remove the
  dead space inside the old 90 px column, but each `<Link>` is
  its own grid so `auto` sized per-row and staggered the
  cluster across rows. Switched to `5rem 7rem minmax(0,1fr) auto`
  — fixed widths on date and account so columns align across
  rows, but tighter than 90 px (5rem ≈ 80 px is just enough for
  the longest `relativeWord` string).

## 0.72.0 — 2026-05-15

### Added
- **Import review: show / hide identical-match rows.** Restored a
  toggle next to the header's "N identical hidden" caption — click
  **show** to reveal the exact-match rows whose DB row already has
  every user-visible field set (commit is a no-op for them). Off
  by default since most operators don't want to scroll past 40
  unchanged rows; the diagnostic case wants them visible.

## 0.71.0 — 2026-05-15

### Changed
- **CSV / OFX / QIF import review: declutter pass.** Stripped the
  dev-era affordances that piled up during parser bring-up —
  pipeline A/B toggles, method filter buttons, field-richness
  stats grid, "show identical rows" toggle, and the OFX-metadata
  card. OFX header info collapses to a single subtitle line
  (`Macquarie · BSB 182-512 · ····3210 · ledger A$… (date)`). Row
  count + new/duplicate breakdown collapses to one inline
  caption.
- **Import review table now mirrors the Transactions page.**
  Same `<tr>` rhythm (`group cursor-pointer hover:…`, `px-3 py-2`
  cells), same column order (date · account · category · payee ·
  amount), same click-anywhere-to-expand interaction (single
  row open at a time, keyed by `importHash`). Replaced the dual
  `ComparisonRow` + `RowGroup` renderers with one `ImportRow` +
  inline `ImportRowExpanded` panel.
- **Row state colour-coded.** New rows render on a muted-yellow
  background (`bg-yellow-50` / `dark:bg-yellow-950/30`),
  duplicates (exact / legacy / possible) on a muted-emerald
  background. Click any row to drop down the metadata panel: for
  duplicates it shows the existing-vs-incoming diff with the
  about-to-backfill cells tinted amber; for new rows it shows
  the source-only fields (raw id, normalised payee, splits,
  address, ref / check / trn type, running balance) plus the
  trigram-neighbour diagnostic.

### Fixed
- **Running balance after multiple CSV imports.** The parser
  assigned `posted_seq` per file (0..N-1), not per account, so two
  CSV imports into the same account both produced rows with
  `posted_seq=0` on overlapping dates. The running-balance tuple
  comparison `(date, posted_seq, COALESCE(posted_at, created_at),
  id) <=` then fell through to `created_at` — the insert
  timestamp, not the bank's chronological intent — and reordered
  intra-day rows when the newer file was imported first.
  Commit-batched now offsets each file's parser-assigned values
  by the account's current `MAX(posted_seq)` so values stay
  unique per account; intra-file relative order is preserved
  (constant offset) so bank intra-day order still wins the
  tiebreaker. Existing colliding rows aren't migrated — fix is
  forward-only on new imports.

## 0.70.0 — 2026-05-15

### Changed
- **1000-monkey crawl now fills + submits forms, surfaces silent
  submits as questions.** The click-only crawl skipped anything
  inside a `<form>` or `[data-slot="dialog-content"]`, which is
  exactly the surface that hid the 0.46.x saved-filters Save bug
  (clicking Save without typing a name was a silent no-op).
  Added a form-filling phase per page:
  fill every visible input with safe defaults
  (`monkey-test` / `42` / `2026-01-01`), click the submit-shaped
  button, watch a one-shot observer (POST/PATCH/PUT/DELETE
  requests, sonner toast, navigation, console errors) for
  ~800 ms. Submits with no observable side-effect become
  `kind: "question"` findings — possibly intentional, possibly
  bugs, the operator decides.
- **TODO.md monkey block split into "Issues" + "Questions for
  review" subsections.** The teardown groups by kind so triage
  reads top-down.

## 0.69.0 — 2026-05-15

### Changed
- **Upcoming + Recent rows: tighten the gap between day and
  account.** Date column was a fixed 90 px — wider than every
  actual string ("Today" ≈ 40 px, "Yesterday" ≈ 63 px), leaving
  20-50 px of dead space inside the column before the
  `gap-3` to the account badge. Dropped to `auto`; the badge
  now snaps right after the date (each row sizes its date column
  independently, which trades cross-row alignment for the
  tighter cluster the operator wanted).

## 0.68.0 — 2026-05-15

### Changed
- **Account widget: 7-day in/out paired bars → running-balance
  area sparkline.** The bar chart packed 14 bars into ~70 px of
  vertical space at 2×2 tile size and the colour ratio was
  dominated by whichever direction had the larger day, burying
  the trend signal. Replaced with a Recharts AreaChart of the
  daily-end balance, tinted emerald/red by the first→last delta —
  same visual rhythm as the tracked-stock and stocks-summary
  sparklines. Tooltip shows date + balance on hover.
- **Endpoint rename:** `/api/dashboard/account-daily-flow` →
  `/api/dashboard/account-balance-trend`. Anchors the running
  balance at `startingBalance + Σ(amounts before window-start)`
  and walks forward through each day's net flow — independent of
  `accounts.currentBalance` (which bakes in future-dated txns and
  would mis-anchor a window that ends today).

## 0.67.0 — 2026-05-14

### Changed
- **Account widget drops the account-colour vertical swatch.**
  Balance text + institution line render flush-left now; the
  colour stripe was visual noise at the 2×2 tile size.

## 0.66.0 — 2026-05-14

### Changed
- **Upcoming + Recent-transactions widgets: account column moves
  between day and payee.** Row order is now date / account /
  payee / amount in both cards. Grid template
  `90px auto minmax(0,1fr) auto` keeps the account badge sized to
  content and the payee column expanding to fill whatever's left.

## 0.65.0 — 2026-05-14

### Changed
- **Upcoming widget rows: frequency badge → left-edge highlight,
  payee column maximised.** The frequency pill at the start of
  each row took a 90 px column it didn't need. Replaced with a
  4 px coloured vertical bar against the row's left edge
  (`aria-label` preserves the frequency name for assistive tech).
  Grid template now `90px minmax(0,1fr) auto auto` so the
  account badge + amount sit content-sized at the right edge and
  the payee column expands to fill everything in between.

## 0.64.0 — 2026-05-14

### Added
- **7-day in/out bar chart on the Account widget.** Below the
  balance line, each of the past seven days renders as a paired
  bar — emerald for inflows, red for outflows. Hover shows the
  per-day in/out totals. Backed by new
  `/api/dashboard/account-daily-flow?accountId=<id>&days=7` which
  zero-fills quiet days so the strip is stable. Chart suspends in
  edit mode (same recharts resize-observer rationale as the
  tracked-stock sparkline) and hides entirely when the window
  has no activity. Balance text dropped from `text-2xl` to
  `text-xl` to fit the chart in the 2×2 tile.

## 0.63.0 — 2026-05-14

### Removed
- **The full-width "Accounts" dashboard widget.** Superseded by the
  multi-instance "Account" widget (0.60.0): the operator pins
  individual accounts as 2×2 tiles instead of dropping a
  twelve-column block listing every visible one. Default
  dashboard layout dropped the Accounts row; Upcoming moves up
  into the slot. Existing saved layouts that reference
  `widgetId: "accounts"` get filtered out by the
  `WIDGETS_BY_ID.has(...)` guard on render, so nothing crashes —
  the tile just disappears the next time the operator opens the
  grid.

## 0.62.0 — 2026-05-14

### Fixed
- **Account widget can pick archived accounts (0.60.0 follow-up).**
  The widget's dropdown was empty of hidden accounts because
  `/api/accounts` filtered them out for every caller. Added an
  `?includeArchived=true` flag on the endpoint and have the
  Account widget use it — pinning a hidden account now works (and
  view-mode can resolve a pinned-archived selection back to its
  row). Default behaviour for sidebar / transaction filters is
  unchanged.

## 0.61.0 — 2026-05-14

### Changed
- **Account dashboard widget drops the type + last-4 line.** The
  tile now just shows balance + institution (and a "hidden"
  flag when relevant); the type chip and `····NNNN` suffix took
  more space than they were worth at 2×2.

### Added
- **Stocks widget now has a 1-month sparkline below the totals.**
  New `/api/dashboard/stocks-trend` aggregates daily values across
  every owned stock (cached closes × current quantity, summed
  across symbols, forward-filled across gaps) and the card draws
  a Recharts area sparkline tinted green/red by the first→last
  delta. No FX conversion — the shape is the signal; the
  per-currency totals above the sparkline remain the dollar
  truth.

## 0.60.0 — 2026-05-14

### Added
- **"Account" dashboard widget — pins a single user-picked
  account.** 2×2, multiInstance, dropdown lists all accounts
  including archived ones (a closed CC the user still wants
  visibility on, a savings goal they don't want in balance sums,
  etc.). Renders the account's colour stripe + balance + type
  line out of edit mode, dropdown picker in edit mode.
  Per-instance `config.accountId` so two tiles can pin different
  accounts.

### Changed
- **Import + Add-account buttons moved from the Accounts widget to
  Settings → Accounts.** The dashboard widget now focuses purely
  on viewing balances; account-list management lives next to the
  show/hide toggles in Settings.

## 0.59.0 — 2026-05-14

### Changed
- **Net Worth Trend widget defaults to 2×2** (was 3×2), matching
  the other summary cards. Existing placements keep their saved
  size.

## 0.58.0 — 2026-05-14

### Changed
- **Tracked-stock widget defaults to 2×2** (was 3×3), matching the
  Options / Stocks / Net-Worth summary cards. Easier to drop several
  next to each other along a row without immediately resizing.
  Existing placed instances keep their saved size.

## 0.57.0 — 2026-05-14

### Changed
- **Upcoming + Recent-transactions widgets can shrink to ~3 visible
  rows.** Dropped `minSize.h` from 3 to 2 on both widgets. At the
  new minimum the tile is ~172 px tall (2 grid rows + margin),
  leaving ~3-4 list rows visible after the card header — down from
  ~6-7 at the previous minimum. Default placement size unchanged
  (`h: 4`).

## 0.56.0 — 2026-05-14

### Added
- **"Recent transactions" dashboard widget.** Mirrors the Upcoming
  card's pattern — SWR-fetched payload, ResizeObserver-driven
  dynamic visible-row count, same 32 px row height + grid rhythm
  so the two cards line up when placed side-by-side. Backed by
  new `/api/dashboard/recent-transactions` (latest 50 posted
  transactions across non-archived accounts, ordered by the same
  date / posted-seq / posted-at / id lineage the transactions
  page uses, so the widget agrees with the full view on ties).
  Each row deep-links to `/transactions?accountId=…`.

## 0.55.0 — 2026-05-14

### Added
- **Multiple tracked-stock widgets per dashboard.** Marked
  `tracked-stock` as `multiInstance` so the drawer keeps offering
  the pill after one's placed and each placement gets a fresh
  `instanceId` (UUID) in the saved layout. Per-instance `config`
  (`{ investmentId }`) means each card can point at a different
  symbol. Legacy single-tracked-stock entries (no `instanceId`)
  keep working: the renderer falls back to `widgetId` as the RGL
  key, which is unique by construction for single-instance widgets.

### Changed
- **Schedule chart Standard palette recoloured + promoted to
  default.** Actual `#669C35`, Over `#B51A00`, Forecast `#FFFC41`,
  Saved `#444444`. `DISPLAY_PREFS_DEFAULT.chartScheduleTheme`
  flipped from `"fabulous"` to `"standard"`, and the
  Settings → Schedule-chart-theme list now lists Standard first
  with Fabulous second.

## 0.54.0 — 2026-05-14

### Fixed
- **Drawer widget-list still flashing during drag (0.52.0 regression
  follow-up).** 0.52.0's guard early-returned `onLayoutChange` while
  `draggedWidgetId` was non-null. That depended on React having
  committed the `setDraggedWidgetId(...)` from the drawer pill's
  `onDragStart` before RGL's first `onLayoutChange` fired — usually
  true (separate tick), but not airtight under React 19 batching.
  Replaced the flag check with an ID-set comparison: any emission
  whose `i`s don't match the IDs in `draftLayout` is treated as a
  transient (drop placeholder in flight, mid-compaction state) and
  rejected. `onDrop` remains the only path that commits new
  placements. No dependence on render order anymore.

## 0.53.0 — 2026-05-14

### Fixed
- **Dockerfile pnpm-layout fix, take two.** 0.52.0's runtime-deps
  staging step copied `bindings` correctly but failed on
  `file-uri-to-path` — that package is a transitive of `bindings`,
  not of `@signalapp/better-sqlite3`, so under pnpm's isolated
  layout it lives in `.pnpm/bindings@<ver>/node_modules/`, a
  different sub-dir from the one a single realpath walk lands on.
  Replaced the shell chain with a tiny Node script that calls
  `require.resolve(pkg + "/package.json", { paths: [...] })` —
  Node's resolver already understands pnpm's symlink farm, so no
  hand-walking. `fs.cpSync(..., { dereference: true })` flattens
  the symlinks the same way `cp -RL` would.

## 0.52.0 — 2026-05-14

### Fixed
- **Dockerfile compatibility with pnpm's strict node-linker.**
  0.51.0's release build broke at `COPY /app/node_modules/bindings`
  — under pnpm's isolated layout, transitive deps of
  `@signalapp/better-sqlite3` (`bindings`, `file-uri-to-path`)
  don't get hoisted to top-level `node_modules/`; they live in the
  `.pnpm/<pkg>@<ver>/node_modules/` symlink farm. Builder now
  stages the native driver + its two peers into
  `/app/runtime-deps/` with `cp -RL` (follow-symlinks) so the
  runner stage can COPY a stable, version-agnostic layout. The
  in-place slim step still works through the symlinks.
- **Dashboard edit drawer no longer flashes the dragged pill in
  and out during a drag, and the dropped widget now lands on the
  grid immediately.** While a drawer pill was being dragged, RGL
  fired `onLayoutChange` many times per second (placeholder in,
  placeholder out as the cursor crossed the grid boundary) —
  each emission was rewriting `draftLayout`, which made the
  drawer's `availableWidgets` filter flash the pill in and out
  and caused the dropped widget not to commit until Save →
  reload. `onLayoutChange` now early-returns while
  `draggedWidgetId` is set; `onDrop` is the only path that
  commits the placement.

## 0.51.0 — 2026-05-14

### Changed
- **Package manager: npm → pnpm.** Workflow swap, no runtime
  behaviour change. Faster installs (content-addressable cache),
  stricter dep resolution that surfaces phantom transitives at
  install rather than at runtime, and a smaller `node_modules` on
  disk. Pinned via `"packageManager": "pnpm@9.15.9"` so
  `corepack` activates the same version on every machine. The
  Dockerfile deps-stage now runs `corepack enable && pnpm install
  --frozen-lockfile`; the builder stage runs `corepack enable
  && pnpm build`.
- **`better-sqlite3` declared as an explicit alias for
  `@signalapp/better-sqlite3`.** drizzle-orm imports the upstream
  package name directly; under npm's flat hoisting that resolved
  to whatever variant was present, but pnpm's strict resolution
  refuses to silently swap. Aliased the dep in `package.json`
  (`"better-sqlite3": "npm:@signalapp/better-sqlite3@^9.0.13"`)
  so drizzle picks up the SQLCipher fork without code changes.

### Added
- `pnpm.onlyBuiltDependencies` allowlist for native modules
  (`@signalapp/better-sqlite3`, `bcryptjs`, `esbuild`, `sharp`).
  Newer pnpm versions disable install scripts by default; this
  re-enables them just for the packages that need them.

## 0.50.0 — 2026-05-14

### Changed
- **Saved Filters pill now sits next to the toggles instead of
  wrapping onto its own line.** Moved the `<SavedFilters />`
  render from a sibling of `<TransactionFilters>` into the tail
  of the same flex-wrap row, with `self-center shrink-0` so it
  rides the toggle line on desktop and wraps cleanly below on
  narrow viewports.

## 0.49.0 — 2026-05-14

### Fixed
- **Saved-filters Save button + chart-palette Add palette button:
  the underlying bug was `crypto.randomUUID()` throwing in
  non-secure contexts.** Every previous report of "Save current
  filter does nothing", "Add palette doesn't work", and similar
  silent-no-op-on-click failures was triggered by client code
  calling `crypto.randomUUID()` from `http://<IP>:...`. The Web
  Crypto API requires a secure context (HTTPS or localhost); on
  bare HTTP it raises a TypeError mid-handler. The handler
  aborts before reaching `setPref`, the popover stays open with
  the typed value, and there's no obvious symptom for the
  operator beyond "the click did nothing". Added a `newId()`
  helper in `src/lib/new-id.ts` that prefers the native API
  where it's available and falls back to a Math.random-based v4
  polyfill where it isn't. Swapped both client usages.
- **Dashboard "shake" after dropping a widget.** The
  `onLayoutChange` short-circuit was comparing entries by array
  index, but RGL's post-drop compaction often reorders the
  array. Same content + different order ⇒ "different" ⇒ new
  state ⇒ re-render ⇒ RGL re-fires onLayoutChange ⇒ thrash.
  Now compares by `widgetId`-keyed lookup so reordering is a
  no-op short-circuit.
- **Budget Progress widget fits 3 rows at the default h=2.**
  Tightened `space-y-2.5` → `space-y-1.5` between rows and the
  per-row height constant from 38 → 30 px. The third row was
  being clipped at the default height before.

### Added
- **`tests/e2e/saved-filters.spec.ts`** — scenario tests for the
  Saved-Filters Save flow. Catches the regression class that
  skipped past the monkey crawl (which only clicks buttons, never
  types into inputs). Both "type + click Save" and "type + Enter"
  paths now covered.

## 0.48.0 — 2026-05-14

### Fixed
- **Dashboard React error #185 ("Maximum update depth exceeded")
  when adding any widget — confirmed root cause + fixed.** The
  loop wasn't in dashboard-grid at all — it was inside recharts
  3.x. Recharts now bundles `react-redux` for its internal store
  and notifies subscribers every time a `ResponsiveContainer`
  resizes. RGL resizes every cell on every drag-over event, so a
  layout containing a chart widget (default layout has Net Worth
  Trend) blew through React's update-depth ceiling within a
  handful of drag-over frames.

  The fix: while `editMode` is on, the chart widgets
  (NetWorthTrendCard, TrackedStockCard) swap their
  ResponsiveContainer for a static "Chart hidden while editing"
  placeholder. The chart re-appears the moment Save / Cancel
  flips editMode off. Any future chart-rendering widget must
  follow the same pattern — captured in the architecture-notes
  section of the new TODO.md.

### Added
- **Playwright E2E test suite under `tests/e2e/`.** Spins up a
  dedicated next.js production server on :3003 with a fresh
  SQLCipher DB and a separate `.next-e2e/` build artifact, so
  the live `next dev` on :3002 is never touched. Three spec
  files cover top-level pages, every dashboard widget rendered
  solo + together, and the drag-from-drawer edit flow that
  reproduces the recharts loop. Run with `npm run test:e2e`.
- **`TODO.md`** — running scratchpad of ideas, bugs, and
  follow-up work, with a `Done / dropped` section so context
  isn't lost when items move off the list.
- **`distDir` override in `next.config.ts`** — gated on
  `E2E_TEST_BUILD=1` so the E2E rig can build to `.next-e2e/`
  without colliding with the live dev server's `.next/`.

## 0.47.0 — 2026-05-13

### Fixed
- **Dashboard React error #185 ("Maximum update depth exceeded")
  on tracked-stock add — round 2.** The previous onLayoutChange
  short-circuit was necessary but not sufficient; the loop was
  reignited by an unrelated cascade:
  - The derived `rglLayout` and `layouts` prop were recomputed
    fresh every render, so react-grid-layout received a new
    object identity on every render — its internal `useMemo` /
    `useEffect` pipeline kept tripping, which combined with
    Recharts' own per-chart `ResizeObserver` cascading state
    updates added up to React's depth ceiling.
  - The `key={baseLayoutSignature}` we added in 0.42.0 to force
    RGL to re-mount when SWR delivered the saved layout was
    *also* tripping the chain: when the user's saved layout
    contained a widget the SWR fallback didn't (e.g. the
    tracked-stock), the SWR-load transition flipped the key →
    RGL remounted → every child widget remounted → every
    Recharts container remounted → enough fresh state updates
    fired in one pass to blow the limit.

  Now: `rglLayout` and `layouts` are memoised on `activeLayout`,
  so RGL sees stable references when content is stable; and the
  remount key is removed (RGL's responsive variant picks up the
  changed `layouts` prop via its own deep-equality check, so
  forcing a remount was always belt-and-braces).

## 0.46.0 — 2026-05-13

### Changed
- **Schedule chart palette editor rework — list + modal.** Earlier
  inline-editor variants kept getting eaten by click-handler /
  focus-management edge cases ("Add palette doesn't fire",
  "swatches don't open the picker"). The new design splits the
  two concerns:
  - The Settings panel is a flat radio list of themes. Each row
    shows the name, a 4-dot palette preview, and (for custom
    rows only) a pencil + trash. Clicking the radio just
    selects the active theme — no other side effects.
  - Add palette + Edit both open the SAME modal dialog with the
    full editor (name + four colour pickers + Save / Cancel).
    Dialog owns its editing state locally; Cancel discards,
    Save commits via `setPref`. No z-index or pointer-events
    fighting with the row's selection radio.
  - Delete on a custom palette confirms via the shared
    `useConfirm` dialog, and falls back to Standard if you
    delete the currently-active palette.

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
