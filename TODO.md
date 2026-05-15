# TODO

Running scratchpad of ideas, half-baked thoughts, known bugs and
follow-up work. Triaged loosely — promote anything that's lined
up for "next session" into the top section.

> Convention: when you fix or drop an item, move it to the bottom
> under **Done / dropped** with a one-line note so we keep
> institutional memory rather than vanishing the context.

## Up next

_Prioritised triage from the overnight review (2026-05-15). Each
item is one commit-sized step; the full audit lives further down
under "Overnight review findings". Sorted by `Impact - Effort -
Risk` descending._

| # | Issue | I/E/R | First commit |
|---|---|---|---|
| 1 | Password change uses `window.prompt` (plaintext, no mask, no confirm) | 5/2/1 | Add a `<Dialog>` to `user-manager.tsx` with two `<Input type="password">` fields, replacing `window.prompt` |
| 2 | `admin/admin` default with no forced rotation | 5/2/2 | In `src/db/seed.ts`, flag seeded admin with `mustChangePassword=true`; gate `/dashboard` → `/settings#password` until cleared |
| 3 | `SQLITE_BUSY` race seeding sample data on cold start | 4/2/1 | Wrap `seedSampleData` in `db.transaction(..., { behavior: 'immediate' })` with an "any sample row exists" short-circuit |
| 4 | `UNIQUE constraint failed: users.username` on default-user seed | 3/1/1 | Change admin seed INSERT to `ON CONFLICT (username) DO NOTHING` |
| 5 | Six hover-only controls missing `lg:` prefix (mobile-invisible) | 4/1/2 | Sweep `opacity-0 group-hover:opacity-100` → `lg:opacity-0 lg:group-hover:opacity-100` across the 6 cited files in one commit |
| 6 | `/scheduled` cold-load auto-selects + fires 10 000-row fetch | 4/2/1 | Skip auto-select when `searchParams.id` is absent in `scheduled-list-view.tsx` |
| 7 | No size cap on `/api/accounts/import` CSV/OFX upload | 4/1/2 | Add 200 MB `Content-Length` check at top of `POST` (mirror backup restore) |
| 8 | Saved-filter rows are `<li onClick>` not keyboard-reachable | 3/1/1 | Convert each row in `saved-filters.tsx:182-201` to `<button type="button">` |
| 9 | Member-role users can rekey / lock / backup / restore | 4/2/2 | Add `requireAdmin(session)` guard at top of `/api/rekey`, `/api/lock`, `/api/backup/*` (matches `/api/users/*`) |
| 10 | Payee-rules delete has no confirmation + missing `aria-label` | 3/1/2 | Wire `useConfirm()` around the delete handler and add `aria-label="Delete rule"` |
| 11 | Bulk-delete toast has no Undo on `/transactions` | 4/3/2 | Add `action: { label: 'Undo', onClick: restoreIds }` to the toast in `transactions-view.tsx:417`, reusing the optimistic snapshot |
| 12 | Dashboard widget-drawer pills are drag-only (no keyboard path) | 4/3/2 | Add a "+" `<button>` next to each pill in `widget-drawer.tsx` that calls the existing `addWidget(spec)` |

**Explicitly dropped from the next-up list:**
- `hideTransfers` dead prop threaded through reports — pure cleanup, do during the next reports refactor.
- Calendar `bg-blue-50` → `indigo-50` — cosmetic palette tweak; bundle with a broader theme pass.
- Watchlist "Remove" vs holding "Delete" verb inconsistency — single-word copy nit; ship with another investments PR.

## Known bugs / regressions to investigate

### 1000-monkeys crawl findings

<!-- monkey:start -->
_Last run: 2026-05-15T15:06:51.588Z · 0 issues, 2 questions._

#### Questions for review

_The crawl filled these forms and clicked their submit, but saw no network call, toast, or navigation. Possibly a silent no-op bug, possibly intentional — decide which._

##### /settings
- ❓ **submit "Create"** — Filled 3 inputs and clicked **Create** — no network call, toast, or navigation fired. Should it have?

##### /superannuation
- ❓ **submit "Save"** — Filled 3 inputs and clicked **Save** — no network call, toast, or navigation fired. Should it have?

<!-- monkey:end -->

### Overnight review findings (2026-05-15)

_Compiled from three parallel review agents + log inspection of the
monkey crawl. The monkey only listens to client-side `page.console`
and `page.pageerror`, so server-side errors written to stdout never
make it into the auto-overwritten block above — they're captured
here._

#### Server-side errors observed in `next start` logs during e2e

