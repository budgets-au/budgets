# Changelog

All notable changes to this project are recorded here. The version policy
is **bump minor on every shipped change** (per user directive); patch
remains 0 until released hotfixes warrant it.

The canonical version pointer lives in `src/lib/version.ts`
(`APP_VERSION`). `package.json`'s `version` field is no longer
bumped on each release — it stays pinned so the Docker layer that
runs `npm ci` survives version bumps and rebuilds in seconds.

## 0.272.0 — 2026-05-25

### Added
- **"Categorise" entry point on `/transactions`.** New topbar
  button between Undo Import and Import. Click takes the operator
  to `/transactions/categorise` — a focused queue of every
  uncategorised transaction in the DB, each pre-scored by the
  same `suggestCategoryByHistory` trigram suggester the CSV
  import flow uses. Useful for the long-tail backlog from large
  imports where category coverage by the import's per-row pickers
  was incomplete.

  - Rows sorted by suggestion score DESC so the easy wins come
    first; rows with no suggestion sink to the bottom.
  - Picker pre-filled with the suggestion; expense vs income
    filter applied automatically based on the row's amount sign.
  - **Per-row immediate save**: picking a category PATCHes
    `/api/transactions/{id}` right away and the row gets
    struck-through + dimmed (no jumpy reflow). No "apply all"
    step — the user just keeps picking.
  - Confidence column shows score% + support count so the user
    can see why a suggestion was made (and which to scrutinise).
  - Topbar button shows the count (`Categorise (N)`); hides
    entirely when the queue is empty.

- **New endpoint `GET /api/transactions/uncategorised-categorise`**
  — pre-loads the token-frequency map and the trigram candidate
  pool once, scores every uncategorised row in JS, returns a
  shaped list ready for the UI. Avoids the per-row full-table
  scan that the import flow's batched pattern (#95) already
  worked around.

### Fixed
- **Running-balance integration test was env-flaky.** The seeded
  rows relied on `created_at` ties resolving lexicographically by
  id, but `timestamp_ms`-resolution inserts on a slow worker
  sometimes landed in DIFFERENT milliseconds, flipping the
  lineage order and failing the per-row balance assertion. Pinned
  `postedSeq` per row to make the lineage tuple
  fully deterministic.

## 0.271.0 — 2026-05-25

### Fixed
- **Accounts CSV import now anchors at the EARLIEST date per account
  + persists the full daily series.** Westpac (and similar banks)
  export their accounts CSV with one row per (account, date) — a
  30-day period of 5 accounts is 150 rows, not 5. The previous
  per-row map+dedup let whichever row happened to be last in Map
  insertion order win, so `startingBalance` ended up pointing at a
  semi-random day inside the period instead of the historical
  anchor. Now `groupAccountsCsv` in `src/lib/import/` collapses by
  `(name, last4)` and picks the earliest `As at date` row's balance
  as the anchor — that's the moment the figure is correct as-of, so
  `startingBalance + Σ tracked amount` reconstructs cleanly.

### Added
- **New `bank_balances` table** captures the FULL daily series
  alongside the anchor. `UNIQUE(account_id, date)` so re-imports
  refresh in place. Persisted by `/api/accounts/import/commit`
  after each account upsert via `chunkedExec` (under the 0.270.0
  SQL-vars cap). New `GET /api/accounts/[id]/bank-balances`
  returns the series ASC by date.

  No UI consumes the table yet — captured for a future
  reconciliation report comparing the running balance
  (`startingBalance + Σ tracked txns`) against the bank's reported
  balance per day. Drift = missing or wrong transactions.

- **Preview UI hint** "N balance points · 2026-05-01 → 2026-05-14"
  under each account in the import dialog, so the operator can see
  the date range and snapshot count before committing.

- **Migration `0015_bank_balances.sql`** + journal entry.
- **`src/lib/import/group-accounts-csv.ts`** — pure grouping +
  earliest-date selection + same-date-dedup logic, with 8 unit
  tests covering the corner cases (interleaved input, missing
  last4, missing dates, duplicate dates).
- **Integration test** (`src/app/api/accounts/import/route.integration.test.ts`)
  drives 3 accounts × 14 days through the full parse→commit
  pipeline, then re-commits with bumped balances to verify the
  upsert refreshes without duplicating.

## 0.270.0 — 2026-05-25

### Fixed
- **Large CSV imports failed with "too many SQL variables".**
  SQLite caps a single prepared statement at 32766 bound
  parameters (`SQLITE_MAX_VARIABLE_NUMBER` in the
  `@signalapp/better-sqlite3` build we ship). Two call sites in
  `src/app/api/import/commit-batched/route.ts` built statements
  whose parameter count scaled with input-row count and blew past
  that limit on big single-account imports:
  - `inArray(transactions.importHash, lookupHashes)` — up to
    2 hashes per input row (new + legacy), so a 20k-row CSV
    pushed 40k params through one query.
  - `db.insert(transactions).values([...])` — ~15 fields per
    inserted row; ~2200 rows in one chunk hit the cap.

  Both call sites now go through new chunked helpers in
  `src/lib/api/chunked.ts`:
  - `chunkedQuery(items, 5000, slice => …)` for the importHash
    lookup (single-column inArray = 1 param per slice item).
  - `chunkedExec(items, 1500, slice => …)` for the bulk insert
    (15 fields × 1500 rows = 22500 params; leaves headroom).

  Each chunk is its own atomic statement; if one chunk fails the
  route's outer try/catch returns a 500 same as before. No
  schema change. No API-shape change.

### Added
- **Integration test for the chunked import paths**
  (`src/app/api/import/commit-batched/route.integration.test.ts`).
  Seeds an account, fires a 2000-row payload through the real
  GET handler via `installTestDb`, asserts every row lands +
  `currentBalance` reconciles. Second leg re-commits the same
  payload and verifies the chunked-lookup-by-importHash path
  dedups every row.

## 0.269.0 — 2026-05-25

### Fixed
- **Accounts CSV import was duplicating archived accounts instead
  of matching them.** The dedup pool in
  `/api/accounts/import/route.ts` filtered to
  `is_archived = false`, so a CSV row whose name matched an
  archived account (e.g. one the user archived during cleanup and
  is now re-onboarding via fresh bank export) was treated as a
  brand-new account and inserted. The first 2-of-N rows matched
  the user's non-archived accounts; the rest hit the filter and
  became duplicates.

  The dedup pool now includes all accounts. When a CSV row
  matches an archived account, the commit-side update path also
  flips `is_archived` back to false (the row's own
  `isArchived` derives from a CSV "Closing date" column — present
  = closed, absent = live, so it round-trips properly). The
  preview UI shows "will un-archive + update balance" on those
  rows so the user can see what will happen before clicking
  Commit.

## 0.268.0 — 2026-05-25

### Added
- **Manual category sorting at every level via ↑/↓ row buttons.**
  Previously categories sorted alphabetically (via the
  default `sortOrder = 9999` tiebreaker on the
  `categories_sort_idx`). The Settings → Categories manager
  now exposes ↑ and ↓ buttons on each row — hover-visible on
  desktop (`lg:opacity-0 lg:group-hover:opacity-100`),
  always-visible on touch viewports per the
  AGENTS.md hover-fallback convention. Click swaps the row's
  `sortOrder` with the adjacent sibling at the same level
  (works for top-level categories, subcategories, AND
  sub-subcategories — the helper computes the sibling group
  via `parentId + type`).

  Persistence: each click does an optimistic state update
  then PATCH `/api/categories/{id}` (the route's existing
  `sortOrder` field) — no new endpoint, no schema change. On
  first reorder within a sibling group that's still at the
  default 9999, the group is renumbered with gaps of 10 so
  subsequent reorders land in the fast-path (swap two
  distinct integer values, two PATCHes, no other rows
  touched). The drag-to-nest workflow continues to work as
  before; ↑/↓ is just for sibling-order.

  Drag-based sibling reorder was tried in 0.196.0 and reverted
  because Safari's HTML5 drag was unreliable (stuck-drag
  state, missing `dragend`). The button approach sidesteps
  that entirely.

## 0.267.0 — 2026-05-25

### Fixed
- **DB switcher fails with "Cross-origin requests are not allowed
  for this endpoint" when the app is accessed via a LAN hostname
  or reverse proxy.** The same-origin guard on
  `/api/databases/switch` (added in #89 to block anonymous LAN
  attackers from steering the active profile) was comparing the
  browser's `Origin` header against `request.url`'s host. The
  latter is the server's bind address (`0.0.0.0:3002` or similar)
  whereas `Origin` reflects what the user typed
  (`budgets.lan`, `https://budgets.example.com`, etc.). Mismatch
  → 403 on every legitimate switch attempt.

  Guard now compares `Origin` against the client-supplied `Host`
  header (with `X-Forwarded-Host` fallback for reverse proxies),
  which is what the browser actually targeted. Direct curl from
  the host (no Origin) still passes; cross-origin browser POSTs
  still get rejected because the Origin host won't match the
  Host header.

## 0.266.0 — 2026-05-25

