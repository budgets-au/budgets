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
_Last run: 2026-05-22T00:51:54.660Z · 0 issues, 0 questions, 0 verified._

#### Smart Monkey expert system

| Goal | Achieved | Last attempt | Total attempts | Pass rate | Last successful run |
| --- | --- | --- | --- | --- | --- |
| `createTransaction` | ✅ | 2026-05-21 23:57 | 1 | 1/1 (100%) | /transactions · "Add transaction" → "Add" (dom) |
| `createBudget` | ✅ | 2026-05-21 23:57 | 1 | 1/1 (100%) | /scheduled · "New scheduled transaction" → "Create" (dom) |
| `createSchedule` | ✅ | 2026-05-21 23:57 | 1 | 1/1 (100%) | /scheduled · "New scheduled transaction" → "Create" (dom) |
| `addTenToCategory` | ✅ | 2026-05-22 00:04 | 2 | 2/2 (100%) | /transactions · "POST /api/transactions × 10" → "POST /api/transactions" (api) |
| `scheduleOnCalendar` | ✅ | 2026-05-22 00:04 | 1 | 1/1 (100%) | /calendar · "POST /api/scheduled" → "POST /api/scheduled" (dom) |
| `searchTransaction` | ✅ | 2026-05-22 00:04 | 2 | 2/2 (100%) | /transactions · "?search=monkey-goal-mpg5qxq8-search-payee" → "GET /api/transactions?search=…" (dom) |
| `addAndViewNote` | ✅ | 2026-05-22 00:04 | 2 | 2/2 (100%) | /transactions · "POST /api/transactions (with notes)" → "GET /api/transactions" (dom) |
| `searchForNote` | ✅ | 2026-05-22 00:04 | 2 | 2/2 (100%) | /transactions · "?search=find-me-monkey-goal-mpg5qxq8 (notes-only)" → "GET /api/transactions?search=…" (dom) |
| `clearSampleData` | ✅ | 2026-05-22 00:04 | 2 | 2/2 (100%) | /settings · "POST /api/sample-data/remove" → "POST /api/sample-data/remove" (api) |
| `rekeyPassphrase` | ✅ | 2026-05-22 00:04 | 2 | 2/2 (100%) | /settings · "POST /api/rekey" → "POST /api/rekey" (api) |
| `multiDbSwitcher` | ✅ | 2026-05-22 00:04 | 2 | 2/2 (100%) | /dashboard · "Switcher → Create new database…" → "Create + switch back to Default" (dom) |
| `lockUnlockRoundTrip` | ❌ | 2026-05-22 00:04 | 2 | 0/2 (0%) | _(not yet)_ |
| `savedFilterDeleteReorder` | ✅ | 2026-05-22 00:04 | 2 | 2/2 (100%) | /transactions · "Saved Filters → trash icon on M-entry" → "PATCH /api/display-prefs (via setPref)" (dom) |

_Coverage: 10 routes mapped, 319 interactive controls catalogued, 82 in-app links discovered._

#### Smart Monkey run report

| Metric | Count |
| --- | --- |
| Total wall time | 15.9s |
| Routes visited | 6 |
| Button clicks | 0 |
| Switch toggles | 0 |
| Select cycles | 0 |
| Text inputs filled | 0 |
| Dialogs opened | 0 |
| Form submits | 11 |
| Links discovered | 0 |
| Console errors | 0 |
| Goals attempted | 10 |
| Goals achieved | 9 |
| Findings logged | 20 |

##### Workflows completed
- ✅ `createTransaction` — `/transactions` · click **Add transaction** → fill → click **Add** (verified via dom)
- ✅ `createBudget` — `/scheduled` · click **New scheduled transaction** → fill → click **Create** (verified via dom)
- ✅ `createSchedule` — `/scheduled` · click **New scheduled transaction** → fill → click **Create** (verified via dom)
- ✅ `addTenToCategory` — `/transactions` · click **POST /api/transactions × 10** → fill → click **POST /api/transactions** (verified via api)
- ✅ `scheduleOnCalendar` — `/calendar` · click **POST /api/scheduled** → fill → click **POST /api/scheduled** (verified via dom)
- ✅ `searchTransaction` — `/transactions` · click **?search=monkey-goal-mpg5qxq8-search-payee** → fill → click **GET /api/transactions?search=…** (verified via dom)
- ✅ `addAndViewNote` — `/transactions` · click **POST /api/transactions (with notes)** → fill → click **GET /api/transactions** (verified via dom)
- ✅ `searchForNote` — `/transactions` · click **?search=find-me-monkey-goal-mpg5qxq8 (notes-only)** → fill → click **GET /api/transactions?search=…** (verified via dom)
- ✅ `clearSampleData` — `/settings` · click **POST /api/sample-data/remove** → fill → click **POST /api/sample-data/remove** (verified via api)
- ✅ `rekeyPassphrase` — `/settings` · click **POST /api/rekey** → fill → click **POST /api/rekey** (verified via api)
- ✅ `multiDbSwitcher` — `/dashboard` · click **Switcher → Create new database…** → fill → click **Create + switch back to Default** (verified via dom)
- ❌ `lockUnlockRoundTrip` — _(not yet completed)_
- ✅ `savedFilterDeleteReorder` — `/transactions` · click **Saved Filters → trash icon on M-entry** → fill → click **PATCH /api/display-prefs (via setPref)** (verified via dom)

#### Vitest summary

_Last run: 2026-05-20T09:26:06.823Z._

✅ **353 passed** across 38 files (13.3s).

_No issues, questions, or verifications on the last run — only the expert-system summary above._

<!-- monkey:end -->