- 🔴 **`SQLITE_BUSY` / `SQLITE_BUSY_SNAPSHOT` on `[db] Failed to seed sample data`** — fires on every cold start of the e2e webserver. Two concurrent module evaluations both try to populate the sample-data tables, one blocking the other. Repro: any cold `pnpm test:e2e`. Fix candidate: wrap the entire seed in a single `IMMEDIATE` transaction, or guard with "if any sample row exists, skip" before opening the transaction.
- 🟡 **`UNIQUE constraint failed: users.username` on `[db] Failed to seed default user`** — same module-eval race, fires ~6 times per startup. Benign once the row exists but noisy in logs (hides real errors). Fix: `INSERT OR IGNORE` / `ON CONFLICT DO NOTHING` for the admin seed.
- 🟡 **`"next start" does not work with "output: standalone" configuration` warning** — pre-existing per CHANGELOG, functional impact nil. Suggests `output: "standalone"` in `next.config.ts` should be conditional on build target.

#### Monkey crawl findings beyond the auto-block

- 🟡 **Dashboard monkey test is flaky — `cycleSelects` intermittently hangs to 60 s timeout** — observed 1× across 5 iterations (iter 1 hung mid-run, iters 2-5 finished in 12-20 s each). ~20 % flakiness rate. Likely cause: a `<select>` re-renders the page on change, invalidating the locator mid-iteration on the multi-instance-heavy dashboard. Fix candidate: skip selects whose parent is `[data-slot=widget-tile]` AND has `aria-haspopup` (those are popover-picker triggers); add `try`/`catch` around the `count()` call so a detached locator can't propagate as a hang.
- 🟢 **`/settings` "Create" form silent no-op — verdict: monkey limitation, not an app bug** — confirmed by direct code read of `user-manager.tsx:194-297`. The `CreateUserForm` submit button is `disabled={busy || !username || !password}` with a CSS `disabled:pointer-events-none`. A disabled button drops the click at the CSS layer, no submit event fires. Either the monkey clicks before React commits the typed `username`/`password` state, or its `fill()` doesn't dispatch React-compatible `input` events so the controlled state never updates. The form itself is correct — a real user fills the fields, the button enables, POST fires. Improvement: re-read the input `.value` after fill in the monkey to assert controlled-state caught up before clicking submit.
- ❓ **`/superannuation` "Save" form silent no-op — verdict: cannot tell from code alone** — `SnapshotForm` in `super-view.tsx:449-563` is clean: `handleSubmit` calls `preventDefault` then validates (year + balance) with `toast.error` returns, then `fetch`. Year defaults to `new Date().getFullYear()` so it always passes; balance starts empty and would trigger `toast.error("Enter a balance")` if the monkey's fill didn't reach React state. If fill DID reach state, the POST would fire and a toast would appear. The crawler reports neither — so either (a) its fill doesn't dispatch React-compatible input events, OR (b) it's not seeing the sonner toast portal selector. Either way: not an app bug, a monkey-instrumentation gap. Improvement: poll for `[data-sonner-toast]` explicitly, and re-read input `.value` after fill.

#### Security review (full audit clean otherwise)

_Walked every API route's auth gate, every `sql\`\`` template, every
`dangerouslySetInnerHTML` (zero), every `process.env.*` read.
Nothing critical._

