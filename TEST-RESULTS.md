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
_Last run: 2026-05-21T23:32:43.806Z · 1 issue, 0 questions, 2 verified._

#### Smart Monkey expert system

| Goal | Achieved | Last attempt | Attempts | Last successful run |
| --- | --- | --- | --- | --- |
| `createTransaction` | ✅ | 2026-05-21 23:19 | 1 | /transactions · "Add transaction" → "Add" (dom) |
| `createBudget` | ✅ | 2026-05-21 23:19 | 1 | /scheduled · "New scheduled transaction" → "Create" (dom) |
| `createSchedule` | ❌ | 2026-05-21 23:19 | 1 | _(not yet)_ |
| `addTenToCategory` | ✅ | 2026-05-21 23:19 | 1 | /transactions · "POST /api/transactions × 10" → "POST /api/transactions" (api) |
| `scheduleOnCalendar` | ❌ | 2026-05-21 23:32 | 2 | _(not yet)_ |
| `searchTransaction` | ✅ | 2026-05-21 23:19 | 1 | /transactions · "?search=monkey-goal-mpg446bu-search-payee" → "GET /api/transactions?search=…" (dom) |
| `addAndViewNote` | ✅ | 2026-05-21 23:19 | 1 | /transactions · "POST /api/transactions (with notes)" → "GET /api/transactions" (dom) |
| `searchForNote` | ✅ | 2026-05-21 23:19 | 1 | /transactions · "?search=find-me-monkey-goal-mpg446bu (notes-only)" → "GET /api/transactions?search=…" (dom) |
| `clearSampleData` | ✅ | 2026-05-21 23:19 | 1 | /settings · "POST /api/sample-data/remove" → "POST /api/sample-data/remove" (api) |
| `rekeyPassphrase` | ✅ | 2026-05-21 23:19 | 1 | /settings · "POST /api/rekey" → "POST /api/rekey" (api) |
| `multiDbSwitcher` | ✅ | 2026-05-21 23:19 | 1 | /dashboard · "Switcher → Create new database…" → "Create + switch back to Default" (dom) |
| `lockUnlockRoundTrip` | ❌ | 2026-05-21 23:19 | 1 | _(not yet)_ |
| `savedFilterDeleteReorder` | ✅ | 2026-05-21 23:19 | 1 | /transactions · "Saved Filters → trash icon on M-entry" → "PATCH /api/display-prefs (via setPref)" (dom) |

_Coverage: 10 routes mapped, 205 interactive controls catalogued, 74 in-app links discovered._

_Drill-down candidates (1) — discovered but not yet exercised:_
- `/calendar`

#### Smart Monkey run report

| Metric | Count |
| --- | --- |
| Total wall time | 5.3s |
| Routes visited | 2 |
| Button clicks | 0 |
| Switch toggles | 0 |
| Select cycles | 0 |
| Text inputs filled | 0 |
| Dialogs opened | 0 |
| Form submits | 1 |
| Links discovered | 0 |
| Console errors | 0 |
| Goals attempted | 1 |
| Goals achieved | 0 |
| Findings logged | 3 |

##### Workflows completed
- ✅ `createTransaction` — `/transactions` · click **Add transaction** → fill → click **Add** (verified via dom)
- ✅ `createBudget` — `/scheduled` · click **New scheduled transaction** → fill → click **Create** (verified via dom)
- ❌ `createSchedule` — _(not yet completed)_
- ✅ `addTenToCategory` — `/transactions` · click **POST /api/transactions × 10** → fill → click **POST /api/transactions** (verified via api)
- ❌ `scheduleOnCalendar` — _(not yet completed)_
- ✅ `searchTransaction` — `/transactions` · click **?search=monkey-goal-mpg446bu-search-payee** → fill → click **GET /api/transactions?search=…** (verified via dom)
- ✅ `addAndViewNote` — `/transactions` · click **POST /api/transactions (with notes)** → fill → click **GET /api/transactions** (verified via dom)
- ✅ `searchForNote` — `/transactions` · click **?search=find-me-monkey-goal-mpg446bu (notes-only)** → fill → click **GET /api/transactions?search=…** (verified via dom)
- ✅ `clearSampleData` — `/settings` · click **POST /api/sample-data/remove** → fill → click **POST /api/sample-data/remove** (verified via api)
- ✅ `rekeyPassphrase` — `/settings` · click **POST /api/rekey** → fill → click **POST /api/rekey** (verified via api)
- ✅ `multiDbSwitcher` — `/dashboard` · click **Switcher → Create new database…** → fill → click **Create + switch back to Default** (verified via dom)
- ❌ `lockUnlockRoundTrip` — _(not yet completed)_
- ✅ `savedFilterDeleteReorder` — `/transactions` · click **Saved Filters → trash icon on M-entry** → fill → click **PATCH /api/display-prefs (via setPref)** (verified via dom)

#### Vitest summary

_Last run: 2026-05-20T09:26:06.823Z._

✅ **353 passed** across 38 files (13.3s).

#### Issues

##### /calendar
- 🔴 **goal "scheduleOnCalendar" — verify /calendar DOM** — DOM on /calendar DID NOT contain the token "monkey-goal-mpg4lpb7-cal-sched". Calendar renders payee text per scheduled occurrence (cashflow-calendar.tsx:1368-1397), so a miss here points at either the cashflow forecast SQL (server) or the calendar's SWR query / cell-rendering layer (client).

#### Verified

_Goal verification legs that passed. Surfaced so the operator can sanity-check what the monkey looked at, without mixing into the silent-no-op questions above._

##### /scheduled
- ✅ **goal "scheduleOnCalendar" — verify API list** — GET /api/scheduled found a row with payee "monkey-goal-mpg4lpb7-cal-sched".
- ✅ **goal "scheduleOnCalendar" — verify /scheduled DOM** — DOM on /scheduled contained the token "monkey-goal-mpg4lpb7-cal-sched".

<!-- monkey:end -->
