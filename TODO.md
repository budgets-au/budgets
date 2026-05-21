# TODO

Running scratchpad of ideas, half-baked thoughts, known bugs and
follow-up work. Triaged loosely — promote anything that's lined
up for "next session" into the top section.

> Convention: when you fix or drop an item, move it to the bottom
> under **Done / dropped** with a one-line note so we keep
> institutional memory rather than vanishing the context.

## Up next

_Cleared 2026-05-17 — every item from the 2026-05-15 review either
shipped (0.137 → 0.143) or got moved to the "Done / dropped"
section. Re-fill from the latest monkey crawl + ad-hoc finds._

### Small, in-flight (current session)

_Cleared 2026-05-19 — the three items (calendar accent, two
hover-only `lg:` stragglers, `hideTransfers` dead prop) all
shipped in 0.166.0._

## Known bugs / regressions to investigate

### 1000-monkeys crawl findings

<!-- monkey:start -->
_Last run: 2026-05-21T03:58:15.914Z · 0 issues, 0 questions._

#### Smart Monkey expert system

| Goal | Achieved | Attempts | Last successful run |
| --- | --- | --- | --- |
| `createTransaction` | ✅ | 1 | /transactions · "Add transaction" → "Add" (dom) |
| `createBudget` | ✅ | 1 | /scheduled · "New scheduled transaction" → "Create" (dom) |
| `createSchedule` | ❌ | 1 | _(not yet)_ |
| `addTenToCategory` | ❌ | 1 | _(not yet)_ |

_Coverage: 0 routes mapped, 0 interactive controls catalogued, 0 in-app links discovered._

#### Smart Monkey run report

| Metric | Count |
| --- | --- |
| Total wall time | 201.5s |
| Routes visited | 0 |
| Button clicks | 0 |
| Switch toggles | 0 |
| Select cycles | 0 |
| Text inputs filled | 0 |
| Dialogs opened | 0 |
| Form submits | 0 |
| Links discovered | 0 |
| Console errors | 0 |
| Goals attempted | 0 |
| Goals achieved | 0 |
| Findings logged | 0 |

##### Workflows completed
- ✅ `createTransaction` — `/transactions` · click **Add transaction** → fill → click **Add** (verified via dom)
- ✅ `createBudget` — `/scheduled` · click **New scheduled transaction** → fill → click **Create** (verified via dom)
- ❌ `createSchedule` — _(not yet completed)_
- ❌ `addTenToCategory` — _(not yet completed)_

#### Vitest summary

_Last run: 2026-05-20T09:26:06.823Z._

✅ **353 passed** across 38 files (13.3s).

_No issues or questions on the last run — only the expert-system summary above._

<!-- monkey:end -->

### Test-coverage gaps (what the monkey CAN'T catch)

_The monkey clicks safe buttons, cycles selects, toggles switches,
fills inputs with `"monkey-test"` / `42` / `2026-01-01`, submits,
watches 800 ms for any network call / toast / nav. Bans labels
matching `delete|remove|archive|clear|import|sign out`. Never
navigates cross-page to verify side-effects landed. Every "create
X then verify X appears" flow below sits in this blind spot._

#### Import / CSV / QIF (high severity — destructive on miss)

