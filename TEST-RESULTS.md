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
_Last run: 2026-05-22T00:04:58.153Z · 2 issues, 0 questions, 18 verified._

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
| Total wall time | 376.7s |
| Routes visited | 6 |
| Button clicks | 0 |
| Switch toggles | 0 |
| Select cycles | 0 |
| Text inputs filled | 0 |
| Dialogs opened | 0 |
| Form submits | 11 |
| Links discovered | 0 |
| Console errors | 0 |
| Goals attempted | 13 |
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

#### Issues

##### /settings
- 🔴 **goal "rekeyPassphrase" — revert leg** — Revert POST /api/rekey 1111…→0000… returned 400. Next next-start boot may fail to unlock.
- 🔴 **goal "lockUnlockRoundTrip" — POST /api/unlock** — POST /api/unlock → 200; post-unlock GET /api/accounts → 401 body: {"error":"Unauthorized"}.

#### Verified

_Goal verification legs that passed. Surfaced so the operator can sanity-check what the monkey looked at, without mixing into the silent-no-op questions above._

##### /calendar
- ✅ **goal "scheduleOnCalendar" — verify cashflow projection** — GET /api/cashflow projected an occurrence with payee "monkey-goal-mpg5qxq8-cal-sched" on 2026-05-22. Day had 1 scheduledEvents in total. Pre-POST claim-match candidates (-$50 ±3 days, same account): none.
- ✅ **goal "scheduleOnCalendar" — verify /calendar DOM** — DOM on /calendar contained the token "monkey-goal-mpg5qxq8-cal-sched". Layer: ok.

##### /dashboard
- ✅ **goal "multiDbSwitcher" — create + auto-switch** — POST /api/databases → 200; new profile "MD-mpg5qxq8" is the active one.

##### /reports
- ✅ **goal "addTenToCategory" — verify category report total** — Cashflow report for category "Bank Fees" — totalCount=10 (expected 10), |total|=250 (expected 250.00).

##### /scheduled
- ✅ **goal "scheduleOnCalendar" — verify API list** — GET /api/scheduled found a row with payee "monkey-goal-mpg5qxq8-cal-sched".
- ✅ **goal "scheduleOnCalendar" — verify /scheduled DOM** — DOM on /scheduled contained the token "monkey-goal-mpg5qxq8-cal-sched".

##### /settings
- ✅ **goal "clearSampleData" — wipe round-trip** — Before: accts=2 txns=25 schedules=3. Wipe OK ({"sampleAccounts":0,"sampleTransactions":0,"sampleScheduled":0,"samplePayeeRules":0,"dependentNonSample":{"transactions":0,"scheduled":0},"sampleDataSeeded":true}). After: accts=0 txns=0 schedules=0 seededFlag=true.
- ✅ **goal "rekeyPassphrase" — reject wrong current** — POST /api/rekey with wrong current → 400 (rejected as expected).
- ✅ **goal "rekeyPassphrase" — reject too-short next** — POST /api/rekey with next="short" → 400 (rejected as expected).
- ✅ **goal "rekeyPassphrase" — rotate and keep session** — POST /api/rekey → 200; post-rotate GET /api/accounts → 200.
- ✅ **goal "lockUnlockRoundTrip" — POST /api/lock** — POST /api/lock → 200; subsequent GET /api/accounts → 307 Location:/unlock?next=%2Fapi%2Faccounts (expected 3xx → /unlock).

##### /transactions
- ✅ **goal "addTenToCategory" — verify list (API)** — GET /api/transactions found 10/10 rows matching "monkey-goal-mpg5qxq8-bulk-*".
- ✅ **goal "addTenToCategory" — verify list (DOM)** — DOM on /transactions contained 10 matches for "monkey-goal-mpg5qxq8-bulk-".
- ✅ **goal "searchTransaction" — verify search filters to payee** — API matched + DOM rendered payee "monkey-goal-mpg5qxq8-search-payee" with search=monkey-goal-mpg5qxq8-search-payee.
- ✅ **goal "addAndViewNote" — note round-trips API + DOM** — API echoed notes + DOM rendered "note-from-monkey-goal-mpg5qxq8".
- ✅ **goal "searchForNote" — ?search= matches notes column** — API matched + DOM rendered the matching row for notes-only needle "find-me-monkey-goal-mpg5qxq8".
- ✅ **goal "savedFilterDeleteReorder" — delete M-entry** — After click-delete on "M-monkey-goal-mpg5qxq8-middle", server prefs has 2/2 expected entries: [z-monkey-goal-mpg5qxq8, a-monkey-goal-mpg5qxq8].

##### /unlock
- ✅ **goal "multiDbSwitcher" — switch back to Default** — After switch+unlock, activeProfileId=default (expected default).

<!-- monkey:end -->
