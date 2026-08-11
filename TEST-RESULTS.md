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
_Last run: 2026-08-11T01:34:32.725Z · 0 issues, 0 questions, 0 verified._

#### Smart Monkey expert system

| Goal | Achieved | Last attempt | Total attempts | Pass rate | Last successful run |
| --- | --- | --- | --- | --- | --- |
| `createTransaction` | ✅ | 2026-07-16 11:35 | 5 | 5/5 (100%) | /transactions · "Add transaction" → "Add" (dom) |
| `createBudget` | ✅ | 2026-07-16 11:35 | 5 | 5/5 (100%) | /scheduled · "New scheduled transaction" → "Create" (dom) |
| `createSchedule` | ✅ | 2026-07-16 11:35 | 5 | 3/5 (60%) | /scheduled · "New scheduled transaction" → "Create" (dom) |
| `addTenToCategory` | ✅ | 2026-07-16 11:35 | 5 | 5/5 (100%) | /transactions · "POST /api/transactions × 10" → "POST /api/transactions" (api) |
| `scheduleOnCalendar` | ✅ | 2026-07-16 11:35 | 5 | 5/5 (100%) | /calendar · "POST /api/scheduled" → "POST /api/scheduled" (dom) |
| `searchTransaction` | ✅ | 2026-07-16 11:35 | 5 | 5/5 (100%) | /transactions · "?search=monkey-goal-mrnfmgz6-search-payee" → "GET /api/transactions?search=…" (dom) |
| `addAndViewNote` | ✅ | 2026-07-16 11:35 | 5 | 5/5 (100%) | /transactions · "POST /api/transactions (with notes)" → "GET /api/transactions" (dom) |
| `searchForNote` | ✅ | 2026-07-16 11:35 | 5 | 5/5 (100%) | /transactions · "?search=find-me-monkey-goal-mrnfmgz6 (notes-only)" → "GET /api/transactions?search=…" (dom) |
| `clearSampleData` | ✅ | 2026-07-16 11:35 | 5 | 5/5 (100%) | /settings · "POST /api/sample-data/remove" → "POST /api/sample-data/remove" (api) |
| `rekeyPassphrase` | ✅ | 2026-07-16 11:35 | 5 | 5/5 (100%) | /settings · "POST /api/rekey" → "POST /api/rekey" (api) |
| `multiDbSwitcher` | ✅ | 2026-07-16 11:35 | 5 | 5/5 (100%) | /dashboard · "Switcher → Create new database…" → "Create + switch back to Default" (dom) |
| `lockUnlockRoundTrip` | ❌ | 2026-07-16 11:35 | 5 | 0/5 (0%) | _(not yet)_ |
| `savedFilterDeleteReorder` | ✅ | 2026-07-16 11:35 | 5 | 5/5 (100%) | /transactions · "Saved Filters → trash icon on M-entry" → "PATCH /api/display-prefs (via setPref)" (dom) |
| `resetBrowserData` | ✅ | 2026-07-16 11:35 | 5 | 5/5 (100%) | /settings?tab=security · "Reset" → "Reset & sign out" (dom) |
| `addSampleData` | ✅ | 2026-07-16 11:35 | 5 | 5/5 (100%) | /settings · "seedSampleDataIfMissing() on first unlock" → "GET /api/sample-data/remove" (api) |

_Coverage: 12 routes mapped, 424 interactive controls catalogued, 112 in-app links discovered._

#### Smart Monkey run report

| Metric | Count |
| --- | --- |
| Total wall time | 114.4s |
| Routes visited | 9 |
| Button clicks | 169 |
| Switch toggles | 11 |
| Select cycles | 3 |
| Text inputs filled | 5 |
| Dialogs opened | 41 |
| Form submits | 2 |
| Links discovered | 0 |
| Console errors | 0 |
| Goals attempted | 0 |
| Goals achieved | 0 |
| Findings logged | 0 |

#### Vitest summary

_Last run: 2026-08-09T09:19:00.159Z._

✅ **728 passed**, 10 skipped across 73 files (4.6s).

_No issues, questions, or verifications on the last run — only the expert-system summary above._

<!-- monkey:end -->
