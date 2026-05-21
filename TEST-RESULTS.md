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
_Last run: 2026-05-21T23:07:49.607Z · 0 issues, 0 questions, 3 verified._

#### Smart Monkey expert system

| Goal | Achieved | Attempts | Last successful run |
| --- | --- | --- | --- |
| `createTransaction` | ❌ | 0 | _(not yet)_ |
| `createBudget` | ❌ | 0 | _(not yet)_ |
| `createSchedule` | ❌ | 0 | _(not yet)_ |
| `addTenToCategory` | ❌ | 0 | _(not yet)_ |
| `scheduleOnCalendar` | ✅ | 1 | /calendar · "POST /api/scheduled" → "POST /api/scheduled" (dom) |
| `searchTransaction` | ❌ | 0 | _(not yet)_ |
| `addAndViewNote` | ❌ | 0 | _(not yet)_ |
| `searchForNote` | ❌ | 0 | _(not yet)_ |
| `clearSampleData` | ❌ | 0 | _(not yet)_ |
| `rekeyPassphrase` | ❌ | 0 | _(not yet)_ |
| `multiDbSwitcher` | ❌ | 0 | _(not yet)_ |
| `lockUnlockRoundTrip` | ❌ | 0 | _(not yet)_ |
| `savedFilterDeleteReorder` | ❌ | 0 | _(not yet)_ |

_Coverage: 0 routes mapped, 0 interactive controls catalogued, 0 in-app links discovered._

#### Smart Monkey run report

| Metric | Count |
| --- | --- |
| Total wall time | 2.9s |
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
| Goals achieved | 1 |
| Findings logged | 3 |

##### Workflows completed
- ❌ `createTransaction` — _(not yet completed)_
- ❌ `createBudget` — _(not yet completed)_
- ❌ `createSchedule` — _(not yet completed)_
- ❌ `addTenToCategory` — _(not yet completed)_
- ✅ `scheduleOnCalendar` — `/calendar` · click **POST /api/scheduled** → fill → click **POST /api/scheduled** (verified via dom)
- ❌ `searchTransaction` — _(not yet completed)_
- ❌ `addAndViewNote` — _(not yet completed)_
- ❌ `searchForNote` — _(not yet completed)_
- ❌ `clearSampleData` — _(not yet completed)_
- ❌ `rekeyPassphrase` — _(not yet completed)_
- ❌ `multiDbSwitcher` — _(not yet completed)_
- ❌ `lockUnlockRoundTrip` — _(not yet completed)_
- ❌ `savedFilterDeleteReorder` — _(not yet completed)_

#### Vitest summary

_Last run: 2026-05-20T09:26:06.823Z._

✅ **353 passed** across 38 files (13.3s).

#### Verified

_Goal verification legs that passed. Surfaced so the operator can sanity-check what the monkey looked at, without mixing into the silent-no-op questions above._

##### /calendar
- ✅ **goal "scheduleOnCalendar" — verify /calendar DOM** — DOM on /calendar contained the token "monkey-goal-mpg3pqbb-cal-sched". Calendar renders payee text per scheduled occurrence (cashflow-calendar.tsx:1368-1397), so a miss here points at either the cashflow forecast SQL (server) or the calendar's SWR query / cell-rendering layer (client).

##### /scheduled
- ✅ **goal "scheduleOnCalendar" — verify API list** — GET /api/scheduled found a row with payee "monkey-goal-mpg3pqbb-cal-sched".
- ✅ **goal "scheduleOnCalendar" — verify /scheduled DOM** — DOM on /scheduled contained the token "monkey-goal-mpg3pqbb-cal-sched".

<!-- monkey:end -->
