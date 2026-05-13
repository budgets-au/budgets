# Changelog

All notable changes to this project are recorded here. The version policy
is **bump minor on every shipped change** (per user directive); patch
remains 0 until released hotfixes warrant it.

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
