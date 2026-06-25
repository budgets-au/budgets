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
_Last run: 2026-05-27T00:14:16.844Z · 0 issues, 0 questions, 0 verified._

#### Smart Monkey expert system

| Goal | Achieved | Last attempt | Total attempts | Pass rate | Last successful run |
| --- | --- | --- | --- | --- | --- |
| `createTransaction` | ✅ | 2026-05-26 21:29 | 9 | 5/9 (56%) | /transactions · "Add transaction" → "Add" (dom) |
| `createBudget` | ✅ | 2026-05-26 21:29 | 4 | 4/4 (100%) | /scheduled · "New scheduled transaction" → "Create" (dom) |
| `createSchedule` | ✅ | 2026-05-26 21:29 | 5 | 4/5 (80%) | /scheduled · "New scheduled transaction" → "Create" (dom) |
| `addTenToCategory` | ✅ | 2026-05-26 12:16 | 14 | 10/14 (71%) | /transactions · "POST /api/transactions × 10" → "POST /api/transactions" (api) |
| `scheduleOnCalendar` | ✅ | 2026-05-26 12:16 | 11 | 9/11 (82%) | /calendar · "POST /api/scheduled" → "POST /api/scheduled" (dom) |
| `searchTransaction` | ✅ | 2026-05-26 12:16 | 11 | 10/11 (91%) | /transactions · "?search=monkey-goal-mpmlnpjz-search-payee" → "GET /api/transactions?search=…" (dom) |
| `addAndViewNote` | ✅ | 2026-05-26 12:16 | 11 | 10/11 (91%) | /transactions · "POST /api/transactions (with notes)" → "GET /api/transactions" (dom) |
| `searchForNote` | ✅ | 2026-05-26 12:16 | 11 | 10/11 (91%) | /transactions · "?search=find-me-monkey-goal-mpmlnpjz (notes-only)" → "GET /api/transactions?search=…" (dom) |
| `clearSampleData` | ✅ | 2026-05-26 12:16 | 12 | 12/12 (100%) | /settings · "POST /api/sample-data/remove" → "POST /api/sample-data/remove" (api) |
| `rekeyPassphrase` | ✅ | 2026-05-26 12:16 | 12 | 12/12 (100%) | /settings · "POST /api/rekey" → "POST /api/rekey" (api) |
| `multiDbSwitcher` | ✅ | 2026-05-26 12:16 | 12 | 12/12 (100%) | /dashboard · "Switcher → Create new database…" → "Create + switch back to Default" (dom) |
| `lockUnlockRoundTrip` | ✅ | 2026-05-26 12:16 | 14 | 2/14 (14%) | /settings · "POST /api/lock" → "POST /api/unlock" (api) |
| `savedFilterDeleteReorder` | ✅ | 2026-05-26 12:17 | 11 | 11/11 (100%) | /transactions · "Saved Filters → trash icon on M-entry" → "PATCH /api/display-prefs (via setPref)" (dom) |
| `resetBrowserData` | ✅ | 2026-05-26 12:16 | 13 | 13/13 (100%) | /settings?tab=security · "Reset" → "Reset & sign out" (dom) |
| `addSampleData` | ✅ | 2026-05-26 12:16 | 15 | 11/15 (73%) | /settings · "seedSampleDataIfMissing() on first unlock" → "GET /api/sample-data/remove" (api) |

_Coverage: 11 routes mapped, 973 interactive controls catalogued, 101 in-app links discovered._

#### Smart Monkey run report

| Metric | Count |
| --- | --- |
| Total wall time | 22.3s |
| Routes visited | 0 |
| Button clicks | 7 |
| Switch toggles | 0 |
| Select cycles | 0 |
| Text inputs filled | 17 |
| Dialogs opened | 3 |
| Form submits | 3 |
| Links discovered | 0 |
| Console errors | 0 |
| Goals attempted | 3 |
| Goals achieved | 3 |
| Findings logged | 0 |

#### Vitest summary

_Last run: 2026-05-26T21:30:13.869Z._

✅ **719 passed** across 71 files (4.4s).

_No issues, questions, or verifications on the last run — only the expert-system summary above._

<!-- monkey:end -->
