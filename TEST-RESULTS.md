# Test results

Machine-overwritten digest from the latest `pnpm test:e2e` run.
Everything between the HTML-comment sentinels below is replaced on
every run by `tests/e2e/global-teardown.ts`. Anything outside the
sentinels is hand-authored prose; **do not name the sentinel tokens
literally in this prose** — the teardown's "match between first
opening token and first closing token" regex will eat the prose
between them.

Open follow-up work lives in [GitHub Issues](https://github.com/budgets-au/budgets/issues)
with the `area:*` / `type:*` label scheme. Historical release notes
are in [CHANGELOG.md](CHANGELOG.md).

## Latest smart-monkey run

<!-- monkey:start -->
_Last run: 2026-06-26T01:31:58.583Z · 0 issues, 0 questions, 0 verified._

#### Smart Monkey expert system

| Goal | Achieved | Last attempt | Total attempts | Pass rate | Last successful run |
| --- | --- | --- | --- | --- | --- |
| `createTransaction` | ✅ | 2026-06-26 01:21 | 1 | 1/1 (100%) | /transactions · "Add transaction" → "Add" (dom) |
| `createBudget` | ✅ | 2026-06-26 01:21 | 1 | 1/1 (100%) | /scheduled · "New scheduled transaction" → "Create" (dom) |
| `createSchedule` | ✅ | 2026-06-26 01:21 | 1 | 1/1 (100%) | /scheduled · "New scheduled transaction" → "Create" (dom) |
| `addTenToCategory` | ✅ | 2026-06-26 01:21 | 1 | 1/1 (100%) | /transactions · "POST /api/transactions × 10" → "POST /api/transactions" (api) |
| `scheduleOnCalendar` | ✅ | 2026-06-26 01:21 | 1 | 1/1 (100%) | /calendar · "POST /api/scheduled" → "POST /api/scheduled" (dom) |
| `searchTransaction` | ✅ | 2026-06-26 01:21 | 1 | 1/1 (100%) | /transactions · "?search=monkey-goal-mqu8wie4-search-payee" → "GET /api/transactions?search=…" (dom) |
| `addAndViewNote` | ✅ | 2026-06-26 01:21 | 1 | 1/1 (100%) | /transactions · "POST /api/transactions (with notes)" → "GET /api/transactions" (dom) |
| `searchForNote` | ✅ | 2026-06-26 01:21 | 1 | 1/1 (100%) | /transactions · "?search=find-me-monkey-goal-mqu8wie4 (notes-only)" → "GET /api/transactions?search=…" (dom) |
| `clearSampleData` | ✅ | 2026-06-26 01:21 | 1 | 1/1 (100%) | /settings · "POST /api/sample-data/remove" → "POST /api/sample-data/remove" (api) |
| `rekeyPassphrase` | ✅ | 2026-06-26 01:21 | 1 | 1/1 (100%) | /settings · "POST /api/rekey" → "POST /api/rekey" (api) |
| `multiDbSwitcher` | ✅ | 2026-06-26 01:22 | 1 | 1/1 (100%) | /dashboard · "Switcher → Create new database…" → "Create + switch back to Default" (dom) |
| `lockUnlockRoundTrip` | ❌ | 2026-06-26 01:22 | 1 | 0/1 (0%) | _(not yet)_ |
| `savedFilterDeleteReorder` | ✅ | 2026-06-26 01:22 | 1 | 1/1 (100%) | /transactions · "Saved Filters → trash icon on M-entry" → "PATCH /api/display-prefs (via setPref)" (dom) |
| `resetBrowserData` | ✅ | 2026-06-26 01:22 | 1 | 1/1 (100%) | /settings?tab=security · "Reset" → "Reset & sign out" (dom) |
| `addSampleData` | ✅ | 2026-06-26 01:21 | 1 | 1/1 (100%) | /settings · "seedSampleDataIfMissing() on first unlock" → "GET /api/sample-data/remove" (api) |

_Coverage: 11 routes mapped, 405 interactive controls catalogued, 102 in-app links discovered._

#### Smart Monkey run report

| Metric | Count |
| --- | --- |
| Total wall time | 131.8s |
| Routes visited | 3 |
| Button clicks | 66 |
| Switch toggles | 0 |
| Select cycles | 0 |
| Text inputs filled | 0 |
| Dialogs opened | 24 |
| Form submits | 0 |
| Links discovered | 0 |
| Console errors | 0 |
| Goals attempted | 0 |
| Goals achieved | 0 |
| Findings logged | 0 |

#### Vitest summary

_Last run: 2026-06-26T01:04:00.245Z._

✅ **717 passed**, 10 skipped across 72 files (4.9s).

_No issues, questions, or verifications on the last run — only the expert-system summary above._

<!-- monkey:end -->