- **CSV/QIF import end-to-end** — drop a real bank file, categorise, commit, navigate to `/transactions`, verify rows. `/import` is excluded from `CRAWL_PAGES` ([monkey.spec.ts:30-40](tests/e2e/monkey.spec.ts#L30-L40)); "import" is destructive-banned.
- **Undo a commit** — `/api/import/undo-commit` zero coverage. Accidental import corrupts the ledger.
- **Learn-aliases on commit** — `/api/import/learn-aliases` writes rules; nothing asserts the next import auto-categorises.

#### Backup / restore / rekey (critical — disaster-recovery features)

- **Backup → restore round-trip** — destructive-banned; restore replaces the active DB and logs the session out, which is why monkey can't do it. No spec exercises restore at all.
- **Scheduled-backup cron actually fires** — `backup-schedule.tsx` saves config; nothing tests cadence + prune-to-`keepCount`.
- **Rekey passphrase** — `/rekey` is in pages-smoke; no spec drives the form (current + new + confirm) and reconnects.

#### Multi-DB (NEW — 0.142 / 0.143)

- **Create / switch / unlock-the-new-one round-trip** — exercise the switcher dropdown end-to-end. The 2026-05-17 bug where `onSelect` vs `onClick` made the menu items no-op suggests we have no smoke coverage of the switcher at all.
- **Per-DB backup directory migration** — confirm `<base>/budgets_*.sqlite` from a single-DB install moves into `<base>/default/` cleanly.
- **Backfill marker behaviour across restore** — restore an older DB, confirm orphan-transfer backfill doesn't re-fire when the registry flag is set.

#### Transactions

- **Bulk recategorise** — multi-select + change category + reload + verify everywhere (category-spend widget, cashflow report). Monkey doesn't multi-select.
- **Transfer-pair confirmation** — `/api/transfers/suggestions/[id]/confirm` should drop both legs from income/expense totals. Uncovered.
- **Saved-filter delete + reorder** — `saved-filters.spec.ts` covers save only.
- **External-counterparty pairing → CSV reconciliation** — 0.137 minted synthetic legs; the cross-account promotion in commit-batched is uncovered end-to-end.

#### Scheduled / Calendar

- **Create scheduled → confirm on `/scheduled` AND `/calendar`** — monkey POSTs but never navigates to verify rendering.
- **Edit OCCURRENCE vs. SERIES** — `/api/scheduled/[id]/replace` splits a series; needs targeted-occurrence test.
- **Dismiss missed scheduled** — `/api/scheduled/[id]/dismiss-missed` uncovered.
- **Scheduled-transfer false-missed regression** — 0.136 fix has unit coverage; an E2E walk would catch UI-side regressions.

#### Accounts / reconcile

- **Reconcile flow** — `/api/accounts/[id]/reconcile` walks the ledger and clears transactions. Headline correctness feature, uncovered end-to-end.
- **Account delete with linked transactions** — destructive-banned, so reassignment / orphan-handling is untested.

#### Categories

- **Edit colour propagates everywhere** (sidebar, transaction-row pill, category-spend chart, cashflow report). Monkey can't open the custom swatch picker; doesn't navigate to verify.
- **Delete category with children / linked txns** — destructive-banned.
- **Reparent (drag in tree)** — no DnD coverage on the category tree.

#### Investments / Super

- **Add investment → quantity appears on dashboard `stocks-summary`** — monkey POSTs but doesn't return to verify.
- **Vest schedule on RSU** — `/api/investments/[id]/vests` un-covered. (0.144 added the confirm-dialog guard on the delete path; the happy path is still un-tested.)
- **Watchlist add → history fetch** — uncovered.

#### Settings / feature flags

- **Toggle Investments / Super OFF → sidebar link disappears, page redirects, dashboard widgets drop** — monkey verifies the SWITCH state persists, not the DOWNSTREAM effects.
- **Add sample data / Remove sample data** — destructive-banned.
- **User invite / role change** — uncovered.

#### Dashboard

- **DnD a widget from drawer to a SPECIFIC cell + reload + assert position** — `dashboard-edit.spec.ts` covers the click-side flow only.
- **Widget config sub-pickers** (e.g. pin tracked-stock to investment X) — uncovered.
- **Resize handles** — no spec drags a corner.

#### Auth / session

- **Lock / unlock round-trip** — destructive-banned.
- **Wrong-passphrase rate-limit / lockout** — 0.144 added a 5-attempts-per-60s limit on `/api/unlock` + `/api/rekey`; an E2E driver could verify the 429 trigger + Retry-After header.

#### Cross-cutting blind spot

- Monkey treats any POST/PATCH within 800 ms as healthy ([_monkey-helpers.ts:251-258](tests/e2e/_monkey-helpers.ts#L251-L258)). Doesn't check HTTP body, doesn't verify rows reached the DB, doesn't navigate cross-page. A route that returns `200 { ok: true }` without persisting reads as green.

## Ideas

### Dashboard / widgets
- Sticky widget order on mobile — the responsive grid wraps to
  one column; preserve a saved priority rather than reading off
  the `lg` layout.

### Settings
- Palette editor for the OTHER chart types — cashflow, calendar,
  Sankey. Same pattern as the schedule-chart palette editor.
- "Show advanced" toggle to hide grace-days / match-window inputs
  by default.
- Settings → Maintenance: surface the "Re-run transfer backfill"
  reset button (clears `app_settings.transfer_backfill_done`) +
  "Reset & re-scan" button (currently only on `/transactions`).

### Multi-DB
- Per-DB backup schedule (regression from "global" — would need a
  schema migration to move schedule back from `databases.json`
  into per-profile state. Defer until someone actually asks.)

### Reports / scheduled / etc.
- (placeholders — add as you walk the app and find rough edges)

### Infrastructure / tests
- Expand E2E coverage:
  - Transactions: add a transaction via UI, verify it appears in
    the list and updates the dashboard total.
  - Scheduled: add a scheduled txn via the global "+ scheduled"
    dialog, verify it appears on /scheduled and the calendar.
  - Reports: walk each tab (Cashflow / Sankey / Envelope / YoY),
    confirm no console errors with seeded data.
  - Settings → Reset browser data: verify the action signs the
    operator out and lands them on /login.
  - **Multi-DB switcher dropdown** — open dropdown, click each
    profile entry, click "Create new database…" — verify the
    expected nav / dialog opens (this would have caught the
    0.142 → 0.144 `onSelect` regression).
- Seed-data fixtures: helpers under `tests/e2e/_seed.ts` for
  inserting accounts / transactions / categories so tests aren't
  forced to drive the UI through every setup step.
- Visual regression — Playwright + screenshots — at least on the
  dashboard with each chart palette applied.

## Architecture notes / risks

- Recharts 3.x bundles react-redux for its internal store. Any
  widget that mounts a `ResponsiveContainer` inside a layout that
  resizes rapidly (RGL drag, window resize during animation, etc.)
  risks the same subscriber-loop crash. The fix in 0.48 is to
  swap the chart for a static placeholder while `editMode` is on.
  If we add new chart-rendering widgets, they MUST follow the
  same pattern.
- Drizzle migrations apply on first unlock via
  `drizzle/better-sqlite3/migrator` against the live keyed
  connection (no longer hand-applied via psql per the SQLCipher
  switch). The migrator is idempotent + safe to re-run on every
  unlock.
- `next dev` holds a lock on `.next`, so the E2E rig uses a
  separate `.next-e2e` build dir (toggled via `E2E_TEST_BUILD=1`
  in `next.config.ts`).
- **Base UI vs Radix idiom mismatch**: `MenuPrimitive.Item` from
  `@base-ui/react/menu` fires `onClick`, not `onSelect`. The
  0.142 multi-DB switcher used `onSelect` (the Radix idiom from
  shadcn copy-paste) and was a silent no-op until 0.144. New
  Menu.Item handlers should always use `onClick`; grep the
  existing topbar usage for the canonical pattern.

## Done / dropped

### 2026-05-19

- **Calendar today-cell switched from blue to indigo** — three
  utility-class swaps in `cashflow-calendar.tsx` to match the
  brand-accent convention (theme `--primary` is near-black, so
  accents should be explicit indigo).
- **Two hover-only icons got the `lg:` prefix** — the announcements
  link arrow and the backup-notes pencil were stuck invisible on
  touch devices because `opacity-0 group-hover:opacity-100`
  without `lg:` left no way to surface them without a mouse.
- **`hideTransfers` dead prop removed from every report.** The
  global toggle was retired in 0.7.0; each tab has owned its own
  per-report pref since 0.131. The shared
  `hideTransfers={false}` thread through every sub-report was
  pure plumbing-rot. Cleaned out of `reports-view.tsx` and every
  sub-report's interface in one pass.

### 2026-05-18

- **Rename profile UI in Settings → Databases (0.146).** Inline
  rename per row with case-insensitive uniqueness enforcement.
- **Delete profile UI with typed-confirm gate (0.156).** Trash
  button per row → modal that requires retyping the label
  exactly; on confirm wipes the encrypted file + per-DB backup
  subdir. Server-side guards block the active DB and the last
  remaining DB.

### 2026-05-17

- **Multi-DB switcher dropdown menu items were no-ops** — used
  `onSelect` (Radix idiom) where Base UI's `MenuPrimitive.Item`
  fires `onClick`. Fixed in the same session 0.142 shipped.
- **CodeQL `js/path-injection` alert #13 on the multi-DB
  restore-swap.** Sanitised `livePath()` via the new
  `assertLivePath()` helper that asserts + re-binds the path
  (same dataflow pattern as the existing
  `assertWithinBackupDir`). Shipped 0.143.0.
- **Audit fixes — apply pass.** Shipped 0.144.0:
  - `bg-white dark:bg-slate-200` on Switch thumb (dark-mode
    glare).
  - `aria-current="page"` on the active profile entry in the
    DB switcher.
  - Vest delete in `investment-detail-panel.tsx` wrapped in
    `useConfirm()` (was a one-click no-undo data loss).
  - `<span onClick>` → `<div>` wrapper in `import-view.tsx`
    (semantic-only fix — the onClick was a pure bubble
    suppressor).
  - Control-character rejection on passphrase input
    (`validatePassphrase()` in `src/lib/passphrase.ts`) wired
    into `/api/unlock` + `/api/rekey`. SQLCipher's `PRAGMA key
    = '...'` interpolation already escaped single quotes; this
    blunts the CR/LF/NUL escape vector.
  - Rate-limit on `/api/unlock` + `/api/rekey` — 5 attempts
    per 60s, then 429 + `Retry-After`. New
    `src/lib/rate-limit.ts` token-bucket helper.
- **Multiple databases per install (0.142).** Profile registry
  at `<dataDir>/databases.json`, per-DB passphrase, re-unlock on
  switch, global backup schedule (moved from
  `app_settings.backup_schedule` to the registry), per-DB
  backup directory at `<base>/<profileId>/` with one-shot
  legacy-layout migration on first unlock.
- **Editable notes field on backup rows (0.141).** Inline-edit
  column; stored in `<backup-filename>.meta.json` sidecar
  outside the encrypted file.
- **"Reset & re-scan" button on `/transactions` (0.140).** Deletes
  every `is_synthetic=true` placeholder, then runs
  `pairTransfersInWindow({})` so orphans pair against real
  tracked-account counterparts.
- **Orphan-transfer backfill once-per-DB (0.139).**
  `app_settings.transfer_backfill_done` flag guards re-runs
  across restores.
- **Accounts report cells open inline popup (0.138).** Replaced
  the full-page navigation with a Cashflow-style dialog.
- **Synthetic-leg transfers + collapse to `transfer_pair_id` as
  sole truth (0.137).** Manual "Link as transfer (external)"
  mints synthetic stubs in an `isExternal=true` account.
  Commit-batched promotes synthetics in place on later CSV
  import. Auto-matcher / `manualPair` stop writing the legacy
  `is_transfer` flag.

### 2026-05-15 → 16 — Up-next table cleared

Every item from the 2026-05-15 "Up next" table shipped in
0.131 → 0.136. Captured here without dates because the original
review doc carried them:

- Password change Dialog with masked confirm (replaced
  `window.prompt`).
- `admin/admin` forced rotation via `mustChangePassword` flag in
  the JWT session — gated by `auth()`-side `compare("admin",
  user.passwordHash)`.
- `SQLITE_BUSY` race on sample-data seed fixed via
  `sampleDataSeeded` flag in `app_settings`.
- `UNIQUE constraint failed: users.username` cleared by the same
  flag pattern on `seedDefaultUserIfMissing`.
- Six hover-only controls moved to `lg:opacity-0
  lg:group-hover:opacity-100` (envelope eye-toggle,
  transaction-row Unlink, super-view heading pencil,
  schedule-button affordances, saved-filters delete, +1).
- `/scheduled` cold-load auto-select removed when `?id=` is
  absent.
- `MAX_UPLOAD_BYTES = 5 MB` cap on `/api/accounts/import`.
- Saved-filter rows rewritten as `<li>` wrapping a real `<button>`.
- Member-role gated out of `/api/rekey`, `/api/lock`, `/api/backup/*`
  via `isAdmin(session)` check.
- Payee-rules delete wired through `useConfirm()`.
- Bulk-delete toast gained Undo button (10-second window).
- Dashboard widget-drawer gained click-to-add `<button>` alongside
  the drag handle.

### Earlier history

- 2026-05-15: **Category-spend dashboard widget.** Shipped 0.79.0.
  Single-category multiInstance tile; picks a category in edit
  mode, renders total + count over the last 30 days, links into
  the transactions list filtered to that category. Rolls up
  descendants by default (matches cashflow report semantics).
- 2026-05-15: **Per-account balance-trend widget.** Shipped 0.60
  → 0.68 as the "Account" widget — multiInstance, picks an
  account (including archived), shows balance + institution +
  7-day running-balance area sparkline.
- 2026-05-14: **Multiple instances of the same widget type.**
  Shipped 0.55 as `WidgetSpec.multiInstance`. Tracked-stock was
  the first opt-in; the saved layout now carries a UUID
  `instanceId` per placement so RGL keys don't collide.
- 2026-05-13: **React error #185 "Maximum update depth exceeded"
  when adding any dashboard widget.** Symptom: edit dashboard,
  drag any pill from the drawer, page crashes with the error
  overlay. Confirmed reproducible from `tests/e2e/dashboard-edit
  .spec.ts` "multi-step slow drag" case. Root cause: recharts
  3.x's react-redux store fires nested subscriber notifications
  every time its `ResponsiveContainer` resizes; RGL was resizing
  every chart cell on every drag-over event. Fix in 0.48: the
  chart inside `net-worth-trend-card` and `tracked-stock-card`
  is replaced with a "Chart hidden while editing" placeholder
  when `editMode === true`.
- 2026-05-13: **E2E rig set up.** Playwright + headless chromium
  + fresh SQLCipher DB at `tests/e2e/.data/test.db` + Next
  production build under `.next-e2e/` so the live dev server is
  untouched. Six spec files: `dashboard-widgets`,
  `dashboard-edit`, `pages-smoke`, `monkey`, `saved-filters`,
  `screenshots`. Run with `pnpm test:e2e`.
