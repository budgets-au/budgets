# Changelog

All notable changes to this project are recorded here. The version policy
is **bump minor on every shipped change** (per user directive); patch
remains 0 until released hotfixes warrant it.

The canonical version pointer lives in `src/lib/version.ts`
(`APP_VERSION`). `package.json`'s `version` field is no longer
bumped on each release — it stays pinned so the Docker layer that
runs `npm ci` survives version bumps and rebuilds in seconds.

## 0.120.2 — 2026-05-16

### Fixed
- **Windows CI: node-gyp failed under default Python 3.12+.** The
  `windows-latest` runner ships Python 3.12 by default; node-gyp 9
  (pulled in by `@electron/rebuild` via `electron-builder
  install-app-deps`) imports `distutils`, which was removed from
  the stdlib in 3.12. Pinned Python 3.11 in the workflow via
  `actions/setup-python` so `electron-builder install-app-deps`
  can compile `@signalapp/better-sqlite3` against the Electron
  Node ABI.

## 0.120.1 — 2026-05-16

### Fixed
- **Windows desktop build CI: missing `main` entry blocked the
  packager.** The v0.120.0 CI run got through `next build` +
  `electron-prepare` but electron-builder bailed at the asar
  sanity-check looking for `index.js` (its default app entry)
  because `package.json` didn't declare `"main"`. Set it to
  `electron/main.cjs`, added the cosmetic `description` / `author`
  fields the packager warned about, dropped the explicit
  `@electron/rebuild` devDep (electron-builder ships its own copy)
  and switched the `electron:rebuild` script to the standard
  `electron-builder install-app-deps`.

## 0.120.0 — 2026-05-16

### Added
- **Windows desktop build via Electron.** A second release artifact
  alongside the Linux container — the same Next.js app runs inside
  a single-window Electron shell so the operator can install it on
  a Windows machine and use it as a desktop app.
  - `electron/main.cjs` spawns the existing Next standalone server
    (no app code changes) as a child of the Electron binary via
    `ELECTRON_RUN_AS_NODE=1`, picks a free localhost port at boot,
    and opens a single `BrowserWindow` pointed at it.
  - DB lives at `%APPDATA%/Budgets/data/budget.db`; on first run
    the existing `/unlock` flow lets the user type a passphrase
    which both creates and encrypts the DB. To migrate an existing
    deployment: install + restore a backup via Settings → Backup.
  - `electron-builder.yml` produces an NSIS installer
    (`budgets-X.Y.Z-setup.exe`) — unsigned for v1, so first launch
    triggers a SmartScreen warning the user clicks through.
  - `.github/workflows/electron-windows.yml` builds the .exe on
    `windows-latest`. Tagging a release (`v0.120.0`-style) attaches
    the installer to the GitHub Release; manual dispatch leaves it
    as a workflow artifact.
  - Native module ABI handled by `@electron/rebuild` in the
    `electron:rebuild` script. The Linux container release flow
    (`pnpm docker:release`) is unchanged.

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
