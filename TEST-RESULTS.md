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
_Last run: 2026-08-13T12:43:09.127Z · 2 issues, 0 questions, 23 verified._

#### Smart Monkey expert system

| Goal | Achieved | Last attempt | Total attempts | Pass rate | Last successful run |
| --- | --- | --- | --- | --- | --- |
| `createTransaction` | ✅ | 2026-08-13 12:42 | 9 | 9/9 (100%) | /transactions · "Add transaction" → "Add" (dom) |
| `createBudget` | ✅ | 2026-08-13 12:42 | 9 | 9/9 (100%) | /scheduled · "New scheduled transaction" → "Create" (dom) |
| `createSchedule` | ✅ | 2026-08-13 12:42 | 9 | 5/9 (56%) | /scheduled · "New scheduled transaction" → "Create" (dom) |
| `addTenToCategory` | ✅ | 2026-08-13 12:42 | 9 | 9/9 (100%) | /transactions · "POST /api/transactions × 10" → "POST /api/transactions" (api) |
| `scheduleOnCalendar` | ✅ | 2026-08-13 12:42 | 9 | 9/9 (100%) | /calendar · "POST /api/scheduled" → "POST /api/scheduled" (dom) |
| `searchTransaction` | ✅ | 2026-08-13 12:42 | 9 | 9/9 (100%) | /transactions · "?search=monkey-goal-msrichxb-search-payee" → "GET /api/transactions?search=…" (dom) |
| `addAndViewNote` | ✅ | 2026-08-13 12:42 | 9 | 9/9 (100%) | /transactions · "POST /api/transactions (with notes)" → "GET /api/transactions" (dom) |
| `searchForNote` | ✅ | 2026-08-13 12:42 | 9 | 9/9 (100%) | /transactions · "?search=find-me-monkey-goal-msrichxb (notes-only)" → "GET /api/transactions?search=…" (dom) |
| `clearSampleData` | ✅ | 2026-08-13 12:42 | 9 | 9/9 (100%) | /settings · "POST /api/sample-data/remove" → "POST /api/sample-data/remove" (api) |
| `rekeyPassphrase` | ✅ | 2026-08-13 12:42 | 9 | 9/9 (100%) | /settings · "POST /api/rekey" → "POST /api/rekey" (api) |
| `multiDbSwitcher` | ✅ | 2026-08-13 12:42 | 9 | 9/9 (100%) | /dashboard · "Switcher → Create new database…" → "Create + switch back to Default" (dom) |
| `lockUnlockRoundTrip` | ❌ | 2026-08-13 12:42 | 9 | 0/9 (0%) | _(not yet)_ |
| `savedFilterDeleteReorder` | ✅ | 2026-08-13 12:42 | 9 | 9/9 (100%) | /transactions · "Saved Filters → trash icon on M-entry" → "PATCH /api/display-prefs (via setPref)" (dom) |
| `resetBrowserData` | ✅ | 2026-08-13 12:42 | 9 | 9/9 (100%) | /settings?tab=security · "Reset" → "Reset & sign out" (dom) |
| `addSampleData` | ✅ | 2026-08-13 12:42 | 9 | 9/9 (100%) | /settings · "seedSampleDataIfMissing() on first unlock" → "GET /api/sample-data/remove" (api) |

_Coverage: 12 routes mapped, 434 interactive controls catalogued, 112 in-app links discovered._

#### Smart Monkey run report

| Metric | Count |
| --- | --- |
| Total wall time | 37.0s |
| Routes visited | 7 |
| Button clicks | 11 |
| Switch toggles | 0 |
| Select cycles | 0 |
| Text inputs filled | 17 |
| Dialogs opened | 4 |
| Form submits | 14 |
| Links discovered | 0 |
| Console errors | 0 |
| Goals attempted | 15 |
| Goals achieved | 14 |
| Findings logged | 25 |

#### Vitest summary

_Last run: 2026-08-13T12:41:28.187Z._

✅ **733 passed**, 10 skipped across 73 files (4.6s).

#### Issues

##### /settings
- 🔴 **goal "rekeyPassphrase" — revert leg** — Revert POST /api/rekey 1111…→0000… returned 400. Next next-start boot may fail to unlock.
- 🔴 **goal "lockUnlockRoundTrip" — POST /api/unlock** — POST /api/unlock → 200; post-unlock GET /api/accounts → 401 body: {"error":"Unauthorized"}.

#### Verified

_Goal verification legs that passed. Surfaced so the operator can sanity-check what the monkey looked at, without mixing into the silent-no-op questions above._

