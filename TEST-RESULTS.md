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
_Last run: 2026-05-22T06:25:42.769Z · 0 issues, 0 questions, 0 verified._

#### Smart Monkey expert system

| Goal | Achieved | Last attempt | Total attempts | Pass rate | Last successful run |
| --- | --- | --- | --- | --- | --- |
| `createTransaction` | ✅ | 2026-05-21 10:00 | 5 | 1/5 (20%) | /transactions · "Add Transaction" → "Save" (dom) |
| `createBudget` | ❌ | — | 0 | — | _(not yet)_ |
| `createSchedule` | ❌ | — | 0 | — | _(not yet)_ |
| `addTenToCategory` | ✅ | 2026-05-21 10:30 | 3 | 1/3 (33%) | /transactions · "Add" → "Save" (dom) |
| `scheduleOnCalendar` | ❌ | — | 0 | — | _(not yet)_ |
| `searchTransaction` | ❌ | — | 0 | — | _(not yet)_ |
| `addAndViewNote` | ❌ | — | 0 | — | _(not yet)_ |
| `searchForNote` | ❌ | — | 0 | — | _(not yet)_ |
| `clearSampleData` | ✅ | 2026-05-22 04:28 | 1 | 1/1 (100%) | /settings · "POST /api/sample-data/remove" → "POST /api/sample-data/remove" (api) |
| `rekeyPassphrase` | ✅ | 2026-05-22 06:12 | 1 | 1/1 (100%) | /settings · "POST /api/rekey" → "POST /api/rekey" (api) |
| `multiDbSwitcher` | ✅ | 2026-05-22 04:28 | 1 | 1/1 (100%) | /dashboard · "Switcher → Create new database…" → "Create + switch back to Default" (dom) |
| `lockUnlockRoundTrip` | ✅ | 2026-05-22 06:12 | 2 | 1/2 (50%) | /settings · "POST /api/lock" → "POST /api/unlock" (api) |
| `savedFilterDeleteReorder` | ❌ | — | 0 | — | _(not yet)_ |
| `resetBrowserData` | ✅ | 2026-05-22 06:12 | 2 | 2/2 (100%) | /settings?tab=security · "Reset" → "Reset & sign out" (dom) |
| `addSampleData` | ✅ | 2026-05-22 04:28 | 4 | 2/4 (50%) | /settings · "seedSampleDataIfMissing() on first unlock" → "GET /api/sample-data/remove" (api) |

_Coverage: 0 routes mapped, 0 interactive controls catalogued, 0 in-app links discovered._

#### Smart Monkey run report

| Metric | Count |
| --- | --- |
| Total wall time | 4.4s |
| Routes visited | 1 |
| Button clicks | 4 |
| Switch toggles | 0 |
| Select cycles | 0 |
| Text inputs filled | 0 |
| Dialogs opened | 1 |
| Form submits | 0 |
| Links discovered | 0 |
| Console errors | 0 |
| Goals attempted | 3 |
| Goals achieved | 3 |
| Findings logged | 9 |

##### Workflows completed
- ✅ `createTransaction` — `/transactions` · click **Add Transaction** → fill → click **Save** (verified via dom)
- ❌ `createBudget` — _(not yet completed)_
- ❌ `createSchedule` — _(not yet completed)_
- ✅ `addTenToCategory` — `/transactions` · click **Add** → fill → click **Save** (verified via dom)
- ❌ `scheduleOnCalendar` — _(not yet completed)_
- ❌ `searchTransaction` — _(not yet completed)_
- ❌ `addAndViewNote` — _(not yet completed)_
- ❌ `searchForNote` — _(not yet completed)_
- ✅ `clearSampleData` — `/settings` · click **POST /api/sample-data/remove** → fill → click **POST /api/sample-data/remove** (verified via api)
- ✅ `rekeyPassphrase` — `/settings` · click **POST /api/rekey** → fill → click **POST /api/rekey** (verified via api)
- ✅ `multiDbSwitcher` — `/dashboard` · click **Switcher → Create new database…** → fill → click **Create + switch back to Default** (verified via dom)
- ✅ `lockUnlockRoundTrip` — `/settings` · click **POST /api/lock** → fill → click **POST /api/unlock** (verified via api)
- ❌ `savedFilterDeleteReorder` — _(not yet completed)_
- ✅ `resetBrowserData` — `/settings?tab=security` · click **Reset** → fill → click **Reset & sign out** (verified via dom)
- ✅ `addSampleData` — `/settings` · click **seedSampleDataIfMissing() on first unlock** → fill → click **GET /api/sample-data/remove** (verified via api)

#### Vitest summary

_Last run: 2026-05-20T09:26:06.823Z._

✅ **353 passed** across 38 files (13.3s).

_No issues, questions, or verifications on the last run — only the expert-system summary above._

<!-- monkey:end -->