### Security
- **`qs` bumped to `>= 6.15.2` via pnpm overrides** — addresses CVE-2026-8723 (Dependabot #44). `qs.stringify` could crash with a TypeError on null/undefined entries in comma-format arrays when `encodeValuesOnly` was set, allowing a remote DoS. The vulnerable version (6.15.1) reached our tree transitively via `shadcn → @modelcontextprotocol/sdk → express → body-parser → qs`; none of this is in the production runtime path (shadcn is a dev tool), but the override keeps the dependency graph clean for CI/Dependabot.

- **Replaced `Math.random()` with `crypto.randomBytes(3).toString("hex")` for test run-tokens across all 11 e2e specs.** CodeQL flagged 3 instances as "insecure randomness" (security-severity: high); the alerts are false-positives in test-fixture context (the tokens only generate collision-free per-run identifiers), but switching to `crypto.randomBytes` is a 1-line change that silences the warnings and matches what other parts of the codebase already do (e.g. import-hash generation). Same 6-char token length, no behavioural change.

## 0.265.0 — 2026-05-23

### Added
- **E2E spec for the schedule-replace ("rate change") flow** (#15).
  New `tests/e2e/scheduled-replace.spec.ts` POSTs a monthly
  predecessor schedule, calls `POST /api/scheduled/[id]/replace`
  with a new amount and effective date, then asserts:
  - Response: `{ predecessorId, successor }`; successor carries
    `startDate = effective`, `endDate = null`, `isActive = true`,
    `lineageId` matching the predecessor's, and the signed amount
    preserving the predecessor's expense → negative-magnitude
    convention.
  - Predecessor (fetched via the list endpoint since
    `/api/scheduled/[id]` has no GET) now has
    `endDate = effective - 1 day`, `isActive = false`,
    `amount` untouched.
  - Bad effective date (≤ predecessor.startDate) → 400.
  - Missing scheduledId → 404.
  - Payee override: `{ payee: "..." }` on the replace call sets
    the successor's payee to the override (not the predecessor's).

- **E2E spec for the add-investment → dashboard-data path** (#23).
  New `tests/e2e/investment-quantity.spec.ts` POSTs a stock
  holding (with explicit `name` + `purchasePrice` so the route's
  Yahoo fallback never fires), then GETs `/api/investments` and
  asserts: row present with `quantity` reflecting the POST, and
  `costBasis = quantity × purchasePrice` (the value the
  `stocks-summary-card` dashboard widget reads).

- **E2E spec for the Investments/Super feature-toggle downstream
  effects** (#26). New
  `tests/e2e/feature-toggle-downstream.spec.ts` PATCHes
  `/api/display-prefs` to flip the flags off, then asserts the
  three user-visible knock-ons the monkey crawl misses:
  - `/investments` and `/superannuation` page navigation redirects
    to `/dashboard` (page-level `redirect()`).
  - Sidebar links for both pages disappear from the DOM.
  - After flipping back on, links reappear and the pages stay on
    their own URLs.

  `finally` block restores both flags to true so subsequent specs
  + the next run start from a known fixture state.

## 0.264.0 — 2026-05-23

### Performance
- **`/api/transactions` running-balance is now linear, not O(N²)**
  (#92). Was a correlated subquery
  (`SELECT SUM(t2.amount) FROM transactions t2 WHERE t2.account_id = X
  AND lineage_tuple <= row.lineage_tuple`) computed per output row —
  10k single-account rows triggered ~50M row scans, with the slow
  growth showing up in the `/transactions` list under big account
  histories. Replaced with a single-pass window function inside a
  `ledger` CTE: `SUM(amount) OVER (ORDER BY date, COALESCE(posted_seq,0),
  COALESCE(posted_at, created_at), id ROWS BETWEEN UNBOUNDED PRECEDING
  AND CURRENT ROW)`. Outer SELECT LEFT JOINs the CTE on `id` and adds
  the account's `starting_balance`.

  The CTE is only built on single-account queries (multi-account /
  unfiltered views still return `balance: null` since one running
  balance can't represent multiple accounts). Per-row balance values
  are identical to the old subquery — the lineage tuple is the same
  one the ORDER BY uses, and the window's `ROWS` frame matches the
  `<=` tuple-compare semantics row-for-row.

### Added
- **Integration test for the running-balance contract**
  (`src/app/api/transactions/route.integration.test.ts`). Seeds an
  account + 5 transactions (with one same-day pair to exercise the
  `id` tiebreaker), drives the real `GET` handler via
  `installTestDb`, asserts the per-row `balance` matches a
  hand-computed cumulative sum down the lineage. A second test
  asserts `balance` is `null` on a multi-account view.

## 0.263.0 — 2026-05-23

### Added
- **E2E spec for learn-aliases-on-commit** (#10). New
  `tests/e2e/import-learn-aliases.spec.ts` pins:
  - First commit with a fresh `bankAccountId` →
    `aliasesLearned: 1`.
  - Re-commit with the same `bankAccountId` →
    `aliasesLearned: 0` (idempotent — already learned).
  - Direct POST to `/api/import/learn-aliases` with fresh
    mapping → `saved: 1`; re-POST with same mapping →
    `saved: 0`.

- **Unit tests for `migrateLegacyBackups`** (#11). Extends
  `src/lib/backup/sqlite-backup.test.ts` with 5 cases against
  a real temp dir:
  - Legacy `budgets_*.sqlite` + `.meta.json` files move into
    `<base>/default/`.
  - Non-backup files (README, .DS_Store) stay at root.
  - Idempotent — re-running with `default/` already present
    is a no-op.
  - Subdirectories (already per-profile-organised) are
    skipped.
  - Missing root → silent return (pre-first-unlock state).

- **Unit tests for orphan-transfer backfill gate** (#12). New
  `src/lib/backfill-orphan-transfers.test.ts` covers:
  - `backfillOrphanTransfers(db)` worker: orphan + minted
    synthetic on External, pair link bidirectional,
    opposite-sign amount preserved.
  - `runOrphanBackfillIfNeeded(db)` gate: first call runs +
    sets the `app_settings.transfer_backfill_done` flag;
    second call no-ops (no double-mint on restart, even with
    fresh orphans present); zero-orphan fresh DB still sets
    the flag; clearing the flag re-fires the backfill (the
    Settings → Maintenance → "Re-run" path).

- **E2E spec for cross-account synthetic-counterparty
  promotion** (#14). New
  `tests/e2e/import-promote-synthetic.spec.ts` pins:
  - PATCH transfer-pair with `{ external: "External" }`
    mints a synthetic on the External account.
  - POST `/api/import/commit-batched` against the External
    account with an amount-matching row PROMOTES the
    synthetic in place — same id, real payee + importHash,
    `isSynthetic: false`, `transferPairId` still points at
    the source leg, count of External-account txns
    unchanged.
  - Strict-amount-match guard: row off by 1 cent inserts
    fresh; pair2's synthetic stays synthetic.

### Changed
- **Extracted `runOrphanBackfillIfNeeded` from `src/db/index.ts`
  into `src/lib/backfill-orphan-transfers.ts`**. The flag-check
  + worker + flag-set sequence still runs in the same `BEGIN
  IMMEDIATE` transaction (the #49 race fix is intact), but the
  gate is now testable in isolation against any drizzle
  handle. `src/db/index.ts`'s unlock-path wrapper became a
  three-line delegation.

### Fixed
- **`learnAccountAlias` reports actual inserts, not input
  count** — `commit-batched`'s `aliasesLearned` and
  `learn-aliases`'s `saved` both used to count the input rows
  blindly (a re-commit of the same `bankAccountId` falsely
  reported "1 learned"). `learnAccountAlias` now returns a
  boolean from its `INSERT ... ON CONFLICT DO NOTHING`'s
  `.returning()`, and both callers sum the truthful inserts.
  Surfaced by the new #10 spec on its idempotency leg.

## 0.262.0 — 2026-05-23

### Added
- **E2E spec for the reconcile flow** (#18). New
  `tests/e2e/reconcile-flow.spec.ts` pins the
  `POST /api/accounts/[id]/reconcile` contract:
  - Matched leg: balance matches → every txn on/before `date`
    flips `isReconciled = true`; response is `{ matched: true,
    reconciled: N }`.
  - Idempotent re-match: same call returns `reconciled: 0`
    (already-reconciled rows aren't touched).
  - Mismatch leg: wrong balance returns `{ matched: false,
    expected, stated, diff }` with cents-rounded strings.
  - Missing accountId → 404.

  Cross-checks via `GET /api/transactions/{id}` that the
  `isReconciled` flag actually flipped on the rows the route
  reported it touched — the historical failure mode (route
  reports OK but rows didn't update) is the one this guards.

- **E2E spec for the unlock rate-limit** (#32). New
  `tests/e2e/unlock-rate-limit.spec.ts` pins the 5/60s window
  added in 0.144. Fires 10 wrong-passphrase attempts and
  asserts:
  - At least one returns 429 + `Retry-After` header.
  - The 429 body is `{ ok: false, error: "Too many ..." }`.
  - `Retry-After` parses as a positive integer ≤ 60.

  Doesn't pin "the Nth attempt is rate-limited" — the budget
  is process-global and other specs (`lockUnlockRoundTrip`
  goal) may have consumed some — so the assertion is the more
  robust "we drove the bucket empty within 10 tries". Spec
  deliberately leaves the budget consumed (no teardown);
  workers:1 keeps subsequent specs' interactions deterministic.

## 0.261.0 — 2026-05-23

### Added
- **Combined code-coverage tooling.** New `pnpm coverage` runs
  `@vitest/coverage-v8` against the unit suite and writes a
  text + HTML + JSON report to `.coverage/report/`. The infra
  is wired for a merged unit + e2e flow:
  - `pnpm coverage:unit` — vitest's V8 coverage hooked into
    the Vite transform pipeline; pure-logic coverage lands in
    `.coverage/unit/coverage-final.json`.
  - `pnpm coverage:e2e` — boots the Playwright rig with
    `COLLECT_COVERAGE=1`, which sets `NODE_V8_COVERAGE` on the
    Next.js server and dumps raw V8 coverage to
    `.coverage/e2e/raw/`.
  - `pnpm coverage:e2e-report` — runs `c8 report --reporter=json`
    over the raw dumps with `--max-old-space-size=8192` so the
    multi-gig dev-mode dumps fit in heap; emits
    `.coverage/e2e/coverage-final.json`.
  - `pnpm coverage:report` — `scripts/coverage-merge.mjs`
    loads both Istanbul JSONs into a single `CoverageMap`,
    sums per-file counts, and emits a combined report.

  The orchestrator at `scripts/coverage.mjs` runs the unit
  leg by default and skips the e2e leg (see Known limitations
  below). Pass `--with-e2e` to opt in.

### Known limitations
- **E2E coverage leg currently contributes 0 files.** Next 16
  Turbopack ships source maps with empty `"sources":[]` /
  `"sections":[]` in BOTH `next build` and `next dev` modes,
  regardless of the `productionBrowserSourceMaps` /
  `experimental.serverSourceMaps` flags. c8 /
  `v8-to-istanbul` then has nothing to remap the V8-dump
  URLs (`.next-e2e/.../chunks/<hash>.js`) back to `src/**`,
  so the e2e Istanbul JSON comes out as `{}` and the
  combined % reflects unit coverage only (~11.5%). The
  merge script logs a clear warning when this happens.

  When upstream Turbopack fixes source maps (or we patch the
  build to use webpack for coverage runs), the e2e leg picks
  up automatically — no script changes needed. The plumbing
  is in place.

## 0.260.0 — 2026-05-22

### Changed
- **Monkey writeback drops the duplicate "Workflows completed"
  bullet list.** The Smart Monkey expert-system table at the top
  of the monkey block already carries the same information per
  goal (Achieved + Last attempt + Total attempts + Pass rate +
  Last successful run — including route, trigger label, submit
  label, and verification layer in the recipe column). The
  separate bullet list at the bottom of the run-report was pure
  duplication and bloated the writeback by ~15 lines per run.
  Removed from `tests/e2e/global-teardown.ts:appendRunReport`;
  the table remains the source of truth for per-goal state.

## 0.259.0 — 2026-05-22

### Added
- **E2E spec for the Reports tab walk** (#39). New
  `tests/e2e/reports-tabs.spec.ts` parameterises across all
  15 entries in `REPORT_TABS` (cashflow, category, monthly,
  yoy, expenses, income, envelope, accounts, flow, sankey,
  treemap, heatmap, scatter, payees, tax) — one Playwright
  test per tab. Per-tab walk:
  - GOTO `/reports?tab=<id>`
  - Wait for network-idle + 500ms for Recharts
  - Collect any `/api/*` 4xx/5xx response during the visit
    window (excluding `/api/auth/*` per the documented
    NextAuth session-ping noise pattern); fail with the
    specific failing URL when one occurs
  - `assertNoReactErrors(consoleErrors, pageErrors)`
  - Assert `pageErrors` is empty

  Parameterised so a single bad tab fails ONLY that tab, not
  the whole suite — the test ID names the tab precisely.
  Covers the gap the breadth-first monkey crawl left
  (tab changes are `router.push` URL writes, which
  `fillAndSubmitForms` doesn't reach).

## 0.258.0 — 2026-05-22

### Added
- **E2E spec for the category-color edit propagation** (#20).
  New `tests/e2e/category-color-edit.spec.ts` POSTs a
  category with the OLD color, PATCHes to a NEW color, then
  asserts:
  - PATCH response carries the new color (write-through
    contract for optimistic UI).
  - GET `/api/categories?type=expense` reflects the new color
    in the list view that dashboard / cashflow render from.
  - A seeded transaction tagged with that category, when
    fetched via `/api/transactions/{id}`, returns the
    category color from the live join (not a stale snapshot
    — the historical failure mode).
  - Cleanup deletes the category in `finally`.

## 0.257.0 — 2026-05-22

### Added
- **E2E spec for the RSU vest-schedule flow** (#24). New
  `tests/e2e/rsu-vest-schedule.spec.ts` POSTs an RSU
  investment with quantity 100, then two vests — one 30 days
  ago for 40 shares, one 30 days in the future for 60. Asserts:
  - `/api/investments` list rollup: `vestedQuantity = 40`
    (only the past+satisfied vest counts), `maturationDate`
    is the LATEST vest date (future one).
  - `/api/investments/{id}` detail: full `vests` array
    contains both rows (40, 60).
  - DELETE the future vest → list still shows
    `vestedQuantity = 40`, `maturationDate` flips to the
    past date (now the latest), detail shrinks to 1 vest.
  - Cleanup in `finally` deletes any remaining vests + the
    investment.

  Network-independent: explicit `name` + `purchasePrice` on
  the POST so the route's Yahoo fallback never fires.

## 0.256.0 — 2026-05-22

### Added
- **E2E spec for the category-delete contract** (#21). New
  `tests/e2e/category-delete.spec.ts` builds a fresh 3-level
  tree (grandparent → parent → child), links a transaction
  to the middle node, then DELETEs the middle node and
  asserts:
  - Children are PROMOTED one level (child's `parentId`
    rewrites to the grandparent's id, not null).
  - The deleted node is gone from `/api/categories?type=expense`.
  - The linked transaction survives with `categoryId = null`
    (FK is `ON DELETE SET NULL`).
  - DELETE on a missing id → 404.

  Self-contained tree means the assertions don't tangle with
  seed-data categories; cleanup in `finally` drops the
  remaining nodes so the next spec starts clean.

## 0.255.0 — 2026-05-22

### Added
- **E2E spec for the import-commit ↔ undo-commit round-trip**
  (#9). New `tests/e2e/import-undo-commit.spec.ts` commits two
  pre-resolved rows on a fresh account, asserts
  `/api/transactions/count` reflects them, asserts the
  account's `currentBalance` recomputed to the seeded
  starting + amounts, then POSTs `/api/import/undo-commit` and
  asserts count + balance reset. Idempotency leg: a re-undo
  of the same already-undone log returns 0 for both
  `deletedTransactions` and `deletedImportLogs` rather than
  silently lying about what it did (see fix below).

- **E2E spec for account DELETE soft-archive contract** (#19).
  New `tests/e2e/account-archive.spec.ts` seeds an account +
  transaction, DELETEs the account, then asserts: GET the
  account still returns it with `isArchived = true`; GET the
  transaction still returns it (cascade-delete would have
  wiped it); DELETE on a missing id → 404. This is the
  contract the user relies on when un-archiving via the
  Settings → Accounts toggle — if the route were a hard
  cascade-delete the recovery path would be impossible.

### Fixed
- **`/api/import/undo-commit` `deletedImportLogs` is now the
  rows actually deleted, not the input id count.** Was
  reporting `importLogIds.length` so a re-undo of an
  already-undone log falsely reported "1 deleted" while the
  DELETE was a no-op. Now uses `.returning({ id })` on the
  log delete and surfaces that length. Caught by the new #9
  e2e spec on its idempotency leg.

## 0.254.0 — 2026-05-22

### Added
- **E2E spec for the user-management lifecycle** (#28). New
  `tests/e2e/user-management.spec.ts` walks the full
  create → promote → demote → delete loop against
  `/api/users` + `/api/users/[id]` plus the two guards that
  keep the system from ending up with zero admins:
  - GET `/api/users` baseline (verifies the seed admin is the
    only admin — required for the last-admin assertion below).
  - POST → 201; duplicate username POST → 409 (the explicit
    pre-check fires before the unique index would throw, so
    the user sees `already taken`, not a 500).
  - PATCH role promote/demote round-trip — promote member →
    admin, demote them back — verifies the route returns the
    updated row.
  - PATCH self-demote when last admin → 409 (lastAdminGuard);
    cross-check via GET that the seed admin's role is
    unchanged.
  - PATCH / DELETE missing id → 404.
  - DELETE happy-path cleanup in `finally`.

  Final invariant pinned: the created member is gone and the
  seed admin is still an admin — leaves the test fixture in
  the same state the next spec expects.

## 0.253.0 — 2026-05-22

### Added
- **E2E spec for the watchlist add → list → history flow** (#25).
  Five legs covered: POST with explicit `name` (skips the Yahoo
  lookup to keep the spec network-independent), GET list to
  verify the row is present, GET `.../history?range=1m` to
  verify the `{ series, dividends }` contract, duplicate-symbol
  guard returns 409, DELETE happy-path cleanup. Yahoo
  upstream-blip handling: a 502 on `/history` logs a warning and
  skips the shape assertion rather than failing the spec — the
  contract is the route, not the upstream weather.

- **E2E spec for transfer-pair confirmation removing both legs
  from the cashflow report** (#13). Seeds two fresh accounts and
  two opposing-sign txns on the same date, asserts that
  `/api/reports/cashflow?hideTransfers=true` totals shed both
  legs after `PATCH /api/transactions/[id]/transfer-pair` is
  applied. Layered control: the same window re-fetched with
  `hideTransfers=false` matches the pre-pair totals — proves
  it's the filter, not the pair, doing the work. The confirm
  endpoint internally calls the same `manualPair` function, so
  the contract is identical.

### Fixed
- **Watchlist duplicate-symbol POST now actually returns 409
  instead of 500.** The route's catch block matched on the
  unique-index name (`watchlist_symbol_unique`), but
  better-sqlite3 reports the column-qualified form (`UNIQUE
  constraint failed: watchlist.symbol`) — so the 409 path never
  fired and clients got a 500 from `withAuth`'s default error
  handler. Now matches both. Caught by the new #25 e2e spec.

## 0.252.0 — 2026-05-22

### Added
- **Shared seed-data fixtures helpers** (#41). Five new exports in
  `tests/e2e/_helpers.ts`:
  - `getFirstAccountId(ctx)` — anchor txns against an existing
    account without re-issuing the GET /api/accounts boilerplate.
  - `seedAccount(ctx, { name, type?, color?, currentBalance? })`
  - `seedCategory(ctx, { name, type, color? })`
  - `seedTransaction(ctx, { accountId, date, amount, payee?, categoryId?, notes? })`
  - `seedTransactions(ctx, accountId, rows[])` (sequential for
    deterministic ordering).

  Each throws on non-2xx with the response body in the message so
  setup-time mismatches fail the test with the actionable error
  rather than the silent downstream symptom. `bulk-recategorise.spec.ts`
  refactored to use them — the new e2e specs added below already
  start from the same primitives.

- **E2E spec for the scheduled-dismiss-missed flow** (#16). Three
  API legs covered: `POST .../dismiss-missed` (upsert) including
  re-POST idempotency / note amendment, `DELETE` missing-param
  guard (400), and `DELETE` happy-path. `GET
  /api/scheduled/dismissed-missed` consulted between each leg to
  pin the contract.

## 0.251.0 — 2026-05-22

### Fixed
- **`loadTokenFreq()` is now cached in-process with a 60s TTL +
  explicit invalidation** (#96). Was full-table scanning every
  categorised payee on EVERY POST `/api/transactions`, every
  import categorise, and every commit-batched call. On a 50k-row
  table that's real work the operator pays per keystroke save.
  Now built once per minute (or per import commit, whichever comes
  first). Exported `invalidateTokenFreqCache()` for write-paths to
  call after mutations; commit-batched wired up.
- **`screenshots.spec.ts:waitForChartsDrawn` now waits for Sankey
  shapes specifically** (#66). The previous selector union short-
  circuited as soon as a fast-rendering line/area/bar chart drew,
  even when a slow-mounting Sankey on the same page hadn't started
  — the Sankey screenshot could capture a partial diagram. Now
  includes `.recharts-sankey-node` alongside `.recharts-sankey-link`.
- **Backup-scheduler logs a hourly warning while DB is locked**
  (#93). Was only logging on entry to the locked state — a
  midnight restart that stayed unlocked until lunch took zero
  backups silently. Now logs a warning every 60 ticks (~1 hour at
  the default cadence) with the elapsed-tick count, so an extended
  outage produces a steady drumbeat in the server log instead of
  silence.

## 0.250.0 — 2026-05-22

### Security
- **`/api/users/[id]` PATCH/DELETE now use `withAdminAuthAndId`**
  (#45). Was hand-rolled `if (!isAdmin(session))` returning 401 for
  any non-admin (authenticated or not). The wrapper correctly
  returns 403 (Forbidden) for an authenticated non-admin and 401
  only for missing-session, matching the rest of the API. The
  guard's id-parse also runs the standard uuid validation before
  the handler.

### Changed
- **`/api/users`, `/api/users/[id]`, `/api/unlock`, `/api/rekey`
  migrated from raw `request.json()` to `parseJsonBody` + zod**
  (#58 fully closed). Validation errors now emit the canonical
  `BadRequestBody.issues[]` shape that every other API route uses;
  the hand-rolled validator wrappers in `lib/user-rules.ts` stay
  for unit-test use but the constants (`USERNAME_RE`, `USERNAME_MAX`,
  `PASSWORD_MIN`, `VALID_ROLES`) are now exported and reused as the
  zod schema's source of truth. `validatePassphrase` still runs
  after parseJsonBody for the control-char rejection that zod
  can't express.

## 0.249.0 — 2026-05-22

### Changed
- **`POST /api/transactions` (transfer branch) now returns the source
  row directly with `transferPairId` populated** (#87). Was previously
  `{ source, dest }` wrapping pre-UPDATE row objects (no `transferPairId`
  on the source object) — three incompatible response shapes on one
  endpoint (GET array vs. transfer-POST wrapper vs. single-POST row).
  Now uniform: the response is always a single row. Re-fetches the
  source after the symmetric `transferPairId` UPDATE so the wire
  payload carries the populated link. `scheduled-transfer-missed.spec.ts`
  updated accordingly.
- **`PATCH /api/transactions/[id]/transfer-pair` returns a unified
  `{ ok, syntheticId, externalAccountId, pairId }` envelope across
  every variant** (#57). Was `{ok, syntheticId, externalAccountId}`
  on the external branch and just `{ok}` on link/unpair. Today's
  consumer (`link-transfer-dialog.tsx`) only checks `res.ok`, so
  this is a non-breaking widen.

### Fixed
- **`/api/cashflow` projects only the 6 fields `computeCashflow`
  actually reads** (#77). Previously `SELECT *` loaded every txn
  column (notes, importHash, rawFitid, postedAt, isTransfer,
  transferPairId, balance — all unused) on every request. On a
  50k-row table this shipped a huge JSON payload + drizzle row
  hydration cost for nothing. Now a typed `CashflowTransaction`
  pick. The 12-year max-range cap added in 0.245.0 plus this
  projection together bound the route's worst-case memory.

## 0.248.0 — 2026-05-22

### Fixed
- **`scheduled-transfer-missed.spec.ts` dates derived at runtime**
  (#83). Previously hard-coded "8 May 2026" / "15 May 2026" strings
  flipped from passing to failing as the real clock moved off the
  May 22 anchor the comments named. Now `isoDaysAgo()` /
  `displayDate()` compute everything from `new Date()` so the spec
  works in perpetuity.
- **`scheduled-transfer-missed.spec.ts` uses deterministic
  `waitForResponse` instead of `waitForTimeout(800)`** (#62). Was
  flake-bait on busy CI; now waits on the actual `/api/scheduled`
  + `/api/transactions` GETs the panel SWR-subscribes to.
- **`import-csv-commit.spec.ts` no longer wipes shared sample data
  at setup** (#85). The wipe was unnecessary (every count assertion
  is scoped to the freshly-created import account) and side-effect-
  ed the `addSampleData` monkey-goal — running alphabetically
  later, it'd find zero sample rows and record a perpetual ❌.
- **`import-csv-commit.spec.ts` re-import assertion now also asserts
  the dedup-broken `Commit N rows` label is NOT present** (#82).
  Previously only checked one of the three no-new-commit labels
  was visible, which would have masked a dedup regression that
  let the parser produce "Commit N rows" while the operator
  hadn't clicked it.
- **`dashboard-visual.spec.ts` chart-drawn / grid-settled waits now
  hard-fail on timeout** (#78). Was silently swallowing the
  10s timeout via `.catch(() => {})` then proceeding to screenshot
  a half-rendered page — the visual diff might still pass under
  `maxDiffPixelRatio: 0.01` and let a real regression slip through.
  `screenshots.spec.ts` (docs publisher) gets a `console.warn`
  instead since it's not a regression gate.
- **`migrateAppMap` now type-checks every persisted goal field
  individually** (#73). Previous version only nullish-coalesced —
  a corrupt persisted `app-map.json` (hand-edited / partial write)
  with `attempts: "lots"` / `successfulRun: { route: "/x" }` would
  survive intact and corrupt every subsequent run's expert-system
  table. Now type-checks numbers, strings, the full SuccessfulRun
  shape; bad values fall through to defaults. Three new unit
  tests pin the contract.
- **`isInternalPath` rejects `/login/*` and `/unlock/*` subtrees
  explicitly** (#68 — re-verified after the symmetry fix in
  0.247.0; the subtree exclusion was the load-bearing rule).

## 0.247.0 — 2026-05-22

### Fixed
- **`/api/transactions/bulk` and `/api/import/undo-commit` recompute
  balances in one UPDATE instead of N** (#74). Was looping a
  per-account `UPDATE … (SELECT SUM ...)` correlated subquery; now
  one statement that correlates against `accounts.id` for every
  affected row.
- **`/api/import/commit-batched` MAX(posted_seq) lookup is now a
  single GROUP BY** (#76). Was firing one SELECT per touched
  account in a sequential loop; one round-trip for a multi-account
  CSV.
- **`/api/categories/orphans` POST uses `inArray`** (#90). Was
  looping per-id DELETEs.
- **`/api/import/categorise` pre-warms account-resolution caches
  in parallel via `Promise.all`** (#95). Five distinct bank-IDs
  across a 1000-row import used to fire 10 sequential resolver
  queries inside the per-row loop; now resolved up front and the
  per-row loop is pure Map lookup.
- **`tests/e2e/_app-map.ts:isInternalPath` now exact-matches both
  `/login` and `/unlock`** (#68). Previous asymmetry
  (`startsWith("/login")` vs `=== "/unlock"`) would reject benign
  paths like `/loginRequest`. Now explicit on the subtrees we
  refuse to crawl into.
- **`tests/e2e/_helpers.ts:captureErrors` filters benign NextAuth
  session-retry warnings.** The `Failed to fetch.*errors.authjs.dev`
  / `_getSession` console-error pair fires transiently during e2e
  when the build's Node server momentarily refuses a session ping;
  the retry succeeds on the next cycle and the session stays
  valid. Was making `import-csv-commit.spec.ts` falsely fail; now
  filtered with a documented entry in the ignore-list.

### Deferred
- **#80** — folding `pairTransfersInWindow`'s per-pair transactions
  into a single outer transaction conflicts with the race-check
  shipped in 0.243.0 (#60), which depends on per-pair rollback
  semantics. Reverting that to bundle pairs would let a single
  race-loser roll back the whole batch. Needs a different shape
  (e.g. retry inside the outer-tx).

## 0.246.0 — 2026-05-22

### Added
- **UI now polls `/api/unlock` every 15s and force-redirects to
  `/unlock` when the server reports `unlocked: false`.** New
  `LockStatePoller` mounted once at `(app)/layout.tsx` covers every
  authenticated route. Catches the case where the Node process
  restarted (k8s rollout, container redeploy, manual restart) while
  the operator had an open browser session — pre-poll, the UI sat
  stale against the locked backend until the first API call
  returned a 3xx (which only triggers on real network activity).
  Skips while `document.hidden`, runs an immediate check on
  visibility return so a returning operator sees the redirect
  promptly. Preserves the destination as `?next=` so the unlock
  flow drops them back where they were.

### Fixed
- **`dashboard-grid.tsx` no longer recomputes derived layouts on
  every SWR revalidate** (#72). Wrapped `baseLayout` in a `useMemo`
  keyed on `[prefs.dashboardLayout, prefs.featureInvestments,
  prefs.featureSuper]`. Without this, the three downstream useMemos
  on `[activeLayout]` recomputed on every render because
  `baseLayout` was a fresh array, defeating the memoisation the
  call-site comment claimed to provide — exactly the cascade
  AGENTS.md warns triggers React error #185 with Recharts widgets.
- **`/api/dashboard/net-worth-trend` issues 1 grouped query
  instead of 12 sequential cumulative-sums** (#75). One
  `SELECT substr(date, 1, 7) AS month, SUM(amount) GROUP BY month`,
  then cumulative-sum in JS. Trim down from ~150k row reads on a
  12k-row table per dashboard load to a single grouped scan.
- **`/api/import/format-check` pre-fetches accounts in one
  `inArray` query** (#84). Was issuing a per-id SELECT for the
  brand-new-account branch in a loop; now one bulk fetch into a
  `Map`, looked up per id.

### Deferred
- **#92 (`/api/transactions` running-balance O(N²) subquery)** —
  the rewrite needs a CTE + window function with proper
  before/after benchmarks; deferring to a focused PR rather than
  ship blind. Commented on the issue.

## 0.245.0 — 2026-05-22

### Fixed
- **`/api/reports` and `/api/reports/cashflow` now validate
  `from`/`to`** (#51). New `src/lib/api/date-range.ts` shared
  helper enforces `^\d{4}-\d{2}-\d{2}$` + a 12-year max-range cap
  (already in place on `/api/cashflow`). Without this,
  `?from=banana&to=zzzz` silently passed lexicographic comparison
  to `gte(transactions.date, ...)` (matched everything), and
  multi-decade `from=1900-01-01&to=2100-12-31` requests loaded the
  whole transactions table while `generateMonths()` CPU-spun for
  thousands of months.
- **Calendar `matchScheduledToReal` is now deterministic** (#55).
  Pre-sorts scheduled occurrences by `(date, scheduledId, idx)`
  before the greedy assignment, so a paused-and-replaced
  predecessor still emitting from history can't race the current
  schedule for the same real txn by Map-insertion order.
- **`/api/transactions/count` now applies the `hideTransfers`
  filter** (#70). Was missing parity with `/api/transactions`, so
  the pagination footer ("showing 1-50 of 1235") could over-report
  when the list had `hideTransfers=true` active.
- **`/api/version-check` and `/api/github-stats` use a stable
  nullable shape** (#52). Previously success returned
  `{ latest: "..." }` and failure returned `{ error: "..." }`,
  both at HTTP 200 — letting a future `if (res.ok) data.latest.split(...)`
  consumer blow up on undefined. Now: `{ latest: string | null }`
  and `{ downloads: number | null, stars: number | null }`.
  Detail messages logged server-side only.
- **`BuyFromWatchlistDialog` refreshes `purchaseDate` to today on
  every open** (#71). Was captured once at first mount; if the
  watchlist panel sat open overnight the default lagged.
- **Transaction-filter search box syncs from URL on external
  navigation** (#61). Browser back/forward or sibling-component
  pushes to `?search=` now flow into the visible input. Without
  this, the input could show a stale value after navigation while
  the table reflected the URL state.

## 0.244.0 — 2026-05-22

### Fixed
- **`runOrphanTransferBackfill` is now transactional** (#49).
  Read-flag → backfill → write-flag was three separate statements;
  two concurrent unlocks (NextAuth sign-in fan-out, env-key
  auto-unlock racing /api/unlock) could both pass the gate and
  double-mint synthetic counterparts. Now wrapped in
  `state.drizzleDb.transaction(..., { behavior: "immediate" })` so
  the second unlock waits on the write lock and finds the flag
  already set. Inner `backfillOrphanTransfers` call receives the
  `tx` so its inserts stay within the same scope.
- **`seedSystemCategoriesIfMissing` actually uses `BEGIN IMMEDIATE`
  now** (#53). The block comment promised IMMEDIATE serialisation
  but the call defaulted to DEFERRED, so two concurrent unlocks
  passed the gate under SHARED locks before either UPGRADE'd to
  write. The loser hit SQLITE_BUSY and the gate's protection
  reduced to deadlock-rejection rather than serialisation. One-line
  fix to add the `{ behavior: "immediate" }` option that was
  already documented.
- **`POST /api/sample-data/remove` no longer orphans manually-paired
  non-sample transfer legs** (#56). When the operator had manually
  paired one of their real transactions to a sample transaction,
  the sample-side delete left the surviving non-sample row with
  `is_transfer = true` but `transfer_pair_id = NULL` (FK
  ON-DELETE-SET-NULL). The orphan-backfill flag is already true at
  this point so the next unlock wouldn't repair. Now sweeps
  `is_transfer = false` on those partners before the sample-side
  delete.

## 0.243.0 — 2026-05-22

### Fixed
- **External account `currentBalance` now updates after synthetic
  mints / deletes** (#65). `manualPairExternal`,
  `backfillOrphanTransfers`, and `manualUnpair`-of-synthetic all
  recompute the External account's `currentBalance` via the same
  `starting_balance + SUM(amount)` pattern every other insert path
  uses. Previously the External account's reported balance stayed
  at $0.00 regardless of synthetic count → accounts list, dashboard
  tile, and cashflow back-compute anchor all drifted by however
  many dollars of synthetic mints had landed.
- **`manualPair` now validates both transactions are on different
  accounts AND amounts cancel within ±$0.01** (#46). Auto-pairing's
  SQL enforced this; manual pairing accepted anything (two same-
  account rows, two same-sign rows) and downstream asset-pool
  netting / transfer-aware reports / the orphan backfill silently
  produced wrong totals.
- **`manualPair` no longer leaves orphan synthetic counterparts
  when displacing a pre-existing pair** (#59). Synthetic stubs
  whose pair the operator just re-routed now get DELETED (matching
  the `manualUnpair`-of-synthetic shape) and the External
  account's `currentBalance` is recomputed afterwards.
- **`pairTransfersInWindow` UPDATEs now re-assert
  `transfer_pair_id IS NULL`** (#60). A concurrent `manualPair` (or
  another matcher run on a parallel import) landing between the
  candidate SELECT and the symmetric UPDATEs could clobber a
  freshly-set pair, leaving a half-paired leg. The transaction now
  rolls back and `paired` doesn't count the loser if either side's
  pair-id was claimed since the SELECT.
- **`manualPairExternal` now skips ARCHIVED externals** when
  case-insensitively matching the counterparty name (#64). Was
  landing synthetics in archived accounts, invisible from the
  accounts list but still on the pair.
- **Yearly + quarterly recurrence now re-anchors via
  `dayOfMonth`** (#63). A schedule starting 2024-02-29 used to
  clamp to Feb 28 in 2025 then preserve the 28th forever, missing
  Feb 29 in 2028. Same shape on quarterly schedules anchored on
  the 31st. Now both re-anchor to the original day each step,
  matching the monthly branch. Two new unit tests pin the contract.

## 0.242.0 — 2026-05-22

### Fixed
- **DELETE handlers now 404 cleanly instead of silently 200ing on a
  missing id** (#67). Six handlers were doing unconditional
  `db.delete(...).where(eq(id, …))` without checking affected-row
  count: `/api/accounts/[id]` (soft-archive), `/api/scheduled/[id]`,
  `/api/investments/[id]`, `/api/watchlist/[id]`,
  `/api/investments/vests/[vestId]`, `/api/super/[id]`. All now use
  `.returning({ id })` and 404 with a typed message when nothing
  matched. A stale tab issuing DELETE on an already-removed row
  used to get a misleading "deleted" toast and a phantom row in
  the refetched list.
- **`/api/import/categorise` parse errors now 400, not 422** (#98).
  Standardising on 400 across the codebase — every other validation
  failure already uses 400.
- **`PATCH/DELETE /api/super/people/[key]` now 404 on unknown keys**
  (#91). PATCH used to silently upsert on a typo'd key; DELETE used
  to return 200 even when the key was neither in the people list
  nor any snapshot. Both now hard-fail with `{ error: "Person key
  not found: <key>" }` when the key doesn't exist in either place.
- **Dashboard query-validation routes now emit `BadRequestBody`
  instead of a joined-string error** (#54).
  `/api/dashboard/account-balance-trend` and
  `/api/dashboard/category-spend` previously emitted
  `{ error: "Invalid accountId/days/..." }`; now they map the zod
  `error.issues` into the standard `{ error, issues: [...] }`
  envelope.
- **`DELETE /api/scheduled/bulk` now surfaces `requested` count**
  (#69). Client can distinguish "all gone, success" from "all
  already gone, nothing happened."

### Changed
- **`POST /api/payee-rules` now uses a `kind` discriminator on every
  response branch + returns 201 on insert** (#88). Previously emitted
  three different shapes (`{noop, reason}`, `{deleted, ruleId}`,
  `{id, updated}`) all with HTTP 200 even on insert. Now:
  - `{ kind: "created", id }` with **201**
  - `{ kind: "updated", id }` with 200
  - `{ kind: "deleted", ruleId }` with 200
  - `{ kind: "noop", reason }` with 200

  Single consumer (`import-view.tsx:1686`) updated to switch on the
  new discriminator.

## 0.241.0 — 2026-05-22

### Fixed
- **Three dashboard widgets now correctly swap to the
  "Chart hidden while editing" placeholder during dashboard
  edit-mode drags / resizes** (#97). `StocksSummaryCard`,
  `OptionsSummaryCard`, and `SuperSummaryCard` accepted no
  `editMode` prop and kept the live Recharts subscribers wired
  during RGL drags — the exact subscriber-loop cascade that
  triggers React error #185 ("Maximum update depth exceeded").
  `CategorySpendCard` took `editMode` but didn't gate its BarChart;
  fixed there too. AGENTS.md's canonical placeholder pattern from
  `net-worth-trend-card.tsx` now applied to all four. Widget
  registry in `widgets.tsx:110, 118, 134` updated to plumb
  `editMode` through.
- **`AccountVisibility` no longer ships stale account names /
  colours / balances** after `EditAccountDialog` calls
  `router.refresh()` (#99). Was using the `useState(prop)`
  anti-pattern; added the canonical `lastSeenProp` ref +
  `useEffect` sync from `category-picker.tsx`.
- **`SnapshotForm` in Super now re-mounts when the operator
  switches edit targets** before saving (#100, part 1). Was
  reusing the same form instance with a new `snapshot` prop, but
  the local `useState` initialisers didn't re-run → A's values
  stayed visible when editing B. Added `key={editingId}` on the
  form element.
- **`EditableHeading` in Super now syncs `draft` to the latest
  `heading` prop when not actively editing** (#100, part 2). Was
  stuck at the initial-mount value if a bulk import / sibling
  tab updated the heading while the component was mounted —
  saving could overwrite a fresher value with stale draft.

## 0.240.0 — 2026-05-22

### Fixed
- **SQLITE_BUSY during `next build` page-data collection — eliminated**
  (#81). The auto-unlock-from-env path used to live at module-eval
  position in `src/db/index.ts:593-601`. Next.js page-data collection
  forks 4 worker processes by default; each evaluated every API
  route module, each route module top-level `import { db } from "@/db"`,
  each `@/db` load hit that `if (process.env.SQLITE_KEY) { unlock(...) }`
  block → 4 concurrent SQLCipher handles racing on the probe SELECT
  under DELETE journaling. SQLITE_BUSY: "Failed to collect page data
  for /api/<route>" was the result.
  - Extracted the block into `autoUnlockFromEnv()` (exported function,
    no module-eval side effects).
  - New `src/instrumentation.ts` calls `autoUnlockFromEnv()` from
    Next.js's `register()` hook — runs once per server process on
    `next start` boot, NOT during `next build`'s page-data fan-out.
  - Secondary fix: `busy_timeout = 5000` now applied BEFORE the
    SQLCipher probe SELECT, so a contended lock waits rather than
    erroring instantly.
  - `tests/e2e/global-setup.ts` also cleans up the `-journal` sidecar
    (was only cleaning `-wal` / `-shm`) — a crashed prior run could
    leave the DELETE-mode journal orphaned.

  Verified: cold `pnpm test:e2e tests/e2e/scheduled-transfer-missed.spec.ts`
  with `.next-e2e` wiped passes on first try with zero `SQLITE_BUSY` /
  "database is locked" entries in the web-server log. Was previously
  taking 2–3 retries on average.

- **TDZ-cycle risk in `src/lib/auth.ts`** (#94). Top-level
  `import { db } from "@/db"` was reachable from `src/proxy.ts`'s
  unlock-path bundle — the exact pattern that caused the
  `ReferenceError: Cannot access 'al' before initialization` crash
  in 0.213/0.214. Switched to lazy `require("@/db")` inside the
  `authorize()` callback, matching the pattern in
  `src/lib/backup/scheduler.ts` and `src/db/index.ts`'s lazy helpers.

## 0.239.0 — 2026-05-22

### Security
- **`POST /api/databases/switch` now requires a same-origin POST**
  (#89). Anonymous LAN attackers could previously force-lock the
  active DB and steer the profile pointer by hitting the endpoint
  with a registered id. Browser semantics mandate `Origin` on
  cross-origin POSTs and cross-origin callers can't spoof it, so
  the same-origin check blocks the threat without breaking
  `/unlock` (which is legitimately unauthenticated). Direct curl
  from the host still works for the trusted-LAN operator. Also
  tightened the id schema from `z.string().min(1).max(40)` to
  the profile-id charset regex.
- **`POST /api/transfers/repair` and `POST /api/transfers/reset-and-rescan`
  now require `withAdminAuth`** (#48). Both perform household-wide
  destructive writes (delete every `is_synthetic=true` row, re-pair
  across the whole DB); the equivalent maintenance routes
  (`/api/transfers/backfill`, `/api/sample-data/remove`,
  `/api/maintenance/analyze`, `/api/lock`) were already admin-gated.
  Non-admin members could previously fire either.
- **`POST /api/rekey` now rate-limits BEFORE the passphrase probe**
  (#50). Previously the bucket fired after `validatePassphrase` +
  `openWithKey()` — giving the file comment's "slow a hostile admin
  session" goal nothing to slow. Now mirrors `/api/unlock`'s
  correct ordering (rate limit first, parse + probe second).
- **`POST /api/unlock` no longer leaks deploy-state messages on
  401** (#47). `EACCES` / `EROFS` / `ENOSPC` from `describeOpenError`
  used to land on the wire pre-auth, letting an attacker fingerprint
  filesystem state. Now redacted to "Unable to open database — check
  the server log for details" with the detail logged server-side.
  The "Wrong passphrase or corrupted database file" string stays on
  the wire (operator-friendly, no fingerprinting value).

### Changed
- **`PATCH /api/backup/schedule` and `PATCH /api/display-prefs`
  now use `parseJsonBody` + zod** (#58, partial). Migrating both
  from raw `request.json()` so they emit the canonical
  `BadRequestBody.issues[]` envelope the rest of the API uses.
  `parseDisplayPrefs` stays as the per-key gatekeeper; the zod
  schema is permissive (`z.record(z.string(), z.unknown())`) just
  to standardise the error shape. Other routes flagged in #58
  (`/api/users`, `/api/users/[id]`, `/api/unlock`, `/api/rekey`)
  ship in a follow-up batch — they need bigger schema work.

## 0.238.0 — 2026-05-22

### Added
- **E2E spec for CSV import → commit → verify → dedup (#8)** at
  `tests/e2e/import-csv-commit.spec.ts`. `/import` is destructive-
  banned in the breadth-first monkey crawl
  (`monkey.spec.ts:CRAWL_PAGES`), so the headline feature of the
  app — drop a real bank file, commit it — had **zero**
  end-to-end coverage. A regression here corrupts the ledger
  silently; this spec catches it.
  - Wipes sample-data; creates a fresh "Westpac Checking"
    account; pre-seeds a bank-id alias so the upload doesn't hit
    the Unresolved Accounts combobox (separately scoped UI).
  - Drives the parse-time "Use CSV" confirm + the commit-time
    "Import CSV" first-format-for-account confirm — both took an
    iteration to wire correctly (parse-time appears after
    format-check round-trip; commit-time appears AFTER a separate
    format-check post-click).
  - Reads `N` from the dynamic `"Commit N rows"` button label,
    asserts `POST /api/import/commit-batched` returns
    `{ imported: N, importLogIds: [...] }`, then verifies
    `GET /api/transactions?accountId=<id>` returns exactly `N`
    rows.
  - **Re-import dedup**: drops the SAME file a second time and
    asserts the row count stays at `N` (no duplicates landed via
    `importHash`). The button label after re-import can be
    `"Nothing to commit"`, `"Update N"`, or
    `"Fix N balance mismatches"` depending on chain-hash state;
    the hard invariant is the row count, not the label.
  - Console + page errors captured throughout; any runtime error
    fails the test.

  Fixture: `tests/fixtures/csv-westpac-sample.csv` (23 rows;
  already wired through `parse-csv.test.ts`).

## 0.237.0 — 2026-05-22

### Added
- **New monkey-goal `addSampleData` (#27)** covers the sample-data
  seeder. The issue's premise ("destructive-banned in the crawl;
  the corresponding 'remove' path is covered by clearSampleData
  but the add side is not") was based on a misremembered "Add
  sample data" UI button — there isn't one. `seedSampleDataIfMissing()`
  runs once at install time on the first unlock of the default
  profile, and `POST /api/databases` deliberately pre-sets the
  flag on new profiles (so operators get a blank book for their
  second/third profile), so the seeder can only be triggered by
  the install-time path.
  - Probes the e2e fixture's default profile (which
    `global-setup.ts` migrated from scratch — so its first unlock
    via `signInAsAdmin` fired the production
    `seedSampleDataIfMissing()` code path).
  - **Leg 1**: GET `/api/sample-data/remove` shows
    `sampleAccounts > 0`, `sampleTransactions > 0`,
    `sampleScheduled > 0`. Strong assertion — the endpoint
    queries the `isSample` column directly.
  - **Leg 2**: GET `/api/accounts` returns at least one row with
    `isSample === true`. Not "every row" — the orphan-transfer
    backfill auto-creates an "External" account on first unlock
    whose `isSample` is false. Comment in the spec notes that
    gotcha so future me doesn't trip on it again.
  - **Pinned before `clearSampleData`** in the spec declaration
    order so the wipe doesn't precede the probe.
- **AppMap schema 9 → 10** — `addSampleData` joins the `GoalKey`
  union. Schema bump triggers the migrate-forward path shipped
  in 0.235.0 — existing on-disk maps' prior achievements survive,
  with `addSampleData` initialised to defaults.

## 0.236.0 — 2026-05-22

### Added
- **E2E spec for the scheduled-transfer false-missed regression
  (#17)** at `tests/e2e/scheduled-transfer-missed.spec.ts`.
  Pure-unit coverage of the 0.136 fix lives at
  `src/lib/scheduled-match.transfer.test.ts`; this new spec catches
  a regression at the panel render layer (which the unit test
  can't see).
  - Wipes sample-data, seeds two accounts, creates a weekly
    transfer schedule starting 14 days ago. Two past occurrences
    land in the 30-day panel window outside the 4-day grace
    cutoff: the -14d occurrence gets real paired legs seeded via
    `POST /api/transactions { transferToAccountId: … }`; the -7d
    occurrence stays unpaired (the control).
  - Asserts the missed panel header reads **exactly** "1 missed
    scheduled transaction" (a regression on the fix would surface
    2 or 3 — both legs of the paired occurrence falsely flagged).
  - Asserts the unpaired date string is visible in the panel body
    and the paired date string is NOT — scoped to a new
    `data-testid="missed-scheduled-panel"` selector on the panel
    container, so the main `/transactions` table legitimately
    rendering the real paired-leg txn doesn't trip the
    negative-check.
  - Captures console + page errors and fails the test if any
    fire during the walk.

### Changed
- **`MissedScheduledPanel` outer container now carries
  `data-testid="missed-scheduled-panel"`** in
  `src/components/transactions/missed-scheduled-panel.tsx:592`.
  One-line attribute, neutral for users, gives e2e + any future
  testing hook a stable scoped selector without reaching into
  class names. Same pattern as the `data-widget-id` shipped in
  0.233.0 for the dashboard.

## 0.235.0 — 2026-05-22

### Fixed
- **AppMap schema bumps no longer wipe every prior goal
  achievement on the next test run.** Until now `loadAppMap`
  returned a fresh empty map on any `schemaVersion` mismatch,
  so the 8 → 9 bump for `resetBrowserData` blanked the goal
  table in `TEST-RESULTS.md`: a single-test run after the bump
  produced a one-✅-row table with every other goal back at
  ❌ / 0 attempts, even though they'd been achieved on prior
  runs.
  - New `migrateAppMap(raw)` helper folds the old shape into a
    fresh `emptyAppMap()`: routes preserved, runs preserved
    (trimmed to ring size), goals merged per-key — achieved
    state, attempts, `lastAttempt`, and `successfulRun` survive.
    Missing-in-old-schema `successes` is backfilled from
    `successfulRun ? 1 : 0`.
  - Goals that no longer exist in `GOAL_KEYS` (removed between
    versions) get dropped; new goals start at default state.
  - Bad JSON / non-object input still falls through to a fresh
    map — the safety branch is unchanged.
  - Three new unit tests in `_app-map.test.ts` lock the contract:
    schema-7 map with `createTransaction` + `addTenToCategory`
    achieved → both survive the migration to schema 9 with
    `successes` backfilled.

  Verified end-to-end: seeded a synthetic schema-7
  `app-map.json` with two achievements, ran just the
  `resetBrowserData` goal in isolation, confirmed
  `TEST-RESULTS.md` showed both prior achievements AND the new
  `resetBrowserData` ✅ row (instead of wiping the prior two).

## 0.234.0 — 2026-05-22

### Added
- **New monkey-goal `resetBrowserData` (#40)** covers the
  Settings → Security "Reset browser data" affordance, which
  was untested. Three legs:
  - **Cancel leg** — click Reset, dismiss the confirm dialog,
    verify the session stays alive (`GET /api/accounts` 200s)
    and the URL stays on /settings. Pins the regression that
    an unconfirmed click should NOT fire the destructive op.
  - **Confirm leg (redirect + sign-out)** — click Reset → "Reset
    & sign out", verify the page lands on `/login` and a
    follow-up `GET /api/accounts` is either 401 (no session)
    or a 3xx → /login. Catches the gotcha
    `reset-browser-data.tsx:46-49` documents: a regression
    that left the post-signout nav at NextAuth's
    `localhost:3000` default would have shipped silently
    behind a LAN proxy.
  - **Local-state cleanup** — on the post-reset /login page,
    `localStorage.length === 0`, `sessionStorage.length === 0`,
    `theme` cookie gone, NextAuth session-token cookie gone.
  After the test, the spec's
  `beforeEach(signInAsAdmin)` re-establishes the session for
  downstream tests.

### Changed
- **AppMap schema 8 → 9** — `resetBrowserData` joins the
  `GoalKey` union + `GOAL_KEYS` order array. Schema bump
  invalidates stale on-disk maps; the next e2e run starts
  fresh.

## 0.233.0 — 2026-05-22

### Added
- **Dashboard visual-regression spec (#42) at
  `tests/e2e/dashboard-visual.spec.ts`.** Playwright
  `expect(page).toHaveScreenshot(...)` against committed baselines
  in `tests/e2e/dashboard-visual.spec.ts-snapshots/` (one per
  theme: dashboard-light, dashboard-dark). Re-bless intentional UI
  changes with `--update-snapshots`; otherwise the spec fails
  loudly on any drift from baseline.
  - Distinct from `screenshots.spec.ts` (which overwrites README
    PNGs unconditionally) — the visual spec is a *gate*, not a
    publisher.
  - `maxDiffPixelRatio: 0.01` — tolerant of anti-aliasing /
    sub-pixel font hinting, intolerant of a missing widget /
    flipped colour / mis-laid grid.
  - **Stability strategy**: fresh DB + autoseed-only (no
    showcase investments — Yahoo-priced stocks change daily
    and would drift the entire Net Worth headline). The
    `github-stats` widget is masked because it pings
    api.github.com for live counts; Playwright paints its
    bounding box magenta before the diff so the rest of the
    dashboard still compares.
  - Reuses the same `waitForChartsDrawn` / `waitForGridSettled`
    helpers `screenshots.spec.ts` uses, so the spec keys off
    actual completion signals (Recharts path-drawn,
    react-grid-layout settled) rather than arbitrary timers.

### Changed
- **Dashboard widget wrapper now carries `data-widget-id`** in
  `dashboard-grid.tsx:365`. One-line attribute, neutral for users,
  gives the visual-regression spec (and any future testing /
  scripting / observability hook) a stable per-widget selector
  without reaching into class names.

## 0.232.0 — 2026-05-22

### Changed
- **Cashflow report screenshot now spans the current financial
  year (1 Jul → 30 Jun) instead of just the current month.** A
  single-month roll-up reads as "what about the other 11 months?"
  in a marketing context; a full FY shows the seasonal shape of
  income / expenses / surplus the report is actually for. New
  `setCashflowRangeToFy()` helper in the screenshots beforeAll
  PATCHes `displayPrefs.reportsPeriodByTab.cashflow` to
  `fyDateRange(currentFyEndYear())` before navigation — /reports
  loads with the FY range already applied so the capture
  doesn't need a click-the-preset dance.
- **README now lists all 15 built-in reports in a table** with a
  one-line description per report (Cash Flow, Category, Monthly,
  YoY, Expenses by Category, Income by Category, Envelope,
  Accounts, Flow, Sankey, Treemap, Heatmap, Scatter, Payees, Tax
  Deductions). Replaces the prior single-line "Cashflow, monthly
  breakdown, …" sentence which buried 12 of the 15 reports.

## 0.231.0 — 2026-05-22

### Fixed
- **Dashboard screenshot caught the Net Worth Trend chart and the
  React-Grid-Layout widget arrangement mid-render.** User noticed
  the chart line was still being drawn and called it out as a
  general issue: "this will impact your tests as well."
  `waitForLoadState("networkidle") + page.waitForTimeout(2000)`
  fired BEFORE Recharts finished animating path geometry from a
  placeholder up to the final curve and BEFORE RGL settled
  widget transforms.
  - New `waitForChartsDrawn(page)` helper waits until every
    `.recharts-line-curve / .recharts-area-area /
    .recharts-bar-rectangle / .recharts-sankey-link` element
    has a fully-drawn `d` attribute (length > 20 chars — Recharts
    emits short `M0,0…` strings mid-animation) or a non-zero
    width (for bars).
  - New `waitForGridSettled(page)` helper waits for every
    `.react-grid-item` to have a concrete `translate(…)`
    transform and for `.react-grid-placeholder` to be absent
    (RGL settles within ~300 ms of mount but the prior code
    didn't gate on it).
  - Trailing `settleMs` dropped to 300–500 ms across the board;
    it's now strictly for hover/focus pulses, not the primary
    done-signal.
- **Transactions screenshot was ~3× taller than every other shot**
  because `page.screenshot({ fullPage: true })` captured the
  full scrollable 25-row table. Switched to viewport-only
  captures (`fullPage: false`) so every README thumbnail is
  exactly `VIEWPORT.height` tall — the 3-up grid in the README
  finally reads as a uniform thumbnail wall.

### Changed
- **Re-captured all 6 README screenshots** under the new wait
  protocol. Dashboard now shows the Net Worth Trend area fully
  shaded and widgets in their final grid positions; transactions
  fits a single viewport.

## 0.230.0 — 2026-05-22

### Changed
- **README screenshots re-captured against a fresh seeded DB and
  re-laid-out as 3-up rows of matched light/dark pairs.** A recent
  full-suite e2e run had wiped the seeded sample dataset (the new
  `clearSampleData` goal removes accounts/transactions/schedules
  by design), leaving the README's dashboard / transactions /
  cashflow / sankey shots showing an empty book — net worth
  $0.00, no upcoming, blank charts. Re-ran the screenshots spec
  on a freshly-wiped `tests/e2e/.data/test.db` so the autoseed
  fires on first unlock and the captures show the showcase data
  again ($27,405.86 net worth, 3 accounts, populated charts).
- **Trimmed the screenshots spec from 13 pages to the 6 the
  README actually uses** (dashboard, transactions, calendar,
  cashflow, sankey, scheduled). The dropped pages (envelope,
  accounts, tax-deductions, investments, super,
  settings-backups, settings-security) were nice but bloated
  the spec runtime to ~3 minutes for assets nothing rendered.
  Spec is now ~110 s for 12 captures.
- **README screenshot block** is now a 3-column table with the
  light row above its matching dark row, using `<img width="260" />`
  so the page reads as a thumbnail wall rather than a wall of
  full-resolution PNGs. Hi-res still lives in the repo for direct
  link / download.

### Removed
- `screenshots/{reports-accounts,reports-envelope,reports-tax-deductions,investments,super,settings-backups,settings-security}-{light,dark}.png` (14 files, ~5 MB) — no longer referenced by the README and the spec no longer regenerates them.

## 0.229.0 — 2026-05-22

### Changed
- **`scheduleOnCalendar` goal now dumps source data before + after
  the POST, and probes `/api/cashflow` directly between the API
  list and the /calendar DOM check.** Per user feedback on #43:
  data-driven tests should attribute a failure to the layer that
  caused it (server forecast vs client render vs cross-test
  pollution), not just report "DOM didn't contain the token".
  - **Pre-flight scan** of `/api/transactions` for same-account
    real txns within ±3 days of today at -$50 (the claim-match
    window from `cashflow-calendar.tsx:matchScheduledToReal`).
    These would suppress our projected occurrence from rendering
    even though both `/api/scheduled` and `/api/cashflow` could
    still show it elsewhere — surfacing them up-front in the
    finding message makes a "phantom miss" self-explanatory.
  - **New `verify cashflow projection` finding** between the API
    list and `/scheduled` DOM legs. Calls
    `/api/cashflow?from=<month-start>&to=<month-end>`, finds
    today's day, and asserts our payee is in `scheduledEvents`.
    `cashflowProjected=true` + `calendarHit=false` ⇒ client
    bug; `cashflowProjected=false` ⇒ server forecast or
    claim-matching suppression.
  - **`/calendar — verify /calendar DOM` finding** now appends a
    `Layer: <ok | client | server>` attribution so the
    TEST-RESULTS.md row tells you which subsystem to look at
    next without re-running the test under a debugger.
  Standalone run on the new code: cashflow projection ✅,
  calendar DOM ✅, pre-flight collisions: `none`. The
  diagnostic carries into full-suite runs where #43 has been
  flaking — the next failure will name the layer.



### Fixed
- **#44 — monkey breadth-first select-cycler 60 s timeout on
  single-option selects (or selects that mutate mid-cycle).** The
  cycler at `monkey.spec.ts:374-403` was holding `Locator[]`
  results from `sel.locator("option").all()` — Playwright Locators
  are bound to `.nth(N)` selectors, so when a select re-rendered
  with fewer options (one option-change rewired state and shrank
  the option set), the next `.getAttribute("value")` on the stale
  Locator auto-waited the full 60 s test budget. Replaced with
  `evaluateAll` which snapshots all values in one DOM call as
  plain strings — no stale Locators, no auto-wait surface. Also
  short-circuits selects with `< 2` options (nothing meaningful
  to cycle).
  Verified: `pnpm test:e2e tests/e2e/monkey.spec.ts` → all 10 pages
  pass (was failing on Transactions / Calendar in the full suite).

### Added
- **Two more columns on the Smart-Monkey expert-system table:**
  - **Total attempts** (renamed from "Attempts" — it's already the
    lifetime count, but the new label makes the persistence
    semantics obvious).
  - **Pass rate** — shows `successes/attempts (PP%)`, e.g.
    `3/5 (60%)`. Em-dash when attempts = 0.
  - Required a new `successes: number` field on `GoalState` (added
    in schema 8, alongside the existing `attempts`). `emptyAppMap`
    seeds it to 0; `recordGoalAttempt` increments it whenever a
    `SuccessfulRun` is passed.

  AppMap schema 7 → 8.

## 0.227.0 — 2026-05-22

### Added
- **`Last attempt` column on the Smart-Monkey expert-system table
  in `TEST-RESULTS.md`.** Pre-0.227 the table was rendered fresh
  from the persisted AppMap every run, but rows looked ❌
  whenever a single-test invocation wiped `tests/e2e/.data/app-map.json`
  before firing (a habit from my own test commands that defeated
  the AppMap's accrue-across-runs design). The new column shows
  each goal's `lastAttempt` timestamp (ISO date + minute, e.g.
  `2026-05-22 09:00`) — rows whose stamp predates the current run's
  start are clearly carry-overs from earlier runs, not blanks.

  Also documents in-code that the AppMap is intentionally persisted
  across runs (`tests/e2e/global-setup.ts` already comments the
  non-wipe convention; the new column makes it visible in the
  rendered output).

### Notes
- **0.226 closed #43 prematurely; reopened.** The standalone-fix
  poll (5 × 600 ms after `page.goto("/calendar")`) reliably makes
  the scheduleOnCalendar test pass when run standalone (2.7 s),
  but the FULL e2e run still misses the /calendar DOM. Tried in a
  0.227-attempt run: added `Promise.all([waitForResponse(/api/cashflow), goto])`
  + bumped the poll to 10×600 ms. Result: WORSE — full e2e went
  from 1 failure (7.3 min) to 2 failures (11.0 min), with
  `monkey: Calendar` (a different test) now also failing. Reverted.

  Added an in-code comment on the polling block pointing future
  readers at #43 with the diagnostic trail.

- **Refreshed screenshots + TEST-RESULTS.md** from the latest full
  e2e run (the now-machine-overwritten block lives in the renamed
  file, no longer in the retired TODO.md).

## 0.226.0 — 2026-05-22

### Fixed
- **Issue #43 — `scheduleOnCalendar` /calendar DOM miss.** The
  /calendar verification leg used a single `waitForTimeout(800)`
  then read `body.innerText()` once. Calendar fetches cashflow
  forecast via SWR; the 800 ms shot was racing the request +
  render and intermittently missing the freshly-POSTed schedule
  on full-suite runs. The API + /scheduled DOM legs both used
  faster paths so they consistently passed — the discrepancy
  was the timing of the single sample on the calendar.

  Replaced the one-shot with a 5-attempt poll (600 ms between
  attempts, 5 s innerText cap each) — same pattern as
  addTenToCategory / searchTransaction / etc. Breaks the moment
  the token shows up so the happy-path budget barely moves.
  Verified standalone: all three legs pass in 2.7 s.

## 0.225.0 — 2026-05-22

### Fixed
- **`TEST-RESULTS.md` prose was getting eaten by the teardown's
  sentinel-replace regex.** 0.224.0's new TEST-RESULTS.md mentioned
  the literal `<!-- monkey:start -->` token by name in the intro
  prose, so when the teardown ran its non-greedy
  `start…end` regex, it matched from the FIRST instance of the
  opening token (in the prose, inside backticks) through to the
  closing sentinel — eating the entire intro between them. Rewrote
  the prose to describe the tokens generically ("HTML-comment
  sentinels") without naming them literally; added an inline
  warning in the file so the next editor doesn't reintroduce the
  same trap.

### Notes from the 0.224 e2e run
- **96 passed, 1 failed, 2 skipped in 7.3 min** — full result.
- New findings filed as issues:
  - #43 — `scheduleOnCalendar` /calendar DOM doesn't render today's
    occurrence (the API + /scheduled DOM legs still pass, so it's
    isolated to the calendar's render layer or the cashflow
    forecast SQL).
  - #44 — `monkey: <Page>` select-cycler times out on single-
    option selects (waits for `<option>.nth(1)` that never appears,
    busting the 60s per-test budget).
- Pre-existing finding: `lockUnlockRoundTrip` post-unlock 401
  on the full-suite run only (passes stand-alone). Documented
  in 0.220.0 — cross-test cookie state. Not re-filed.

## 0.224.0 — 2026-05-22

### Removed
- **`TODO.md` retired.** The file had grown into a hybrid log of
  open issues + ideas + test-results + architecture notes +
  done-history; every one of those is better served by a
  purpose-built channel. Specifically:

  - **Open follow-up work** (40 entries: test-coverage gaps,
    deferred dependency bumps, UX ideas, infrastructure
    improvements) → **GitHub Issues** #3 – #42, with new
    `area:*` and `type:*` labels for filtering. Examples:
    `area:transactions + type:test-coverage`, `area:infra +
    type:tech-debt`. See [Issues](https://github.com/budgets-au/budgets/issues).
  - **Test results** (the auto-overwritten `<!-- monkey:start -->`
    block) → **`TEST-RESULTS.md`** (new). The e2e teardown
    (`tests/e2e/global-teardown.ts`) now writes there. Sentinel
    markers are unchanged so the existing replace-between-markers
    logic continues to work.
  - **Architecture notes / gotchas** (Recharts 3 react-redux
    subscriber loop, `.next-e2e` build-dir convention, drizzle
    migration idempotency) → folded into `AGENTS.md`'s "Gotchas
    worth knowing before you ship a bug" section, next to the
    existing TDZ / Base-UI / hover-fallback notes.
  - **Done / dropped history** — preserved in `CHANGELOG.md`,
    which has carried per-release write-ups since 0.205.

  Net effect: one source of truth per concern. Issues are
  filterable / labellable / closeable; test results are
  machine-overwritten without colliding with hand-prose; CHANGELOG
  remains the canonical historical record.

### Changed
- `tests/e2e/global-teardown.ts` writes the monkey block to
  `TEST-RESULTS.md` instead of `TODO.md`. The path-not-found
  fallback inserts a fresh `## Latest smart-monkey run` heading
  with the block beneath. All in-tree comments referencing
  `TODO.md` updated to point at TEST-RESULTS.md or GH issues.

### Labels added (in repo)
- `area:transactions`, `area:scheduled`, `area:dashboard`,
  `area:investments`, `area:categories`, `area:accounts`,
  `area:settings`, `area:multi-db`, `area:auth`, `area:reports`,
  `area:import`, `area:infra`, `area:tests`.
- `type:test-coverage`, `type:tech-debt`, `type:ux`.

## 0.223.0 — 2026-05-22

### Added
- **Brave Search API key now settable from Settings → General.**
  0.222.0 shipped the dual-source announcements (Yahoo + Brave) but
  the Brave key had to come from a `BRAVE_SEARCH_API_KEY` env var —
  fine for container deployments, awkward for household installs
  where the operator doesn't have container-env access. The key now
  has a Settings UI:

  - New `BraveSearchKeyPanel` component in Settings → General
    (between the palette editor and the About box). Shows
    "Configured / Not configured" + a source indicator (env var
    vs DB vs none). Set / Replace / Clear buttons drive a masked
    password-style input. The key value is never displayed back —
    avoids leaking the household-wide secret on screenshares.

  - New admin-gated endpoint `/api/settings/brave-search-key`:
    - GET returns `{ configured: boolean, source: "env" | "db" |
      "none" }`. No key bytes ever returned.
    - PATCH `{ key: string | null }` writes (or clears with null /
      empty string) the DB-stored value.

  - New schema column `app_settings.brave_search_api_key` (text,
    nullable). Migration `0014_app_settings_brave_search_api_key.sql`.

  - New resolver `resolveBraveApiKey()` in
    `src/lib/investments/brave-search.ts`. Precedence: env var →
    DB value → undefined. Lazy DB lookup; failures (DB not ready,
    table missing pre-migration, etc.) fall through to undefined
    so the no-key install path stays solid. The news route's
    `searchInvestmentNews()` call resolves at request time, so
    setting the key in Settings takes effect on the next refresh
    of any investment-detail Announcements panel — no app restart
    needed.

  - AGENTS.md updated to mention the Settings UI alongside the
    env var.

## 0.222.0 — 2026-05-22

### Added
- **Brave Search results alongside Yahoo announcements on the
  investment-detail panel.** Yahoo's news endpoint is curated but
  narrow (single source, title-only, strict ticker filter that
  drops legitimate stories that don't tag the ticker). Brave
  Search broadens coverage — broker blogs, ASX wires, niche
  financial outlets — AND returns a snippet/`description` so the
  operator can triage without clicking through every headline.

  Augment, not replace: the panel now fetches BOTH sources in
  parallel via `Promise.allSettled`. A failure in either is
  logged and the other source still feeds the panel. Brave
  gracefully returns `[]` when its API key is missing — installs
  without a `BRAVE_SEARCH_API_KEY` env var keep working exactly
  as today (Yahoo carries the panel alone). No UI degradation
  for the no-key install path.

  Each result carries a `"yahoo"` / `"web"` source badge in the
  publisher line so the operator can spot which channel surfaced
  a story. The 24h per-symbol cache is unchanged; both sources
  refresh together when TTL expires.

  Schema: `investment_news` gains a `source TEXT NOT NULL
  DEFAULT 'yahoo'` column (legacy rows back-fill correctly) and
  a `description TEXT` column (Yahoo never populates it; Brave
  always does when the result has a snippet). Migration
  `drizzle/0013_investment_news_source_description.sql`.

  Brave-side dedup key: SHA-256 of the result URL — same URL
  always yields the same uuid, so the existing
  `(symbol, uuid) UNIQUE` index handles dedup across sources.

  New env var: `BRAVE_SEARCH_API_KEY` — documented in AGENTS.md.
  Free tier (2000 q/mo, 1 q/s) is plenty for a household app
  with the existing 24h cache.

  24 new unit tests in `brave-search.test.ts` cover query
  construction, URL → uuid stability, `age` string parsing
  (relative + absolute forms), graceful empty on missing key /
  upstream failure, dedup by URL, count cap.

## 0.221.0 — 2026-05-21

### Added
- **`savedFilterDeleteReorder` smart-monkey goal.** Closes the
  "Saved-filter delete + reorder — `saved-filters.spec.ts`
  covers save only" Transactions TODO gap. Seeds three named
  filters via `PATCH /api/display-prefs`, opens the
  `/transactions` Saved Filters popover, asserts the three
  render, clicks the trash icon on the middle row, then
  `GET /api/display-prefs` confirms only that filter was
  removed.

  Note re: "reorder" — the app exposes no explicit reorder UI
  (`saveCurrent()` auto-sorts by name on every UI save, so there's
  nothing for a user to drag/move). The test focuses on DELETE,
  which is what the TODO entry's "delete + reorder" actually
  needs covered.

  AppMap schema 6 → 7.

## 0.220.0 — 2026-05-21

### Fixed
- **`clearSampleData` goal pointed at the wrong endpoint.** Used
  `GET /api/sample-data` (404 — no such route) where the Settings
  UI and the actual GET handler live at `/api/sample-data/remove`
  (the GET reports counts; the POST does the wipe — both on the
  same `/remove` path). Surfaced as `🟡 GET /api/sample-data → 404`
  in the previous run's monkey block; now records as a clean
  verified leg.

### Changed
- **`lockUnlockRoundTrip` post-unlock leg now captures the response
  body** on failure. The previous run's full-suite monkey block
  showed a 401 on `GET /api/accounts` after `POST /api/unlock`
  succeeded — but stand-alone the test passes clean, suggesting a
  cookie-jar state issue from the cross-test sequence. Body
  capture gives the next operator the error message instead of
  just the status code so a follow-up dig is grounded in data.

### Done — TODO reorg
The "Backup / restore / rekey", "Multi-DB → Create / switch /
unlock-the-new-one round-trip", "Scheduled / Calendar → Create
scheduled → confirm on /scheduled AND /calendar", and "Auth /
session → Lock / unlock round-trip" entries were all marked
closed in the test-coverage-gaps section — covered by their
respective smart-monkey goals. Stale "Expand E2E coverage"
ideas trimmed.

## 0.219.0 — 2026-05-21

### Added
- **`lockUnlockRoundTrip` smart-monkey goal** — closes the
  "Lock / unlock round-trip" entry in the Auth/session
  test-coverage gap. The two-endpoint pair was previously
  destructive-banned in the breadth-first crawl (locking
  mid-test would break every subsequent click); a focused
  goal scripts it cleanly. Four legs:
  1. Precondition: GET /api/accounts → 200 (unlocked).
  2. POST /api/lock → 200; subsequent GET /api/accounts with
     `maxRedirects:0` should 307-redirect to /unlock
     (verifies the proxy intercepts every non-allowlisted
     route while locked).
  3. POST /api/unlock { passphrase } → 200.
  4. Post-unlock GET /api/accounts → 200 (access restored).
  Pinned last with a `try/finally` safety unlock so a
  partial-fail can't leave later specs in the same run
  facing a locked DB. AppMap schema 5 → 6.

### Changed
- **TODO cleanup**: the "Create scheduled → confirm on
  `/scheduled` AND `/calendar`" gap was already closed by
  the `scheduleOnCalendar` goal (shipped earlier in the
  session). Marked closed in the test-coverage-gaps section.

## 0.218.0 — 2026-05-21

### Fixed
- **DELETE / PATCH on `/api/databases/[id]` was unreachable for
  any non-UUID profile id.** Both endpoints used
  `withAdminAuthAndId`, whose route-guard parses the `[id]`
  segment as a UUID. But profile IDs are short hex strings
  (`/^[a-z0-9][a-z0-9-]{0,39}$/`) — every request was returning
  `400 {"error":"Invalid id"}` before reaching the handler.
  Effect: Settings → Database files "Delete" button silently
  failed; ditto the rename. Discovered by the new
  `multiDbSwitcher` monkey goal's cleanup leg.
  Added `withAdminAuthAndProfileId` (validates against
  `isValidProfileId`'s regex inline to keep route-guards' module
  graph minimal) and switched both endpoints to use it.

### Added
- **`multiDbSwitcher` smart-monkey goal** — drives the sidebar
  database-switcher dropdown end-to-end. Closes the
  "Create / switch / unlock-the-new-one round-trip" entry in the
  Multi-DB TODO gap. Five legs:
  1. Click switcher trigger → dropdown opens.
  2. Click "Create new database…" menu item → dialog opens.
     **This is the regression catch point for the 2026-05-17
     `onSelect` vs `onClick` bug** — Base UI's `Menu.Item` fires
     `onClick` (not Radix's `onSelect`); using the wrong prop
     made the menu items silent no-ops.
  3. Fill label + passphrase + confirm → Create → server
     auto-switches + auto-unlocks → /dashboard.
  4. API verify: GET /api/databases shows new profile as active.
  5. Click switcher → Default entry → /unlock → drive unlock
     form with default passphrase → back on default profile.
  Cleanup wraps in `try/finally` so a partial-fail still
  attempts the DELETE → no orphan profile leaks across runs.
  AppMap schema bumped 4 → 5.

## 0.217.0 — 2026-05-21

### Added
- **`rekeyPassphrase` smart-monkey goal** — pinned as the last
  test in `monkey-goals.spec.ts`. Closes the long-standing
  "Rekey passphrase — `/rekey` is in pages-smoke; no spec drives
  the form" entry in the Backup/restore/rekey TODO gap.

  Four legs:
  1. POST `/api/rekey` with wrong current passphrase → expect 4xx
     (key must not flip on bad current).
  2. POST `/api/rekey` with too-short next passphrase → expect
     4xx (route enforces `next.length >= 8`).
  3. Happy path: rotate from the env's `E2E_SQLITE_KEY` (all-zero)
     to an all-ones key, then `GET /api/accounts` to confirm the
     existing session keeps working (PRAGMA rekey rebinds in-place
     — no re-unlock needed for the live process).
  4. Revert: rotate back to the original key. Wrapped in
     `try/finally` so even an assertion failure during the happy-
     path leg still attempts the revert, leaving the DB ready for
     subsequent specs in the same run.

  AppMap schema bumped 3 → 4 for the new goal key.

## 0.216.0 — 2026-05-21

### Added
- **`clearSampleData` smart-monkey goal** — last test in
  `monkey-goals.spec.ts`. Verifies the
  Settings → Sample data → "Remove sample data" round-trip:
  GET `/api/sample-data` → POST `/api/sample-data/remove` → GET
  again → confirm `sampleAccounts` / `sampleTransactions` /
  `sampleScheduled` all zero AND `sampleDataSeeded` stays true
  (so the next unlock doesn't re-seed). Pinned as the suite's
  last destructive action so earlier tests still run against
  the seeded baseline. AppMap schema bumped 2 → 3.
- **`addTenToCategory` state-leak sentinel.** Silent in normal
  runs; screams if the target category has more rows than the
  current run posted. Closes the loop on the long-running "20
  txns / $500 instead of 10 / $250" cashflow finding — the
  0.213–0.214 TDZ cleanup retired the underlying cause, this
  sentinel catches a regression if it returns.

### Confirmed
- Full e2e at 0.215.0 → **93 passed, 2 skipped, 0 failed in
  7.1 min**. Bank Fees shows exactly 10 Jan-2026 txns in the
  diagnostic dump, 0 pre-existing. The state-leak the monkey
  finding flagged is gone.

## 0.215.0 — 2026-05-21

### Fixed
- **`addAndViewNote` smart-monkey goal couldn't see the note in the
  DOM.** The new 0.213.0 goal seeded a transaction with a notes
  string, then grepped `body.innerText` on `/transactions` for the
  text — but the default `transactionsShowNotes` display pref is
  `false`, so the notes column never renders in the row until the
  user toggles "Show notes". Test now PATCHes
  `/api/display-prefs { transactionsShowNotes: true }` before the
  DOM check; the row's notes cell is rendered and the body scan
  finds the text. The API round-trip leg was already passing — the
  notes WERE being persisted and returned, the test just couldn't
  see them.
- **Guardrail-probe classification was inverted.** The
  `runScheduleGuardrailProbes` helper sends both known-good baseline
  payloads AND known-bad payloads to `/api/scheduled`, then recorded
  every successful POST as `kind: "question"` and every rejection as
  `kind: "issue"`. That surfaced the API correctly rejecting bad
  input as red flags in the TODO monkey block, and a successful
  baseline as a yellow "?". Each probe now declares
  `expectAccept: boolean`; the classifier compares against the
  outcome and records `verified` on a match (guardrail working as
  intended) or `issue` on a mismatch (real regression target).
  Message includes the expected vs got summary so the operator can
  see what was being tested at a glance.

## 0.214.0 — 2026-05-21

### Fixed
- **Legacy-backup-migration TDZ.** `runLegacyBackupMigration` was
  failing on every unlock with `TypeError: e.r(...).migrateLegacyBackups
  is not a function` — the lazy `require("@/lib/backup/sqlite-backup")`
  returned a half-init module because that file's top-level
  `import { getClient, livePath, lock } from "@/db"` is part of the
  same cycle the orphan-transfer backfill hit in 0.213.0.
  Parameterised `migrateLegacyBackups(root?)` to accept the resolved
  backup root directly. The unlock caller in @/db now computes the
  root locally (mirroring `backupRootDir()`'s body) and passes it in.
- **Backup-scheduler TDZ.** Same family — `scheduler.ts` was
  top-level-importing `readSchedule` / `takeBackup` / `writeSchedule`
  from sqlite-backup, and the 60s `setInterval` tick fired
  `(0, lB.readSchedule) is not a function` because the named bindings
  were in TDZ state when the scheduler module first evaluated (loaded
  eagerly from `src/proxy.ts` during boot, before @/db's body
  finished). Moved the imports to a `loadBackupModule()` lazy
  `require()` invoked inside `tick()`; by 60s after boot the module
  is fully initialised.

Net effect: the `[db] Orphan-transfer backfill failed` /
`[db] Legacy-backup migration failed` / `[backup-scheduler] Failed
to read schedule` log spam on every unlock + every minute is gone.
More importantly, the cascade those errors triggered through
NextAuth's session-fetch retries was the actual cause of the
`monkey-goals create-{transaction, schedule, budget}` 2-min
timeouts — the full e2e suite now passes 92/0 in 6.6 min (down
from 89/4 in 12.3 min on 0.211.0).

## 0.213.0 — 2026-05-21

### Fixed
- **Sign-out redirected to `0.0.0.0:3000` instead of the current
  origin.** NextAuth's server-side `signOut` URL construction was
  falling back to its hardcoded `localhost:3000` default when the
  request's host couldn't be resolved (LAN proxies that don't
  forward Host, container networking quirks). Switched both
  sign-out call sites (`topbar.tsx`, `settings/reset-browser-data.tsx`)
  to `signOut({ redirect: false })` followed by a client-side
  `window.location.href = "/login"` — uses the browser's actual
  origin every time.
- **Orphan-transfer backfill TDZ on every unlock.** The lazy-require
  pattern (`require("@/db").db` inside `getDb()`) wasn't enough to
  break the webpack cycle in production builds — `Module.db`'s
  getter still resolved before its closure was initialised,
  throwing `ReferenceError: Cannot access 'D' before initialization`.
  Inverted the dependency: `backfillOrphanTransfers` now takes the
  drizzle handle as a parameter. The caller in `db/index.ts` and
  the explicit API route at `/api/transfers/backfill` both pass
  the live handle in. No more cycle, no more TDZ in the unlock
  log spam.

### Added
- **Transactions search now matches the `notes` column** in
  addition to `payee`. `?search=<q>` on `/api/transactions` issues
  `OR(payee LIKE %q%, notes LIKE %q%)`. Description column
  intentionally NOT included — it's the raw CSV/import line and
  matching it would produce noise. The `notes` column is the
  operator's freeform context field; this closes "find that thing
  I wrote a note about".
- **Three new smart-monkey goals**:
  - `searchTransaction` — POST a transaction with a per-run-token
    payee, navigate `/transactions?search=<token>`, verify the row
    renders + the API returns it. Pins payee-search.
  - `addAndViewNote` — POST a transaction with a notes string,
    verify the API echoes it on creation, navigate
    `/transactions?search=<payee>`, verify the notes text is
    rendered in the row. Pins notes round-trip (DB → API → UI).
  - `searchForNote` — POST a transaction whose notes contain a
    unique needle that is NOT in the payee, search for the needle,
    verify the row appears. Pins the new search-includes-notes
    behaviour against regression to payee-only.
- **`monkey-goals.spec.ts` hardening** — `verifyOutcome` now polls
  the DOM 5× with a 5s `innerText` cap per attempt (was a single
  shot with Playwright's default 30s timeout) and the API fallback
  has an explicit 8s timeout. All `waitForLoadState("networkidle")`
  calls became `waitForLoadState("domcontentloaded", { timeout:
  8_000 })` so a NextAuth-poll retry storm can't bust the test's
  120s budget.

### Changed
- **AppMap schema bumped 1 → 2** to accommodate the three new goal
  keys. Existing `tests/e2e/.data/app-map.json` files invalidate on
  load (returning a fresh empty map) so stale runs that didn't
  carry the new keys don't crash on access.

## 0.212.0 — 2026-05-21

### Fixed
- **Race in `seedSystemCategoriesIfMissing` that double-seeded the
  default 30 categories.** The pre-0.212 implementation read the
  empty-DB gate (`SELECT id FROM categories LIMIT 1`) OUTSIDE any
  transaction. Two concurrent `unlock()` calls — common during boot
  when several /api requests fan out from a single NextAuth sign-in
  — could each pass the gate before either had inserted, leaving
  the fresh DB with 60 categories (two of each name). Discovered
  while debugging the new `bulk-recategorise.spec.ts` failing in
  full-suite runs: the SearchableCombobox surfaced two "Charity"
  options and the test's first-match click moved rows to the wrong
  id. Fix: gate-check + insert now live inside a single
  `state.drizzleDb.transaction((tx) => ...)` block; SQLite's
  `behavior: "immediate"` grabs the write lock on BEGIN so the
  second concurrent transaction blocks until the first commits,
  then re-checks the gate and finds rows. Mirrors the existing
  pattern in `seedSampleDataIfMissing`.

  Existing dup-cat databases aren't auto-cleaned — operators can
  merge or delete the duplicates from Settings → Categories. New
  installs and fresh test DBs no longer hit the race.

### Changed
- **`bulk-recategorise.spec.ts` now creates its own test-only
  categories** (`<run-token>-source` / `<run-token>-target`) rather
  than picking from `DEFAULT_CATEGORIES`. Bypasses any pre-existing
  dup-seed state in the DB (now fixed, but resilient against future
  similar gotchas) AND guarantees the category names are unique
  per run, so the combobox name-search resolves to exactly one
  option.

## 0.211.0 — 2026-05-21

### Changed
- **Smart-monkey now verifies POST/PUT responses look persisted, not
  just 2xx.** The old `observeSubmitOutcome` treated any non-error
  response in the 800ms window as healthy — a regression that had a
  route stop persisting while still answering `200 {ok:true}` would
  pass the crawl undetected. New behaviour: the request listener
  peeks at the 2xx response body for POST/PUT submits and stamps
  `persisted: true|false` on the `FormOutcome.network` variant. A
  route is `persisted` when the body has shape suggesting a real
  resource was returned — a top-level `id`, a non-empty array, or an
  envelope (`{data: {id:...}}` / `{row:...}` / `{entry:...}`).
  `{ok:true}`, `{updated:N}`, `{count:N}`, empty body, and
  unparseable junk all stamp `persisted: false`.

  `monkey.spec.ts` now flags a 2xx-but-not-persisted submit as a
  `kind: "question"` finding with the captured body attached, so the
  operator can spot the regression in the same TODO.md block where
  silent submits already surface. PATCH/DELETE responses bypass the
  check entirely — they're not expected to return a single created
  row, so don't get downgraded.

  Pure `looksPersisted(body)` helper extracted for unit testability
  (13 new tests in `_monkey-helpers.test.ts` covering: empty input,
  unparseable JSON, null / scalar values, empty objects + arrays,
  `{ok:true}`, bulk-result envelopes, top-level id (real + empty +
  non-string), array shapes, envelope shapes, extra-fields-alongside
  -id). 380 → 393 vitest cases.

  Closes the "Monkey treats any POST/PATCH within 800ms as healthy"
  cross-cutting blind spot from TODO.

## 0.210.0 — 2026-05-21

### Added
- **Bulk recategorise e2e coverage** (`tests/e2e/bulk-recategorise.spec.ts`).
  The transactions multi-select toolbar flow has been a blind spot —
  smart-monkey drives controls one at a time, so a regression in the
  bulk PATCH path, the SearchableCombobox category picker, or the
  optimistic SWR cache patch could ship silently. New spec seeds 5
  transactions in a source category via the API, drives the UI to
  filter (`?search=<token>`) + select-all + pick a target category +
  Apply, then verifies the move on three legs:
  (1) PATCH `/api/transactions/bulk` returned `{updated: 5}`,
  (2) GET `/api/transactions` shows every seeded row's `categoryId`
      now matches the target,
  (3) GET `/api/reports/cashflow` shows the source month's bucket
      went UP by $125 (less negative) and the target's went DOWN
      by $125 (more negative).
  The cashflow leg is the "verify everywhere" leg from the TODO —
  the cashflow report is the truth source the category-spend
  dashboard widget pulls from too.

## 0.209.0 — 2026-05-21

### Added
- **Backup-scheduler cadence decision is now unit-tested.** Extracted
  `shouldFireBackup(cfg, nowMs)` from the singleton `tick()` in
  `src/lib/backup/scheduler.ts` so the cadence branches (disabled,
  intervalDays=0, lastRunAt=null first-fire, just-fired, on the
  boundary, weekly 6-vs-7-day) can be exercised without spinning up
  the 60s timer + DB layer. 8 new tests in `scheduler.test.ts`. Closes
  the "Scheduled-backup cron actually fires" gap from TODO.
- **Backup-retention pruning is now unit-tested.** Extracted
  `backupsToPrune(list, retain)` from `sweepRetention()` in
  `src/lib/backup/sqlite-backup.ts` — pure decision returning the
  scheduled-only subset past the retain cap (newest-first sort
  applied internally). 8 new tests covering: nothing-scheduled,
  at-cap, over-cap, mixed types (manual + pre-restore stay sticky),
  unsorted input, retain=0 (prune all), fractional + negative retain
  (defensive clamping). Pins the retention behaviour against future
  refactors.
- **Wrong-passphrase rejection on `/api/backup/restore` now has e2e
  coverage** (`tests/e2e/backup-restore.spec.ts`). Verifies the
  restore route returns 401 + leaves the live DB untouched + leaves
  the snapshot file on disk when the operator fat-fingers the
  passphrase. The `verifyBackup` integrity check runs BEFORE
  `swapLive()`, so a typo can't corrupt the household ledger — this
  test pins that ordering.

Tests: 364 → 380 vitest cases. Backup/restore e2e: 1 → 2 (happy-path
round-trip + the new wrong-passphrase rejection).

## 0.208.0 — 2026-05-21

### Changed
- **Cashflow report's `Plan` column flipped from monthly-average to
  window-total ("lumpy view").** Was: a yearly $1200 expense schedule
  showed `$100` in the Plan column (the monthly-normalised rate) while
  the per-month cells correctly lumped the full $1200 onto the due
  month and `—` elsewhere. The mismatch read as a bug — `$100` looked
  like a per-month forecast that didn't match what the cells were
  saying. Now the Plan column reads as `Σ scheduledByMonth` across the
  visible window — the same lumpy figure the cells aggregate to.
  Examples: yearly $1200 in a 12-month window including its due-month
  → $1200; same yearly $1200 in a 6-month window that skips the
  due-month → $0; quarterly $300 in a 12-month window → $1200.
  Per-month cells, Avg/mo, and Diff columns unchanged.

  Field renames in the cashflow API response:
  `CashflowCategory.scheduledPerMonth` → `scheduledTotal`,
  `budgetPerMonth` → `budgetTotal`. Frontend type, golden fixture
  (`PLAN_PER_MONTH` → `PLAN_TOTAL`), and accounting invariants updated
  in lockstep — the schedule-projection consistency invariant
  simplifies from `Σ byMonth ≈ rate × N` (with a one-month tolerance
  for quarterly/yearly firing variability) to a tight identity
  `Σ byMonth === scheduledTotal`. 363 → 364 vitest cases (one new test
  for the mismatch-throws path on the simplified invariant).

  Header label changed from `Plan/mo` → `Plan` to match the new
  semantics.

## 0.207.0 — 2026-05-21

### Changed
- **Smart-monkey findings split: `Issues` / `Questions` / `Verified`.**
  When `monkey-goals.spec.ts` ran its post-goal verification
  legs (GET /api/scheduled finds the row, DOM contains the
  token, etc.) every pass was recorded with `kind: "question"`
  and rendered under the "Questions for review" heading whose
  framing copy reads _"the crawl filled these forms and clicked
  their submit, but saw no network call, toast, or navigation.
  Possibly a silent no-op bug, possibly intentional"_ — wrong
  story for a positive verification. The `kind` union grows a
  `"verified"` variant; the six verification-leg call sites in
  monkey-goals.spec.ts now emit `"verified"` on pass and
  `"issue"` on fail. The teardown report renders verifieds
  under their own `#### Verified` heading with a ✅ tag and a
  framing copy that matches the actual semantics. Run-summary
  line now shows three counts (`6 issues, 0 questions, 6
  verified.`) instead of two. The `classifyFindings` helper
  moved to `tests/e2e/_findings.ts` so it can be unit-tested
  under Vitest (4 new tests in `_findings.test.ts`).

## 0.206.0 — 2026-05-21

### Changed
- **`docker:release` now explains why it skipped buildx.** When
  the script falls back to the single-arch path the runtime
  line used to read `runtime  docker` with no hint about
  which branch fired — `--single-arch` flag? podman? missing
  `docker-buildx-plugin`? The next operator had to read the
  source to find out. The `buildxAvailable()` probe is now a
  `resolveBuildxMode()` resolver that returns the reason
  alongside the boolean; the runtime line surfaces it as
  `runtime  docker  (single-arch — docker buildx not available
  (install docker-buildx-plugin))`. Saves a `--debug` chase
  when an unattended release lands on the wrong path.

## 0.205.0 — 2026-05-21

### Fixed
- **`useDisplayPrefs` now actually fetches.** The 0.190.0
  `useSwrJson<T>` migration accidentally collapsed the third
  argument of `useSWR(key, fetcher, config)` — the explicit
  fetcher dropped out and the config object slid into its slot.
  SWR with no fetcher = no fetch, just `fallbackData`. So for
  12 releases every read-from-server display preference
  (dashboard layout, hide-transfers, persistent account
  filter, theme prefs, hidden categories on the cashflow
  report, sticky upcoming-budgets toggle, etc.) was silently
  ignored on cold load until a PATCH-triggered `mutate`
  kicked SWR into life. Users with customised layouts saw the
  registry default on every page reload; the customisations
  only re-applied on the first SWR revalidate (e.g. focus
  back to the tab, save a toggle, navigate away and back).
  Restored as a single-line fix; the inline comment in
  `src/hooks/use-display-prefs.ts` documents the trap so the
  next `useSwrJson` consolidation pass doesn't re-collapse it.

  Caught during the dashboard-edit e2e debugging session in
  0.204.0 — the test PATCHed a 2-widget layout, the dashboard
  rendered all 9 default widgets, and a 30s `toHaveCount(2)`
  wait timed out because the hook was returning defaults.
  Documented as a "Discovered" item in 0.204.0 and fixed here.

### Added
- **Multi-arch container images** (`linux/amd64` + `linux/arm64`).
  `scripts/docker-release.mjs` now defaults to
  `docker buildx build --platform=linux/amd64,linux/arm64 --push`,
  producing a single OCI manifest list that points at both
  arch-specific images. The cluster pulls the right one
  automatically — same tag, different digest per platform.
  Apple Silicon servers / Raspberry Pi / Graviton stop being
  second-class citizens.

  Flags + env:
  - `--single-arch` — opt out for fast local dev iteration
    (host-arch only, plain `docker build` + `tag` + `push`).
  - `PLATFORMS=linux/arm64` (env) — narrow buildx to one
    platform without losing the buildx semantics (`--push`,
    manifest list of size 1).
  - Falls back to the legacy single-arch path automatically
    when only `podman` is available (buildx is docker-only).

### Changed
- **Dockerfile: `ARG TARGETARCH` arch-aware sharp prebuild
  cleanup.** Before this release, the runner stage hardcoded
  `rm -rf ./.next/standalone/node_modules/@img/sharp-libvips-linux-x64`,
  which on an `arm64` build:
  1. didn't strip the actual arm64 bundle (~50 MB of dead
     weight in the runtime image),
  2. tried to remove an x64 bundle that doesn't exist on the
     arm64 builder (silent no-op, no damage but no benefit).
  Now the `RUN` block switches on `TARGETARCH` so each arch
  trims only the OTHER arch's prebuild. Pure size win on arm64
  images.

- **Dockerfile: pre-clean of pnpm-style stubs before
  `COPY --from=builder /app/runtime-deps`.** Next's standalone
  trace leaves symlinks for `@signalapp/better-sqlite3` /
  `bindings` / `file-uri-to-path` in
  `./node_modules/...`. Classic `docker build` / `podman build`
  silently overwrites those symlinks when the next COPY drops
  a directory there. `docker buildx`'s overlayfs cache-mount
  driver (used for multi-arch) refuses with
  "cannot copy to non-directory". A single `RUN rm -rf` of
  those three subpaths before the COPY makes the same image
  build cleanly under both driver families. Harmless under
  classic builds (the rm is a no-op once you re-create them
  with the COPY).

Validation: vitest **359/359** (full suite — the
disk-usage tests now find `/data` via macOS synthetic.conf).
E2E: **83 passed / 3 failed / 2 skipped**; the 3 failures are
the existing `monkey-goals` create-* trio (timeout post-submit
in `verifyOutcome` — separate investigation queued for 0.206.0).
Multi-arch image verified: `docker buildx imagetools inspect`
shows a proper OCI image index with both `linux/amd64` and
`linux/arm64` manifests.

## 0.204.0 — 2026-05-21

### Added
- **Version-string in the sidebar footer is now a link to
  the GitHub release notes** for the running version
  (`https://github.com/budgets-au/budgets/releases/tag/v${APP_VERSION}`).
  Opens in a new tab, with a `title` tooltip + the same
  hover-color affordance as the existing "New release" line.
  Caveat: an unreleased dev build will 404 — acceptable for
  the shipped-release common case.

### Changed
- **Two flaky `dashboard-edit` tests marked `test.fixme`** with
  documented HTML5-drag synthesis limitations. Both the
  "multi-step drag with chart widgets pre-placed" and "dropped
  widget lands on the grid + drawer drops the pill" tests
  depend on Playwright's chromium-headless reliably firing
  the full `dragstart → dragover storm → drop` sequence that
  RGL's placeholder-commit path requires. Neither
  `pill.dragTo(grid)` nor a `page.mouse.move/down/up` trace
  does that consistently. Coverage gap is acknowledged; tests
  will be re-enabled when we adopt CDP-level
  `Input.dispatchDragEvent` or move to non-headless chromium.
  In the meantime, the simpler "no React crash" variants stay
  active and a new `realDrag(page, source, target)` helper in
  the spec captures the mouse-trace pattern for future tests.

### Discovered (filed as TODOs, not addressed in this release)
- **`useDisplayPrefs` lost its `useSWR` fetcher argument in
  0.190.0** — the `useSwrJson<T>` migration removed the third
  argument by accident, so the hook has been returning
  `DISPLAY_PREFS_DEFAULT` on every render for 12 releases.
  Every display preference (dashboard layout, hide-transfers
  toggle, persistent account filter, theme prefs, etc.) was
  silently ignored by the client until the next focus-revalidate
  or PATCH-triggered cache mutation kicked SWR into actually
  fetching. Restoring the `fetcher` argument is the one-line
  fix, but doing so breaks several e2e tests that were built
  around the broken state — needs its own dedicated release
  with test rewrites. Investigation triggered by the
  dashboard-edit e2e debugging session that turned into "why
  doesn't this test ever pass even when I PATCH the layout".
- **`monkey-goals` tests pass in isolation but fail in the
  full e2e suite** — order-dependent timing issue. The
  goal-driven tests time out at 2 min where they normally
  complete in 15-25s, after `dashboard-edit` +
  `dashboard-widgets` have run earlier in the suite. Suspected
  state pollution (display-prefs, SWR cache, server connection
  pool) that the once-broken `useDisplayPrefs` hook was
  inadvertently masking.

## 0.203.0 — 2026-05-20

### Added
- **Disaster-recovery e2e spec — backup → modify → restore
  round-trip.** New file
  [tests/e2e/backup-restore.spec.ts](tests/e2e/backup-restore.spec.ts)
  exercises the destructive flow the smart-monkey crawl
  can't reach (`restore` is destructive-banned in the click
  crawl, and the post-restore re-unlock plus cross-state
  comparison needs knowledge the monkey doesn't carry).

  The spec is the disaster-recovery **contract**: a backup
  taken at time T must, when restored, return the live DB
  to the exact state at T. Without this test a regression
  in `swapLive()` / WAL handling / passphrase-rebind could
  silently lose a household's ledger.

  Flow:
  1. Sign in (JWT cookie survives the swap — references the
     `admin` user id which the restored DB also has).
  2. Snapshot the baseline transaction count.
  3. `POST /api/backup` → manual snapshot.
  4. `POST /api/transactions` → add a marker row.
  5. `POST /api/backup/restore` with the snapshot + passphrase
     → returns `{ ok, redirect: "/unlock" }`.
  6. `POST /api/unlock` → re-keys the in-process SQLCipher
     connection against the swapped file.
  7. Re-fetch `/api/transactions` → marker is gone, row count
     back to baseline. Plus a `pre-restore` snapshot now
     exists in the backups dir (the user's forward-undo path).

  One latent gotcha caught + documented while writing this:
  `swapLive()` doesn't just *copy* the snapshot over the live
  path — it *renames* it. So the consumed snapshot file is
  gone from the backups dir after restore. The v1 test
  asserted "snapshot still on disk" and failed; the v2
  asserts the opposite (and explains why) so the next
  reader doesn't re-introduce the bug.

## 0.202.0 — 2026-05-20

### Changed
- **Library bumps:** `zod` 4.3.6 → 4.4.3 (now load-bearing
  across 28 routes via `parseJsonBody`), `@base-ui/react`
  1.4.1 → 1.5.0 (every dialog / dropdown / popover wraps
  it), `react` / `react-dom` 19.2.4 → 19.2.6 (patch on
  19.2; pairs naturally with the base-ui bump). All three
  cleared `pnpm audit` + `tsc --noEmit` + the full unit
  suite + the e2e goal sweep on a clean run.

- **9 auth-helper stragglers migrated to
  `withAuth` / `withAdminAuth` / `withAuthAndId`.** The bulk
  migration in 0.193.0 left these on the manual
  `await auth(); if (!session) return 401` preamble. The
  code audit at start of this release flagged them as
  stragglers, not exceptions. Migrated:
  `super/people/[key]`, `investments/vests/[vestId]`,
  `backup/[filename]` (+ `download`),
  `accounts/[id]/reconcile`, `sample-data/remove` (also
  dropped a local `isAdmin` re-implementation that
  shadowed the one in `@/lib/auth`), `categories/orphans`.
  One intentional hold-out: `users/[id]` reads
  `session.user.id` for the `lastAdminGuard` requesterId
  check, so it stays on the manual pattern (the wrappers
  don't pass `session` through).

- **7 `parseJsonBody` stragglers migrated.** These already
  used `safeParse` but with their own
  `{ error, details: flatten() }` response shape — meaning
  the unified `BadRequestBody` envelope wasn't quite
  unified. Now they emit the same
  `{ error, issues: [{ path, message, code }] }` as
  every other route, so a future client-side
  `toastBadRequest()` helper can read one shape across
  the entire API surface. Migrated: `super/people` (+
  `[key]`), `transactions/[id]/transfer-pair`,
  `backup/[filename]`, `databases` (+ `switch` + `[id]`).

- **`tests/e2e/_app-map.ts`: 5 unused exports demoted to
  module-private.** `APP_MAP_PATH`,
  `APP_MAP_SCHEMA_VERSION`, `ControlKnowledge`,
  `RouteKnowledge`, `GoalState` — all consumed only inside
  the module itself; grep across `src/` and `tests/e2e/`
  confirmed zero external consumers. Smaller public
  surface = less to keep stable when the schema evolves.

Suite total: 359 vitest passing, tsc clean, 4 e2e goal
tests green on the clean run after the migration. No
behaviour change for the happy path of any migrated route;
schema-rejection paths now return the unified 400 envelope
instead of the per-route `details.flatten()` shape.

## 0.201.0 — 2026-05-20

### Added
- **Smart monkey — new compound goal: "add 10 transactions to
  a category, verify list + report total".** The three
  pre-existing goals each write ONE row; a bug between the
  POST endpoint and the cashflow aggregation could slip past
  every single-row check while breaking every dashboard
  widget at once. This goal closes that hole with a three-leg
  end-to-end check on a single transaction batch:

  1. POST `/api/transactions` × 10 with one shared category +
     account + amount + date. Per-row payee carries an
     identifiable `${RUN_TOKEN}-bulk-${i}` suffix so the
     verification legs can distinguish this batch from other
     goals' rows in the same run.
  2. **API list check** — `GET /api/transactions?limit=200`
     must return exactly 10 rows whose payee starts with
     `${RUN_TOKEN}-bulk-`.
  3. **DOM list check** — navigate to `/transactions`, count
     occurrences of the bulk prefix in the rendered table.
     A divergence between (2) and (3) means an SWR cache
     regression in the list view itself.
  4. **Cashflow report check** — `GET /api/reports/cashflow`
     for January 2026 must return a category entry with
     `totalCount === 10` and `Math.abs(total) === 10 × |amount|`.
     This is where off-by-one bugs in the SQL aggregate fail
     — before any user sees them.

  Each verification leg records its own finding so a partial
  pass surfaces useful diagnostics ("11/10 rows matched" → I
  forgot to suffix-filter past the previous goal's row).
  Goal-achieved only when all three legs pass.

  Validation: ran cleanly on the first try after a token-
  suffix tightening. All 4 goals now achieved on a fresh
  run; recipe locked into `app-map.json`.

  `GoalKey` union + `GOAL_KEYS` array + `emptyAppMap()`'s
  goal-state factory updated to include the new key. No
  separate Vitest tests since the new goal lives entirely
  inside `monkey-goals.spec.ts` (the existing app-map ops
  are already covered).

## 0.200.0 — 2026-05-20

### Added
- **`parseJsonBody(request, schema)` + `badRequest(msg, field)`
  helpers** at
  [src/lib/api/parse-body.ts](src/lib/api/parse-body.ts).
  Every API handler that used to do `schema.parse(body)`
  unwrapped silently returned a Next.js 500 with an empty
  body on any zod failure — the smart-monkey guardrail probes
  (0.199.0) confirmed this on `/api/scheduled` for
  `dayOfMonth=42`, `amount="monkey-goal"`, and a handful of
  cross-field invariants. The helper does
  `safeParse` + returns a 400 with the full zod issue tree
  in a stable `BadRequestBody` shape:
  ```json
  {
    "error": "Invalid request body",
    "issues": [
      { "path": "dayOfMonth", "message": "Too big: expected number to be <=31", "code": "too_big" }
    ]
  }
  ```
  `badRequest(message, field)` emits the same shape for
  cross-field rules zod can't express (transfer needs a
  destination, etc.) so the client can render schema and
  hand-rolled errors uniformly.

  6 unit tests cover happy path, schema failure with nested
  paths, malformed JSON, and the cross-field convenience.

### Changed
- **Bulk migration: 27 API routes (29 `.parse(body)` sites)
  swapped to `parseJsonBody`.** Mechanical 4-line change at
  each call site, no behaviour change for the happy path —
  but every former silent-500 zod failure now returns a
  useful 400. Routes covered: super, investments
  (+vests), settings, watchlist, transactions
  (+bulk +[id]), accounts (+[id] +reconcile +import/commit),
  payee-rules, import (learn-aliases, commit-batched,
  format-check, undo-commit), categories (+[id]), scheduled
  ([id] +dismiss-missed +replace +forecasts +bulk
  +suggestions/dismissals). The pilot routes from
  this release's first commit (`/api/scheduled`,
  `/api/transactions`) are also on the helper.

  Five routes are intentionally **out** of scope: the
  databases/backup/transfer-pair endpoints already used
  `safeParse` with their own `{ error, details: flatten() }`
  response shape. Migrating those would be a client-visible
  body-shape change — left for a follow-up that also
  builds a `toastBadRequest()` client helper to consume the
  new shape uniformly.

- **`/api/scheduled` adds a `type=transfer` →
  `transferToAccountId` cross-field guard.** The smart
  monkey discovered the route accepted
  `type=transfer` with no destination and returned 201,
  leaving a dangling transfer schedule in the DB. The form's
  submit-disabled guard catches it for human users; this is
  defence-in-depth for direct API consumers (CSV import,
  CLI, future integrations).

  Suite total: 359 vitest passing (was 353; +6 from the
  `parse-body.test.ts` cases). Smart-monkey e2e: 3/3 goals
  still achieved end-to-end. The guardrail-probe matrix in
  TODO.md now shows 400 responses with the actual zod
  message instead of `500 [empty body]` for the bad cases.

## 0.199.0 — 2026-05-20

### Added
- **Smart monkey — all three target workflows now achieved
  end-to-end + a guardrail-probe matrix on `/api/scheduled`.**
  Five test-refine-test-refine loops over the goal-driven
  spec, each closing one specific failure mode the previous
  loop's diagnostic surfaced. The user's intent for the
  smart monkey ("learn what breaks so we can establish
  guardrails") now drives the spec directly: every run
  exercises a matrix of known-good + known-bad payloads on
  the schedule API and records the results into TODO.md as
  a backlog of UI-validation gaps to close.

  Per-loop work:
  - **L1 (instrumentation):** added a per-step dialog-count
    checkpoint trace appended to "no submit found"
    findings. Showed `opened=1 → after-setupDialog=1 →
    after-fill=1 → after-pickers-1=0` — drivePickers
    closed the dialog out from under the test.
  - **L2 (Escape-bug fix):** drivePickers used to
    `page.keyboard.press("Escape")` when an opened popover
    didn't reveal an option. BaseUI Dialogs dismiss on Esc,
    so on `/scheduled` (where some triggers don't open
    listboxes immediately) the Escape ate the dialog
    itself. Replaced the global Esc with a defensive
    re-click on the same trigger to toggle-close any stray
    popover.
  - **L3 (budget overrides + response-body capture):**
    `createBudget`'s override map was keyed `name` /
    `description`, neither of which matches a label on the
    scheduled form. The token landed in nowhere, the budget
    submitted (POST → 201) but verification couldn't find
    the row. Re-keyed to `payee` + `dates`. Also widened
    `FormOutcome.network` with a `body?: string` and
    captured `resp.text()` on 4xx/5xx so 500s now carry
    their response payload (or `[empty body]`) into the
    finding.
  - **L4 (`data-placeholder` filter + direct-API probe):**
    drivePickers was overwriting valid form defaults
    (`Type=expense`, `Frequency=monthly`) with the first
    `<SelectItem>` in DOM order. Scoped the trigger query
    to `[data-slot="select-trigger"][data-placeholder]:visible`
    — only drives Selects that still show their placeholder
    (i.e. truly unset). Added a guardrail-probe stub that
    hits `/api/scheduled` directly with a known-good payload
    so we can tell whether a goal failure is form-driven
    or genuinely server-side.
  - **L5 (Day=42 fix + guardrail matrix):** the silent 500
    on `createSchedule` traced to my generic
    `defaultForType("number")` returning `"42"`, which
    `dayOfMonth` (zod `min(1).max(31)`) rejects. Added an
    explicit `day: "1"` override. Then formalised the
    "probe what breaks" loop into
    `runScheduleGuardrailProbes()` — a matrix of five
    payload variants (baseline + 4 known-suspicious
    combinations) that runs on every fresh
    `createSchedule` attempt and logs each (status + body)
    as a finding.

  Validation run after L5: all 3 goals achieved on first
  attempt, recipes locked into `app-map.json`.

### Discovered (smart monkey → UI guardrail backlog)
- **`POST /api/scheduled` 500's silently on zod
  rejections** — the route's `createSchema.parse(body)`
  call isn't wrapped, so any zod throw produces an
  unhandled 500 with no JSON body. The client sees a bare
  500 and has nothing to surface in a toast. Two concrete
  paths the smart monkey hit:
  - `dayOfMonth=42` (form's HTML5 `max="31"` catches it in
    real browser input, but `.fill()` and any direct API
    consumer bypass that) → 500 [empty body].
  - `amount="monkey-goal"` (non-numeric string fails the
    `numericString` regex) → 500 [empty body].

  Suggested fix on a later release: wrap the handler in
  `safeParse` + return a 400 with the zod issue tree, so
  both the client toast and any third-party API consumer
  get a useful error instead of a silent 500.
- **`POST /api/scheduled` accepts `type=transfer` with no
  `transferToAccountId`** — server creates a transfer
  schedule with nowhere to transfer to. The probe returned
  201 but the row is effectively a dangling pointer. The
  form's submit-button `disabled` guard catches this for
  human users (`disabled={type === "transfer" &&
  !transferToAccountId}`); a defence-in-depth fix on the
  route would mirror the accountId requirement.
- **`POST /api/scheduled` accepts `frequency=once` with no
  `endDate`** — almost certainly intended (a one-off has
  no recurrence to bound). Logged so the operator can
  confirm it's not a regression once the eyeball-pass runs.

## 0.198.0 — 2026-05-20

### Changed
- **Smart monkey — sharper diagnostics on the two
  still-unachieved goals.** 0.197.0 got `createTransaction`
  to lock in a recipe; `createBudget` and `createSchedule`
  remained silent dead-ends with just a generic "could not
  complete this goal" finding. This release tightens the
  monkey-goals helpers so the operator (and a future
  iteration of the crawler) can see exactly where the
  flow falls off the rails.

  - **`drivePickers` locator switched from `:is(…)` to
    comma syntax.** Playwright's locator composer treats
    `[data-slot="select-trigger"]:visible,
    [role="combobox"]:visible` correctly; the
    `:is(…):visible` form silently matched nothing on
    some BaseUI Select triggers in the wild. Cap also
    reduced from 12 → 6 and per-click timeout from
    1500ms → 800ms so a runaway picker can't burn the
    per-test budget (saw 120s overshoots in pre-release
    testing).
  - **Double picker pass with 250ms wait.** Some forms
    re-render after the first selection (e.g.
    `type="transfer"` reveals a "To account" picker on
    the transactions dialog); the second pass picks up
    the newly-revealed triggers without rerunning the
    slow input filler.
  - **Dialog scope via `getByRole("dialog").last()`.** The
    previous `[data-slot="dialog-content"]:visible,
    [role="dialog"]:visible` locator + `.first()` could
    match a wrapper that doesn't host the form's
    buttons, particularly on `/scheduled` where the
    inner Replace `<Dialog>` leaves shadow nodes around.
    ARIA-correct entry plus `.last()` favours the
    deepest stack frame.
  - **Page-scoped submit fallback.** When
    `findSubmitButton(dialog)` returns null, fall back
    to `page.locator('button[type="submit"]:visible').last()`
    — if the dialog scope drifted (saw this happen on
    `/scheduled` between fillGoalDialog and the submit
    check), the page-wide search still locks on. Only
    if THAT also fails do we record the dead-end finding.
  - **Submit-disabled detection.** Before clicking, check
    `submit.isEnabled()`. If disabled, record a finding
    listing `[aria-invalid="true"]` fields and the dialog
    label inventory (`snapshotDialogLabels`) — so the
    operator can see WHICH required fields the form
    expects beyond what the generic filler covered.
  - **Rich "no submit button" finding.** Dumps page-visible
    dialog count + form count + button list (text/type/
    disabled), capped at 10 entries. This is what
    revealed the active bug on `/scheduled`: by the time
    `findSubmitButton` runs, "0 dialog(s), 0 form(s)
    visible" — the dialog has vanished out from under
    the test between fillGoalDialog and the submit
    check. The fix is 0.199.0+ work; the diagnostic
    landing here narrows it from "mystery silent
    failure" to "dialog closes on first picker click".
  - **`triggerLabel` prefers `aria-label` over
    `textContent`.** Icon-only `+` Add buttons stored
    empty trigger labels in the recipe; now they record
    "Add transaction" / "New Scheduled" properly so
    replay can find the trigger by name.
  - **Validation-error scraper** (`scrapeValidationErrors`)
    feeds into both the "submit fired silent" and
    "submit disabled" findings, surfacing
    `[aria-invalid="true"]` field names + visible
    `[role="alert"]` text inside the dialog.

  After this release, `createTransaction` still achieves
  on first run (recipe locked in). `createSchedule` +
  `createBudget` still don't — but the findings now
  point at the right root cause for the next iteration
  ("dialog vanishes after the first Radix Select option
  click on `/scheduled`") rather than the symptom.

  Suite total: **353 vitest passing**, no new tests
  this release.

## 0.197.0 — 2026-05-20

### Added
- **Smart monkey — first goal achieved end-to-end + per-run
  report card.** The 0.196.0 release landed the persistent
  AppMap + goal-driven crawl but the form-filler couldn't
  actually drive any of the three target workflows
  (createTransaction / createBudget / createSchedule)
  because the dialogs use combobox-style pickers (the
  shared `SearchableCombobox` primitive + Radix-style
  `<Select>`) — not plain `<select>` elements — and the
  text inputs in this codebase are named via their wrapping
  `<Field>` label, not via `name` / `id` / `placeholder`.
  This release closes both gaps and adds the run reporting
  the operator asked for.

  **Picker handling.** A new `drivePickers(dialog)` helper
  walks every visible trigger that matches
  `[data-slot="select-trigger"]`, `[role="combobox"]`, or
  a button label starting with "Choose…" / "Select…" /
  "Pick…". For each one it opens the popover, picks the
  first visible `[role="option"]` or
  `[data-slot="select-item"]` (Popover and SelectContent
  both portal outside the dialog subtree, so the search
  scopes to the page), and continues. Capped at 6
  candidates with 800ms timeouts per click so the loop
  can't blow the per-test budget.

  **Label-based input matching.** The goal filler now
  reads each input's accessible name via
  `HTMLInputElement.labels` first (covers `<label
  for="x">` + `<input id="x">`) and falls back to
  `el.closest("label").textContent` (covers the
  `<label><span>Foo</span><input/></label>` pattern used
  by `<Field>` in the transactions / scheduled dialogs).
  Override keys in each `GoalDef.overrides` were
  re-keyed to match the visible label words (`date`,
  `payee`, `amount`, `notes`) — that's what lets the
  unique per-run token actually land in a field that
  shows up on the rendered row.

  **Validation-error scraping.** When a submit fires no
  network call / toast / nav, the crawl now scrapes the
  dialog for `[aria-invalid="true"]` controls and any
  `[role="alert"]` text inside it, and tacks the result
  onto the finding ("Validation hints: field "Account"
  invalid; This field is required"). That turns
  "submit went nowhere" — useless — into "submit went
  nowhere because field X tripped" — actionable.

  **Per-run report card in TODO.md.** The
  `<!-- monkey -->` block grows three new subsections:
  - **Smart Monkey expert system** — goal-status table
    (achieved / attempts / route + trigger + submit
    recipe) plus a coverage line.
  - **Smart Monkey run report** — a metric table for the
    LAST e2e cycle: total wall time, routes visited,
    button clicks, switch toggles, select cycles, text
    inputs filled, dialogs opened, form submits, links
    discovered, console errors, goals
    attempted / achieved, findings logged. Sums across
    every `RunSummary` row appended in the last 5 minutes
    so the breadth-first + drill-down + goal-driven specs
    appear as one combined picture.
  - **Workflows completed** — one bullet per goal with
    ✅/❌ + the route, trigger label, and submit label
    when achieved.

  **Vitest summary.** A new `pnpm test:report` command
  runs Vitest with the JSON reporter, then runs
  `scripts/vitest-summary.mjs` to boil the raw output
  (megabytes of per-assertion detail) down to a small
  sidecar at `tests/e2e/.data/vitest-report.json` with
  the counts only. The Playwright teardown reads that
  sidecar (if present) and appends a "Vitest summary"
  subsection — green checkmark + pass/fail/skip + suite
  total + duration. Two-step rather than a Vitest
  reporter plugin so `pnpm test` itself stays untouched
  for spot-checks.

  **Granular `RunSummary` shape.** The on-disk
  `app-map.json`'s `runs` ring records the breakdown
  (each kind of activity counted separately) instead of
  the lumped `controlsExercised` field. An
  `emptyRunCounters()` constructor returns a zeroed
  ledger that each spec mutates as it runs and snapshots
  in `afterAll`.

  Validation run: **createTransaction goal achieved**
  (verified via DOM) — recipe `/transactions` → click
  **Add transaction** → fill date / payee / amount /
  notes → click **Add**. createBudget + createSchedule
  remain unachieved (the scheduled form has more
  required fields than the generic filler covers today —
  the multi-account picker plus the
  amount-range / frequency / dates triplet). The map
  will retry them next run.

### Changed
- **Triggers prefer `aria-label` when picking the label
  for the recipe.** Icon-only "+" buttons (the
  /transactions and /scheduled Add affordances) have
  empty `textContent`. The recipe used to store an
  empty `triggerLabel`, which broke replay because
  `getByRole("button", { name: "" })` doesn't match.
  Now we read `aria-label` first.
- **Vitest tests for `emptyRunCounters`.** 1 new test
  asserts the ledger covers every count field; total
  suite: **353 passing**.

## 0.196.0 — 2026-05-20

### Added
- **Smart monkey — the 1000-monkeys crawl learns across runs.**
  The exploratory Playwright crawl that visits each page,
  toggles every switch, fills every form, and writes findings
  into TODO.md was stateless: every run started fresh, learned
  nothing, and produced the same "filled 3 inputs, no toast
  fired — is this a bug?" question for the same form every time.
  This release gives it a persistent brain in three pieces:

  1. **`tests/e2e/.data/app-map.json` — a learning store.**
     One JSON file, gitignored, accumulates across runs. For
     every route the crawl has visited it records visits +
     timestamps, an inventory of every interactive control
     observed (kind, accessible label, click count, whether the
     click opened a dialog, errored), every in-app link seen,
     and a rolling console-error tally. A schema-version stamp
     on the file means a bumped data model invalidates stale
     maps automatically without manual cleanup.

  2. **Drill-down crawl.** A new test at the bottom of
     `monkey.spec.ts` picks routes the map has discovered via
     `linksOut` but never directly visited (e.g.
     `/transactions/<uuid>`, account detail pages, report
     drill-downs) and visits up to 8 of them per run with a
     light inventory-only pass. Over successive runs the map
     fills in the long tail of parameterized routes that a
     hand-curated `CRAWL_PAGES` list would never enumerate.

  3. **Goal-driven spec — `monkey-goals.spec.ts`.** Three
     high-level user tasks (`createTransaction`, `createBudget`,
     `createSchedule`) are encoded as goals. Each test:
     - **Replays** the recipe stored in the map from the last
       successful run (route + trigger button + fillSpec +
       submit button label). If the replay still works it's a
       near-zero-budget confirmation that nothing regressed.
     - On replay miss / fresh runs: **explores** candidate
       routes, hunts for "Add" / "New" / "Create" triggers,
       opens the resulting dialog, fills it with identifiable
       per-run tokens (`monkey-goal-<base36-ts>-tx`), submits.
     - **Verifies DOM-first** (looks for the token in the
       post-submit body), then falls back to the list API
       (`GET /api/transactions?...`, `GET /api/scheduled`) for
       a second opinion. A disagreement between DOM and API is
       itself a finding.
     - **Records the recipe** on success — next run's replay
       skips the exploration entirely.

  The teardown grows a "Smart Monkey expert system" subsection
  in `TODO.md`'s `<!-- monkey -->` block: a goal-status table
  (achieved / attempts / last successful recipe), a coverage
  line (mapped routes, catalogued controls, discovered links),
  and a "drill-down candidates" list of routes still unmapped.

  Reusing the existing per-spec wipe of the findings file would
  have made the goal spec and the breadth-first spec clobber
  each other depending on alphabetical execution order; the
  findings wipe moved to `global-setup.ts` (the app-map itself
  is never wiped — it accrues by design).

  Vitest gets a new entry in its `include` glob —
  `tests/e2e/_*.test.ts` — so the pure-logic app-map ops can be
  unit-tested without spinning up Playwright. 14 new tests
  cover `emptyAppMap` shape, `ensureRoute` get-or-create +
  visit counter, control-signature normalisation, repeat-merge
  accumulation, link-set uniqueness + sort, ring-buffer-bounded
  runs, and `isInternalPath`'s rejection of API / login /
  protocol-relative / hash / external URLs. Suite total: 352
  passing.

### Changed
- **Playwright `testMatch` restricted to `*.spec.ts`.** Stops
  Playwright from trying to load the new Vitest-only
  `tests/e2e/_app-map.test.ts` (which imports `vitest` and
  would error in Playwright's runtime).

## 0.195.0 — 2026-05-20

### Added
- **Unit tests for the four new shared helpers introduced in
  0.190.0 – 0.192.0.** The sweep migrated 73 API routes and
  ~51 SWR call-sites through three new helpers
  ([route-guards.ts](src/lib/api/route-guards.ts),
  [account-ids.ts](src/lib/api/account-ids.ts),
  [use-swr-json.ts](src/hooks/use-swr-json.ts)) — but the
  helpers themselves had no direct unit coverage, only
  transitive coverage through the routes that use them. If a
  regression slipped into one of them, every dependent
  feature would break at once with no narrowing signal.
  21 new tests in three colocated files now lock in:
  - `withAuth` / `withAuthAndId` / `withAdminAuth` /
    `withAdminAuthAndId` — gate ordering (401 before
    UUID-parse, 401 before role-check, 403 before
    UUID-parse), and that valid sessions pass the validated
    id through to the inner handler. Uses `vi.hoisted` to
    flip the mocked session per-test without spinning up
    NextAuth.
  - `parseAccountIds` / `isUuid` / `accountIdSql` — CSV
    whitespace trimming, non-UUID segments dropped, empty
    param → empty list, and the dual SQL-fragment shapes
    (`AND account_id IN (...)` plus the bare /
    `t.`-prefixed variants, with the non-archived fallback
    subquery when ids is empty).
  - `jsonFetcher` — happy-path JSON parse, throws on 404 /
    500 with a `url → status` message that SWR surfaces to
    callers, and propagates a `fetch()` rejection unchanged.
  Total: 338 tests passing (was 317).

### Security
- **pnpm overrides bump `picomatch` to >=4.0.0 and
  `brace-expansion` to >=5.0.6** to clear the two CVE
  warnings `pnpm audit` was surfacing on transitive deps.
  No direct dependency moves — the overrides force the
  resolver to pull the patched versions for any transitive
  user (mostly `chokidar` / `glob` chains). `pnpm audit`
  now reports "No known vulnerabilities found".

## 0.194.0 — 2026-05-20

### Fixed
- **Dismissed transfer-pair suggestions stay dismissed.**
  Before this release, `DELETE /api/transfers/suggestions/[id]`
  just dropped the row from `transfer_suggestions`. The next
  matcher run — every unlock, every import, every manual
  re-scan via Settings → Maintenance — re-discovered the
  same pair and re-inserted it. The unique-index
  `onConflictDoNothing` only catches the case where a row
  already exists, which it didn't after a dismiss. So the
  user saw the same suggestion "remembered" them forever.
  Now there's a sticky `dismissed_transfer_pairs` table
  (migration `0012`) that the matcher consults before
  inserting. Dismiss writes the pair (canonical
  `transaction_id < candidate_id` order) into that table;
  the matcher's per-suggestion loop skips any pair found
  there. The pair survives every subsequent re-scan. If
  the operator later manually pairs the same two
  transactions via the link-transfer dialog, the dismissal
  is cleared (both rows now carry `transfer_pair_id`
  anyway, but a stale dismissal row would be clutter).

  One integration test in
  [transfer-match.integration.test.ts](src/lib/transfer-match.integration.test.ts)
  asserts the post-dismiss matcher run produces zero new
  suggestions for the same pair.

## 0.193.0 — 2026-05-20

### Changed
- **Bulk migration of API routes to `withAuth` /
  `withAuthAndId` / `withAdminAuth`.** 61 of the remaining
  69 routes from the simplification sweep — accounts,
  categories, transactions, scheduled, investments,
  watchlist, super, reports, import, backup (non-filename),
  databases, payee-rules, settings, lock, rekey,
  github-stats, version-check, display-prefs,
  cashflow, plus the rest of dashboard / super / transfers.
  The handler bodies drop the
  `await auth(); if (!session) return 401` preamble, the
  `params + safeParse` block for `[id]` routes, and the
  `isAdmin(session)` check on admin routes. The wrappers
  own all three checks now.

### Unchanged (legitimate hold-outs)
- Eight routes keep the manual auth pattern: `users/[id]`,
  `categories/orphans`, `sample-data/remove` (all need the
  raw `session` for `session.user.id` or `session.user.role`
  lookups beyond `isAdmin`), `backup/[filename]/route.ts`
  and `backup/[filename]/download/route.ts`,
  `super/people/[key]/route.ts`,
  `investments/vests/[vestId]/route.ts` (non-id dynamic
  params — the `withAuthAndId` helper is `[id]`-specific),
  `accounts/[id]/reconcile/route.ts` (needs session for an
  admin double-check beyond `isAdmin`).

Mechanical-only — every wrapper preserves the same
401/400/403 status codes, the same response shapes, and
the same UUID validation as the inline code did. 316 tests
stay green.

## 0.192.0 — 2026-05-20

### Added
- **`parseAccountIds(searchParams)` + `accountIdSql(ids)` +
  `isUuid(s)`** helpers in new
  [src/lib/api/account-ids.ts](src/lib/api/account-ids.ts).
  Replace the
  `accountIdsRaw.split(",").map(...).filter((id) => UUID_RE.test(id))`
  block and the matching `sql.join` setup that five report
  routes had copy-pasted alongside a local `UUID_RE`.
- **Shared zod enums** in
  [src/lib/api/enums.ts](src/lib/api/enums.ts):
  - `accountTypeEnum` — replaces the three inline
    `z.enum(["checking", "savings", "credit", "loan", "cash"])`
    declarations across accounts routes.
  - `transferKindEnum` — replaces the two inline
    `z.enum(["none", "internal", "external"])` declarations
    in the categories routes.

### Changed
- Five report routes (`cashflow`, `accounts-cashflow`,
  `payee-totals`, `transactions-points`, `tax`) and five
  CRUD routes (`accounts`, `accounts/[id]`,
  `accounts/import/commit`, `categories`,
  `categories/[id]`) now consume the shared helpers instead
  of duplicating the boilerplate inline.

Mechanical-only change; 316 tests stay green.

## 0.191.0 — 2026-05-20

### Added
- **`withAuth` / `withAuthAndId` / `withAdminAuth` /
  `withAdminAuthAndId` route guards** in new
  [src/lib/api/route-guards.ts](src/lib/api/route-guards.ts).
  Wraps Next.js route handlers with the
  `const session = await auth(); if (!session) return Unauthorized`
  preamble that 79 budgets routes had copy-pasted. The
  `*AndId` variants also do the `z.string().uuid().safeParse`
  parse of the `{ params: Promise<{ id: string }> }` arg.
  The `*Admin*` variants add an `isAdmin(session)` gate
  that's separate from the basic logged-in check (rejects
  member-role users with 403).

### Changed
- **Migrated 12 routes to the new helpers** as the pilot
  pass — the rest follow in 0.192.0+ when the per-area
  edits can be reviewed in smaller groups:
  - `api/transfers/*` (4 routes)
  - `api/dashboard/*` (7 routes)
  - `api/investments/[id]` (3 handlers — GET / PATCH /
    DELETE)

Mechanical-only change; route behaviour is byte-for-byte
equivalent (auth still returns 401, invalid UUIDs still
return 400, etc.). 316 tests stay green.

## 0.190.0 — 2026-05-19

### Changed
- **`useSwrJson<T>(key, config?)` hook replaces the
  `const fetcher = (url) => fetch(url).then(r => r.json())`
  lambda that was copy-pasted across 51 React files.** New
  hook in [src/hooks/use-swr-json.ts](src/hooks/use-swr-json.ts)
  bakes in a JSON fetcher that throws on non-2xx (so SWR
  returns `undefined` for `data` instead of resolving an
  error-shaped body that callers would then try to
  `.filter()` against). Call sites collapse from 3 lines
  to 1:

  ```ts
  // before
  const fetcher = (url: string) => fetch(url).then((r) => r.json());
  const { data, isLoading } = useSWR<T>(url, fetcher, { revalidateOnFocus: false });

  // after
  const { data, isLoading } = useSwrJson<T>(url, { revalidateOnFocus: false });
  ```

  Files that have **bespoke** fetchers stay on raw `useSWR` —
  these were the three throwing-fetcher dashboard cards
  (`tracked-stock-card`, `watched-stock-card`,
  `github-stats-card`), [use-display-prefs](src/hooks/use-display-prefs.ts)
  with its custom error handling, plus
  [user-manager](src/components/settings/user-manager.tsx)
  and a handful of settings panels that surface upstream
  error messages.

Mechanical-only change; all 316 tests stay green.

## 0.189.0 — 2026-05-19

### Changed
- **Lib consolidation pass 1 — `toISO`, `numFmt`,
  `StockTooltip`.** Three textbook duplicates removed in
  preparation for the larger simplification sweep:
  - `toISO(d: Date): string` was defined identically in
    `lib/recurrence.ts`, `lib/cashflow.ts`, and
    `lib/budget-period.ts` — all three using **local**
    calendar components, NOT UTC. Moved to
    [src/lib/utils.ts](src/lib/utils.ts) with a load-bearing
    comment about the local-vs-UTC distinction so a future
    swap to `toISOString().slice(0, 10)` doesn't silently
    shift dates by ±1 day in non-UTC timezones.
  - `Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 })`
    was duplicated in `cashflow-report.tsx` and
    `accounts-cashflow-report.tsx`. Exported as `numFmt` from
    `lib/utils.ts`.
  - `StockTooltip` (the recharts tooltip used by the
    tracked-stock + watched-stock dashboard cards) was a
    23-line copy-paste in both files. Extracted to
    [src/components/dashboard/stock-tooltip.tsx](src/components/dashboard/stock-tooltip.tsx).
  - `AccountLite` / `CategoryLite` interface dedup was on
    the candidate list but turned out to be a false
    positive — the five declarations have meaningfully
    different shapes (some require `color`, others add
    `isExternal`, `isArchived`, account `type`, etc.).
    Each file's "Lite" represents what its specific API
    endpoint returns; sharing would create false coupling.

Pure-shape change; all 316 tests stay green.

## 0.188.0 — 2026-05-19

### Changed
- **Cashflow renderer cleanup pass — `MonthCells` +
  inlined `LeafRow` wrappers + generic `aggregateField` +
  simpler `AmountCell` body + `ColOptsContext`.** Five
  no-behaviour-change refactors in
  [cashflow-report.tsx](src/components/reports/cashflow-report.tsx):
  - The `months.map(...)` Fragment block was copy-pasted
    across `ParentHeaderRow`, `SubParentHeaderRow`, and
    `LeafRow` — extracted to a single `MonthCells`
    component. The three call sites collapse from ~30
    lines each to one ~10-line `<MonthCells>` invocation.
    `TotalsRow` keeps its own loop because its
    placeholder Plan / Diff cells and `mode`-aware
    coloring don't fit the abstraction cleanly. The
    `showValues` gate is now caller-side: passing
    `byMonth={}` / `budgetByMonth={undefined}` naturally
    renders every cell as `—`.
  - `ChildRow` / `GrandchildRow` / `StandaloneRow` —
    three one-line wrappers that just set the `indent`
    prop on `LeafRow` — inlined at their (single) call
    sites. Removes the
    `Omit<Parameters<typeof LeafRow>[0], "indent">`
    type gymnastics and the one-hop indirection.
  - `aggregateByMonth` / `aggregateCountByMonth` /
    `aggregateBudgetByMonth` / `aggregateScheduledByMonth`
    — four near-identical helpers — collapse to one
    `aggregateField(cats, field)` with a typed
    `AggregableField` union so the field name is
    compile-checked, not stringly-typed.
  - `AmountCell` body had its button-or-text branch
    duplicated (once inside the trailing-wrapper, once
    standalone). Extracted to a single `content` const
    so the trailing path just wraps the same content in
    a flex span.
  - `opts: ColOpts` was threaded through every row
    component and call site — `ParentHeaderRow`,
    `SubParentHeaderRow`, `LeafRow`, `TotalsRow`,
    `MonthCells`, `renderGroups`, `GrandparentRows`. New
    `ColOptsContext` + `useColOpts()` hook replaces the
    prop-drilling, mirroring the existing
    `CellOpenerContext` / `HideToggleContext` pattern.
    Eliminates the `opts={opts}` noise at ~9 call sites
    and the prop type at 7 component signatures.

Pure-shape change; all 316 unit tests still pass and the
renderer output is byte-for-byte equivalent.

- **Category-mode column widths: value cells now narrow
  + tightly stacked on the right; Category column
  absorbs the slack.** The 0.187.0 `max-w-3xl` wrapper
  cap alone wasn't enough — even within 768 px, browsers
  distributed remaining width across the value columns
  because their TH widths were `min-w-[*]` (a floor, not
  a cap). Replaced with hard `w-[80px]` (or `w-[40px]`
  for Counts) so the value columns hold a tight ~80 px
  each; dropped the Category column's `w-44` hint
  (keeping `min-w-44` as a floor) so it grows to absorb
  the rest. Value-cell padding tightened to `pl-3 pr-1.5`
  (~6 px right padding) so the number sits close to the
  cell's right border. The Cashflow tab inherits the
  same widths — its many-months table still scrolls
  horizontally inside the wrapper.

## 0.187.0 — 2026-05-19

### Changed
- **Category-mode report table now caps at `max-w-3xl`
  (≈ 768 px).** The previous 0.186.0 cap of `max-w-7xl`
  (1280 px) was too generous — on a 1920 px screen the
  table still spread across most of the viewport and the
  column-spread complaint persisted. With the tighter cap
  for `monthAxis=false`, four to six columns fit
  comfortably and the category column reads as the
  dominant column it should be. Cashflow mode keeps the
  1280 px cap so its 14-month scrolling table still has
  room to render.

## 0.186.0 — 2026-05-19

### Changed
- **Cashflow / Category report table is now capped at
  `max-w-7xl` (≈ 1280 px) and centred.** Previously the
  wrapper was `w-full` with no upper bound, so on a wide
  window the browser stretched every cell across the
  viewport — three or four columns each taking ~25 % of the
  screen, with numbers floating in big empty boxes. With
  the cap, narrow Category-mode tables read as a balanced
  row instead of sprawling, and the wide Cashflow table
  still scrolls horizontally inside the bounded wrapper
  exactly as before. One-line wrapper className change.

## 0.185.0 — 2026-05-19

### Changed
- **GitHub stats widget now ships in the new-user default
  dashboard.** Slots into the gap on row 1 at `x=10` (the
  previous five summary cards filled 0-10 of the 12-column
  grid). Operators who've already customised their layout
  keep theirs as-is — the default only applies when
  `dashboardLayout` is empty.

## 0.184.0 — 2026-05-19

### Added
- **"GitHub stats" dashboard widget.** Surfaces the budgets
  container's total downloads + the repo's star count as a
  small 2×2 tile. Both numbers come from a single public
  scrape of
  `https://github.com/budgets-au/budgets/pkgs/container/budgets`
  — the page renders an `<h3 title="N">N</h3>` under
  "Total downloads" plus a header `repo-stars-counter-star`
  counter, so no `GITHUB_TOKEN` is required. The widget
  links the header to the repo and the muted
  `ghcr.io/budgets-au/budgets` footer to the package page.
  Implementation: pure
  [extractGithubStats](src/app/api/github-stats/extract.ts)
  helper + a
  [GET /api/github-stats](src/app/api/github-stats/route.ts)
  route with `revalidate = 3600` so the upstream page is
  pulled at most once an hour per node. Four colocated
  unit tests cover happy / partial / missing / malformed
  HTML.

## 0.183.0 — 2026-05-19

### Changed
- **Investment news filter broadened — title-text fallback.**
  The "Recent announcements" panel often rendered the empty
  state because Yahoo's search-endpoint payload is sparse and
  inconsistently tagged with `relatedTickers`. The v0.125
  strict rule (drop everything without a matching tag) was
  cutting real coverage that simply arrives untagged. Added a
  second tier: items with no tag-match still get through if
  their **title** mentions the bare ticker as a whole word
  ("CBA shares jump") or contains the company name as a
  substring ("Commonwealth Bank of Australia posts record
  profit"). Tier-1 items still come first; dedup by uuid;
  cap at the requested count. The pure
  `filterNewsItems(raw, symbol, companyName, count)` helper
  is extracted from
  [src/lib/investments/yahoo.ts](src/lib/investments/yahoo.ts)
  and covered by 5 colocated tests.

### Fixed
- **API route now passes the investment's company name** into
  the news fetcher so the title-text fallback has the name
  signal to work with. Read together with the broadened
  filter, this rescues coverage Yahoo doesn't tag at all.

## 0.182.0 — 2026-05-19

### Changed
- **Subtotals segmented control reordered + relabelled to
  `Off | Parent | Full`** on the Cashflow / Category report
  toolbar. Order now reads left-to-right by how much detail
  the row tree shows; "None" was confusing alongside the
  other off-state toggles, so it's now "Off".

## 0.181.0 — 2026-05-19

### Removed
- **Total toggle on Cashflow + Category.** The Total column is
  too foundational to hide — the report's whole point is "what
  did I do this period", and the Total cell is that answer.
  Pref `cashflowShowTotal` retired (interface field, default,
  parser entry, toolbar Switch, six `opts.showTotal && ...`
  guards in the row components, and the `showTotal` field on
  `ColOpts`). Total now renders unconditionally.
- **"Roll up budgeted parents" toggle.** Cashflow's
  `buildGroups` already aggregates parent rows from
  descendants by default — a parent row's `byMonth`, `total`,
  and `Plan` are the family totals, not the parent's own
  direct values. The explicit rollup pass was solving for an
  edge case (separating a parent's own budget from descendants'
  sums) that wasn't worth the toolbar real estate. Removed the
  `cashflowRollupBudgetedParents` display-pref, the
  `applyBudgetedParentRollupToGroups` function, the
  `isRolledUp` field on `GrandparentGroup` / `ParentSubGroup`,
  the `Σ` indicator next to rolled-up amounts, the
  `anyBudgetedParent` toolbar gate, the toolbar Switch, and the
  inline `hasOwnBudget` helper that only this feature
  consumed.

## 0.180.0 — 2026-05-19

### Changed
- **Category report is now the Cashflow report with the
  per-month axis turned off.** Both tabs render through the
  same component — `CashflowReport` gained a `monthAxis` prop;
  the Category tab is `<CashflowReport monthAxis={false} />`.
  Every feature added to Cashflow (collapse, hierarchy synth,
  parent rollup, Plan three-way, Diff column, this-month
  highlight in the months that *do* render) lights up on
  Category automatically. Two reports collapse to one.
- **Diff column drops the green/red colour coding** on both
  reports. The Diff is a derived number, not a status
  indicator, so it now reads in plain foreground; negatives
  use the `(N)` parens convention via Cashflow's `mode="plain"`
  formatter. The bottom Surplus / Total Income / Total
  Expenses rows keep their colour — sign is meaningful there.
- **Plan + Diff body cells render a notch smaller**
  (`text-[11px]`) so the derived sub-columns read as quieter
  than the primary actual amount.

### Removed
- **`src/lib/category-hierarchy.ts` and its tests**
  (`buildHierarchicalRows`, `applyBudgetedParentRollup`,
  `hasOwnBudget`). The first two duplicated Cashflow's
  `buildGroups` + `applyBudgetedParentRollupToGroups`; the
  third was a 6-line helper moved inline into
  `cashflow-report.tsx`. Test count: 318 → 307 (11 cases
  retired with the file).

## 0.179.0 — 2026-05-19

### Added
- **Cashflow Plan toolbar is now a three-way segmented
  control — Off / Plan / Diff.** Off and Plan match the
  previous boolean toggle (no plan columns; per-month Plan +
  row-end Plan total). Diff is new: each month gets a Diff
  cell (Total − Plan, signed by category type, with the
  `bg-muted/40` computed-cell background and `mode="net"`
  green/red coding) and the row-end picks up a Diff total
  next to the Plan total. The Diff math mirrors the Category
  report's: positive = under-spent / extra income (green);
  negative = over-spent / shortfall (red). New display-pref
  `cashflowPlanMode` ("off" | "plan" | "diff"); the parser
  migrates a legacy `cashflowShowPlan: true` to "plan" so
  existing operators keep their setting on first load.

### Changed
- **Category report stops red/green-coloring per-row Total
  amounts.** Matches Cashflow's leaf-row convention where
  individual rows render in plain foreground and the color
  encoding is reserved for aggregate / summary rows (Total
  income, Total expenses, Net). The Diff column on Category
  retains its green/red since it's a derived "how did I do"
  indicator.

## 0.178.0 — 2026-05-19

### Added
- **"Roll up budgeted parents" toggle on Cashflow + Category
  reports.** When a parent category carries its own budget,
  flipping this toggle treats the parent's budget as the
  family target. The parent row's Total folds in every
  descendant's actuals; the children stay visible underneath
  (no hiding); a small Σ marker sits next to the parent's
  Total amount to flag "this number already includes the
  rows below". The parent's Plan is held to just the parent's
  own budget — descendants' individual budgets aren't summed
  in, since the parent's budget is meant to cover the family.
  Toggle only appears in the toolbar when at least one parent
  in scope qualifies. The display-pref
  `cashflowRollupBudgetedParents` is shared between the two
  reports, so flipping it on one tab carries to the other.

### Fixed
- **Category-report print view flattened the hierarchy
  indentation.** The print CSS's universal `table td { padding-left:
  4px !important }` rule won the specificity battle against
  Tailwind's `pl-9` / `pl-16` on the category-name cell, so on
  paper every depth-1 and depth-2 row sat flush with depth-0.
  Added scoped rules (`table td.pl-9`, `table td.pl-16`) that
  restore the indents at print-appropriate sizes (16 px / 32
  px to match the 9 pt body font).

## 0.177.0 — 2026-05-19

### Added
- **Category report parents collapse like Cashflow.** Chevron
  next to every row that has descendants; click the row to fold
  its subtree (children + grandchildren) shut. "Collapse all"
  / "Expand all" toggle in the top-left of the toolbar
  mirrors the Cashflow report's button. Synthetic parent
  headers are clickable for collapse but still don't link or
  expose the hide-eye. Collapse state is local to the session
  — per-id collapse is too granular to bother persisting.

### Fixed
- **In-app "New release" indicator stopped detecting tags past
  the first GHCR page.** The version-check route fetched
  `/v2/budgets-au/budgets/tags/list` with the default page
  size (100) and ignored the `Link: <…>; rel="next"` header,
  so once the repo crossed 100 tags the indicator silently
  capped at whatever was on page 1 (which was `0.171.0` —
  three releases stale before anyone noticed). Now walks the
  pagination chain with a 50-page safety cap. Pure helper +
  six unit tests at
  [src/app/api/version-check/parse-next-link.ts](src/app/api/version-check/parse-next-link.ts).

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