##### /calendar
- ✅ **goal "scheduleOnCalendar" — verify cashflow projection** — GET /api/cashflow projected an occurrence with payee "monkey-goal-msrichxb-cal-sched" on 2026-08-13. Day had 1 scheduledEvents in total. Pre-POST claim-match candidates (-$50 ±3 days, same account): none.
- ✅ **goal "scheduleOnCalendar" — verify /calendar DOM** — DOM on /calendar contained the token "monkey-goal-msrichxb-cal-sched". Layer: ok.

##### /dashboard
- ✅ **goal "multiDbSwitcher" — create + auto-switch** — POST /api/databases → 200; new profile "MD-msrichxb" is the active one.

##### /reports
- ✅ **goal "addTenToCategory" — verify category report total** — Cashflow report for category "Bank Fees" — totalCount=10 (expected 10), |total|=250 (expected 250.00).

##### /scheduled
- ✅ **goal "scheduleOnCalendar" — verify API list** — GET /api/scheduled found a row with payee "monkey-goal-msrichxb-cal-sched".
- ✅ **goal "scheduleOnCalendar" — verify /scheduled DOM** — DOM on /scheduled contained the token "monkey-goal-msrichxb-cal-sched".

##### /settings
- ✅ **goal "addSampleData" — verify counts** — GET /api/sample-data/remove → 200; sampleAccounts=2, sampleTransactions=25, sampleScheduled=3 (expected all > 0).
- ✅ **goal "addSampleData" — verify account isSample tagging** — GET /api/accounts returned 3 row(s); 2 carry isSample=true (expected ≥1 — others may be the External auto-account).
- ✅ **goal "clearSampleData" — wipe round-trip** — Before: accts=2 txns=25 schedules=3. Wipe OK ({"sampleAccounts":0,"sampleTransactions":0,"sampleScheduled":0,"samplePayeeRules":0,"dependentNonSample":{"transactions":0,"scheduled":0},"sampleDataSeeded":true}). After: accts=0 txns=0 schedules=0 seededFlag=true.
- ✅ **goal "rekeyPassphrase" — reject wrong current** — POST /api/rekey with wrong current → 400 (rejected as expected).
- ✅ **goal "rekeyPassphrase" — reject too-short next** — POST /api/rekey with next="short" → 400 (rejected as expected).
- ✅ **goal "rekeyPassphrase" — rotate and keep session** — POST /api/rekey → 200; post-rotate GET /api/accounts → 200.
- ✅ **goal "lockUnlockRoundTrip" — POST /api/lock** — POST /api/lock → 200; subsequent GET /api/accounts → 307 Location:/unlock?next=%2Fapi%2Faccounts (expected 3xx → /unlock).
- ✅ **goal "resetBrowserData" — cancel leg** — Confirm dialog shown; Cancel kept session alive (200) and URL on /settings (true).
- ✅ **goal "resetBrowserData" — confirm leg (redirect + sign-out)** — Landed on /login: true (url=http://0.0.0.0:3003/login); subsequent GET /api/accounts → 401 (expected 401 or 3xx → /login).
- ✅ **goal "resetBrowserData" — local-state cleanup** — localStorage.length=0, sessionStorage.length=0; theme cookie gone=true; NextAuth session cookie gone=true.

##### /transactions
- ✅ **goal "addTenToCategory" — verify list (API)** — GET /api/transactions found 10/10 rows matching "monkey-goal-msrichxb-bulk-*".
- ✅ **goal "addTenToCategory" — verify list (DOM)** — DOM on /transactions contained 10 matches for "monkey-goal-msrichxb-bulk-".
- ✅ **goal "searchTransaction" — verify search filters to payee** — API matched + DOM rendered payee "monkey-goal-msrichxb-search-payee" with search=monkey-goal-msrichxb-search-payee.
- ✅ **goal "addAndViewNote" — note round-trips API + DOM** — API echoed notes + DOM rendered "note-from-monkey-goal-msrichxb".
- ✅ **goal "searchForNote" — ?search= matches notes column** — API matched + DOM rendered the matching row for notes-only needle "find-me-monkey-goal-msrichxb".
- ✅ **goal "savedFilterDeleteReorder" — delete M-entry** — After click-delete on "M-monkey-goal-msrichxb-middle", server prefs has 2/2 expected entries: [z-monkey-goal-msrichxb, a-monkey-goal-msrichxb].

##### /unlock
- ✅ **goal "multiDbSwitcher" — switch back to Default** — After switch+unlock, activeProfileId=default (expected default).

<!-- monkey:end -->
