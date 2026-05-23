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
_Last run: 2026-05-23T10:12:28.023Z · 0 issues, 0 questions, 0 verified._

#### Smart Monkey expert system

| Goal | Achieved | Last attempt | Total attempts | Pass rate | Last successful run |
| --- | --- | --- | --- | --- | --- |
| `createTransaction` | ✅ | 2026-05-22 07:27 | 6 | 2/6 (33%) | /transactions · "Add transaction" → "Add" (dom) |
| `createBudget` | ✅ | 2026-05-22 07:28 | 1 | 1/1 (100%) | /scheduled · "New scheduled transaction" → "Create" (dom) |
| `createSchedule` | ✅ | 2026-05-22 07:28 | 1 | 1/1 (100%) | /scheduled · "New scheduled transaction" → "Create" (dom) |
| `addTenToCategory` | ✅ | 2026-05-23 06:59 | 7 | 3/7 (43%) | /transactions · "POST /api/transactions × 10" → "POST /api/transactions" (api) |
| `scheduleOnCalendar` | ✅ | 2026-05-23 06:59 | 4 | 3/4 (75%) | /calendar · "POST /api/scheduled" → "POST /api/scheduled" (dom) |
| `searchTransaction` | ✅ | 2026-05-23 06:59 | 4 | 3/4 (75%) | /transactions · "?search=monkey-goal-mpi00bcs-search-payee" → "GET /api/transactions?search=…" (dom) |
| `addAndViewNote` | ✅ | 2026-05-23 06:59 | 4 | 3/4 (75%) | /transactions · "POST /api/transactions (with notes)" → "GET /api/transactions" (dom) |
| `searchForNote` | ✅ | 2026-05-23 06:59 | 4 | 3/4 (75%) | /transactions · "?search=find-me-monkey-goal-mpi00bcs (notes-only)" → "GET /api/transactions?search=…" (dom) |
| `clearSampleData` | ✅ | 2026-05-23 06:59 | 5 | 5/5 (100%) | /settings · "GET /api/sample-data (no-op)" → "(no wipe needed)" (api) |
| `rekeyPassphrase` | ✅ | 2026-05-23 06:59 | 5 | 5/5 (100%) | /settings · "POST /api/rekey" → "POST /api/rekey" (api) |
| `multiDbSwitcher` | ✅ | 2026-05-23 06:59 | 5 | 5/5 (100%) | /dashboard · "Switcher → Create new database…" → "Create + switch back to Default" (dom) |
| `lockUnlockRoundTrip` | ❌ | 2026-05-23 06:59 | 6 | 1/6 (17%) | _(not yet)_ |
| `savedFilterDeleteReorder` | ✅ | 2026-05-23 07:00 | 4 | 4/4 (100%) | /transactions · "Saved Filters → trash icon on M-entry" → "PATCH /api/display-prefs (via setPref)" (dom) |
| `resetBrowserData` | ✅ | 2026-05-23 07:00 | 6 | 6/6 (100%) | /settings?tab=security · "Reset" → "Reset & sign out" (dom) |
| `addSampleData` | ✅ | 2026-05-23 06:59 | 8 | 4/8 (50%) | /settings · "seedSampleDataIfMissing() on first unlock" → "GET /api/sample-data/remove" (api) |

_Coverage: 10 routes mapped, 706 interactive controls catalogued, 82 in-app links discovered._

#### Smart Monkey run report

| Metric | Count |
| --- | --- |
| Total wall time | 168.2s |
| Routes visited | 9 |
| Button clicks | 225 |
| Switch toggles | 11 |
| Select cycles | 12 |
| Text inputs filled | 0 |
| Dialogs opened | 27 |
| Form submits | 0 |
| Links discovered | 0 |
| Console errors | 0 |
| Goals attempted | 0 |
| Goals achieved | 0 |
| Findings logged | 0 |

#### Vitest summary

_Last run: 2026-05-20T09:26:06.823Z._

✅ **353 passed** across 38 files (13.3s).

_No issues, questions, or verifications on the last run — only the expert-system summary above._

<!-- monkey:end -->