- 🟡 **`admin/admin` default with no forced rotation** ([src/db/index.ts:226](src/db/index.ts#L226), [src/db/seed.ts:34](src/db/seed.ts#L34)). LAN attacker who reaches unlock + guesses the SQLCipher passphrase gets admin. Fix: force-password-change on first login when admin user's hash matches the seed value, or refuse to start with the default still in place.
- 🟡 **No size cap on CSV/OFX upload at `/api/accounts/import`** ([src/app/api/accounts/import/route.ts:88](src/app/api/accounts/import/route.ts#L88)). Backup restore enforces 200 MB; apply the same idea here.
- 🟡 **Backup download `Content-Disposition` reflects filename unencoded** ([src/app/api/backup/[filename]/download/route.ts:43](src/app/api/backup/[filename]/download/route.ts#L43)). Filename regex blocks quotes/CRLF so not exploitable as-is. Defence in depth: RFC 6266 `filename*=UTF-8''<encoded>`.
- 🔵 **Member-role users can rekey / lock / backup / restore** — `/api/rekey`, `/api/lock`, `/api/backup/*` only check `session`, not `role`. Confirm intentional or gate behind `isAdmin` (matches `/api/users/*`).
- 🔵 **Session TTL defaults to NextAuth's 30 days.** Tighten `session.maxAge` in `src/lib/auth.ts` if desired.

#### UX review — by page

**/dashboard**
- 🟡 **Drag-only widget placement, no keyboard equivalent** — [widget-drawer.tsx:62-80](src/components/dashboard/widget-drawer.tsx#L62-L80). Pills are HTML5-draggable `<div>`s with no click/Enter alternative. Add a "+" button per pill that drops the widget at the bottom of the grid.
- 🔵 **Edit-mode trash icon has no confirmation** — `widget-tile.tsx` remove button wipes a placement on a single misclick. Use `useConfirm` or surface Undo.

**/transactions**
- 🟡 **Hover-only Unlink button missing `lg:` prefix** — [transaction-row.tsx:821](src/components/transactions/transaction-row.tsx#L821) `opacity-0 group-hover:opacity-100`. Per `feedback_mobile_hover.md`, must be `lg:opacity-0 lg:group-hover:opacity-100` or invisible on touch.
- 🟡 **Bulk-delete toast has no Undo** — [transactions-view.tsx:417](src/components/transactions/transactions-view.tsx#L417). Optimistic update is already in place; wire an Undo into the toast.
- 🟡 **Saved-filter rows are `<li onClick>` not `<button>`** — [saved-filters.tsx:182-201](src/components/transactions/saved-filters.tsx#L182-L201). Not keyboard-reachable.
- 🔵 **Cancel-edit Link is a plain `<a href>`** — [transaction-filters.tsx:187-192](src/components/transactions/transaction-filters.tsx#L187-L192). Server round-trip; inconsistent with `router.replace` used elsewhere.

**/scheduled**
- 🟡 **Right panel auto-selects on cold load + fires a 10 000-row `/api/transactions` fetch** — [scheduled-list-view.tsx:461-481](src/components/scheduled/scheduled-list-view.tsx#L461-L481). Skip auto-select when URL has no `?id=`.
- 🟡 **Sort indicator only shows on the active column.** `/transactions` shows inert "↕" hints; `/scheduled` doesn't. Inconsistent.

**/calendar**
- 🔵 **Today / selected-day uses `bg-blue-50` / `border-blue-400`** ([cashflow-calendar.tsx:1222, 1357](src/components/calendar/cashflow-calendar.tsx#L1222)) — `theme.md` only documents indigo as brand accent. Switch to `indigo-50` / `indigo-400`.
- 🟡 **No keyboard arrow-nav between calendar cells** — tabbing through a 6-week grid is exhausting.

**/investments**
- 🟡 **Auto-selects highest-value holding on cold load** — [investments-view.tsx:74-87](src/components/investments/investments-view.tsx#L74-L87). Persist last-selected in displayPrefs.
- 🔵 **Watchlist delete says "Remove", holding delete says "Delete"** — inconsistent verb.

**/superannuation**
- 🟡 **Heading edit pencil's `opacity-0 group-hover:opacity-100` missing `lg:`** — [super-view.tsx:342](src/components/super/super-view.tsx#L342). Invisible on touch.
- 🔵 **`fundColumns` keeps a column for every fund ever owned** ([super-view.tsx:91-105](src/components/super/super-view.tsx#L91-L105)). Wide tables on mobile, closed funds scroll right indefinitely.

**/reports**
- 🟡 **Income tab has no totals row** — [reports-view.tsx:441-457](src/components/reports/reports-view.tsx#L441-L457). Monthly / Cashflow / Envelope have footer totals.
- 🟡 **Envelope exclude eye-toggle missing `lg:` prefix** ([envelope-report.tsx:473](src/components/reports/envelope-report.tsx#L473)). Mobile can't toggle excludes.
- 🔵 **`hideTransfers` is hardcoded `false` and threaded through every sub-report as a prop** — [reports-view.tsx:210](src/components/reports/reports-view.tsx#L210). Dead.

**/categories**
- 🟡 **Whole row is draggable, not just the handle** — [category-manager.tsx:340-345](src/components/settings/category-manager.tsx#L340-L345). Users discover by accident.
- 🔵 **No keyboard reorder.** Power users feel this with 50+ categories.

**/settings**
- 🔴 **Password change uses `window.prompt`** — [user-manager.tsx:59-71](src/components/settings/user-manager.tsx#L59-L71). Plaintext native prompt, single field, no masking, no confirm. Highest-severity UX item. Build a Dialog with two `<Input type="password">` fields (mirror `EditAccountDialog`).
- 🟡 **Payee-rules delete has no confirmation** — [payee-rules-manager.tsx:86-92](src/components/settings/payee-rules-manager.tsx#L86-L92). Rest of Settings uses `useConfirm`.
- 🟡 **Payee-rules delete icon-only button missing `aria-label`** — same line. Has only `title`.

**Cross-cutting**
- 🟡 **Six places use `opacity-0 group-hover:*` without `lg:` prefix** (envelope-report, transaction-row Unlink, super-view heading pencil, schedule-button affordances, saved-filters delete). Explicit violations of `feedback_mobile_hover.md`.
- 🟡 **No empty-state CTA on /scheduled, /superannuation, /reports** — only "No X yet" text. /investments has the CTA.

#### Test-coverage gaps (what the monkey CAN'T catch)

_The monkey clicks safe buttons, cycles selects, toggles switches,
fills inputs with `"monkey-test"` / `42` / `2026-01-01`, submits,
watches 800 ms for any network call / toast / nav. Bans labels
matching `delete|remove|archive|clear|import|sign out`. Never
navigates cross-page to verify side-effects landed. Every "create
X then verify X appears" flow below sits in this blind spot._

##### Import / CSV / QIF (high severity — destructive on miss)
- **CSV/QIF import end-to-end** — drop a real bank file, categorise, commit, navigate to `/transactions`, verify rows. `/import` is excluded from `CRAWL_PAGES` ([monkey.spec.ts:30-40](tests/e2e/monkey.spec.ts#L30-L40)); "import" is destructive-banned.
- **Undo a commit** — `/api/import/undo-commit` zero coverage. Accidental import corrupts the ledger.
- **Learn-aliases on commit** — `/api/import/learn-aliases` writes rules; nothing asserts the next import auto-categorises.

##### Backup / restore / rekey (critical — disaster-recovery features)
- **Backup → restore round-trip** — destructive-banned; restore replaces the active DB and logs the session out, which is why monkey can't do it. No spec exercises restore at all.
- **Scheduled-backup cron actually fires** — `backup-schedule.tsx` saves config; nothing tests cadence + prune-to-`keepCount`.
- **Rekey passphrase** — `/rekey` is in pages-smoke; no spec drives the form (current + new + confirm) and reconnects.

##### Transactions
- **Bulk recategorise** — multi-select + change category + reload + verify everywhere (category-spend widget, cashflow report). Monkey doesn't multi-select.
- **Transfer-pair confirmation** — `/api/transfers/suggestions/[id]/confirm` should drop both legs from income/expense totals. Uncovered.
- **Saved-filter delete + reorder** — `saved-filters.spec.ts` covers save only.

##### Scheduled / Calendar
- **Create scheduled → confirm on `/scheduled` AND `/calendar`** — monkey POSTs but never navigates to verify rendering.
- **Edit OCCURRENCE vs. SERIES** — `/api/scheduled/[id]/replace` splits a series; needs targeted-occurrence test.
- **Dismiss missed scheduled** — `/api/scheduled/[id]/dismiss-missed` uncovered.

##### Accounts / reconcile
- **Reconcile flow** — `/api/accounts/[id]/reconcile` walks the ledger and clears transactions. Headline correctness feature, uncovered end-to-end.
- **Account delete with linked transactions** — destructive-banned, so reassignment / orphan-handling is untested.

##### Categories
- **Edit colour propagates everywhere** (sidebar, transaction-row pill, category-spend chart, cashflow report). Monkey can't open the custom swatch picker; doesn't navigate to verify.
- **Delete category with children / linked txns** — destructive-banned.
- **Reparent (drag in tree)** — no DnD coverage on the category tree.

##### Investments / Super
- **Add investment → quantity appears on dashboard `stocks-summary`** — monkey POSTs but doesn't return to verify.
- **Vest schedule on RSU** — `/api/investments/[id]/vests` un-covered.
- **Watchlist add → history fetch** — uncovered.

##### Settings / feature flags
- **Toggle Investments / Super OFF → sidebar link disappears, page redirects, dashboard widgets drop** — monkey verifies the SWITCH state persists, not the DOWNSTREAM effects. Feature flags routinely "half-toggle" because a reactivity check is missed somewhere.
- **Add sample data / Remove sample data** — destructive-banned.
- **User invite / role change** — uncovered.

##### Dashboard
- **DnD a widget from drawer to a SPECIFIC cell + reload + assert position** — `dashboard-edit.spec.ts` covers the click-side flow only.
- **Widget config sub-pickers** (e.g. pin tracked-stock to investment X) — uncovered.
- **Resize handles** — no spec drags a corner.

##### Auth / session
- **Lock / unlock round-trip** — destructive-banned.
- **Wrong-passphrase rate-limit / lockout** — uncovered.

##### Cross-cutting blind spot
- Monkey treats any POST/PATCH within 800 ms as healthy ([_monkey-helpers.ts:251-258](tests/e2e/_monkey-helpers.ts#L251-L258)). Doesn't check HTTP body, doesn't verify rows reached the DB, doesn't navigate cross-page. A route that returns `200 { ok: true }` without persisting reads as green.

- _none open_

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
- Drizzle migrations are hand-applied via `npm run db:migrate`
  (which needs the SQLCipher key in env). The deploy image runs
  this on startup; dev machines have to remember.
- `next dev` holds a lock on `.next`, so the E2E rig uses a
  separate `.next-e2e` build dir (toggled via `E2E_TEST_BUILD=1`
  in `next.config.ts`).

## Done / dropped

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
  untouched. Three spec files: `dashboard-widgets`,
  `dashboard-edit`, `pages-smoke`. Run with `npm run test:e2e`.
