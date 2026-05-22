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
_Last run: 2026-05-22T01:58:42.134Z · 0 issues, 0 questions, 3 verified._

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
| `clearSampleData` | ❌ | — | 0 | — | _(not yet)_ |
| `rekeyPassphrase` | ❌ | — | 0 | — | _(not yet)_ |
| `multiDbSwitcher` | ❌ | — | 0 | — | _(not yet)_ |
| `lockUnlockRoundTrip` | ❌ | — | 0 | — | _(not yet)_ |
| `savedFilterDeleteReorder` | ❌ | — | 0 | — | _(not yet)_ |
| `resetBrowserData` | ✅ | 2026-05-22 01:58 | 1 | 1/1 (100%) | /settings?tab=security · "Reset" → "Reset & sign out" (dom) |

_Coverage: 0 routes mapped, 0 interactive controls catalogued, 0 in-app links discovered._

#### Smart Monkey run report

| Metric | Count |
| --- | --- |
| Total wall time | 1.9s |
| Routes visited | 1 |
| Button clicks | 4 |
| Switch toggles | 0 |
| Select cycles | 0 |
| Text inputs filled | 0 |
| Dialogs opened | 1 |
| Form submits | 0 |
| Links discovered | 0 |
| Console errors | 0 |
| Goals attempted | 1 |
| Goals achieved | 1 |
| Findings logged | 3 |

##### Workflows completed
- ✅ `createTransaction` — `/transactions` · click **Add Transaction** → fill → click **Save** (verified via dom)
- ❌ `createBudget` — _(not yet completed)_
- ❌ `createSchedule` — _(not yet completed)_
- ✅ `addTenToCategory` — `/transactions` · click **Add** → fill → click **Save** (verified via dom)
- ❌ `scheduleOnCalendar` — _(not yet completed)_
- ❌ `searchTransaction` — _(not yet completed)_
- ❌ `addAndViewNote` — _(not yet completed)_
- ❌ `searchForNote` — _(not yet completed)_
- ❌ `clearSampleData` — _(not yet completed)_
- ❌ `rekeyPassphrase` — _(not yet completed)_
- ❌ `multiDbSwitcher` — _(not yet completed)_
- ❌ `lockUnlockRoundTrip` — _(not yet completed)_
- ❌ `savedFilterDeleteReorder` — _(not yet completed)_
- ✅ `resetBrowserData` — `/settings?tab=security` · click **Reset** → fill → click **Reset & sign out** (verified via dom)

#### Vitest summary

_Last run: 2026-05-20T09:26:06.823Z._

✅ **353 passed** across 38 files (13.3s).

#### Verified

_Goal verification legs that passed. Surfaced so the operator can sanity-check what the monkey looked at, without mixing into the silent-no-op questions above._

##### /settings
- ✅ **goal "resetBrowserData" — cancel leg** — Confirm dialog shown; Cancel kept session alive (200) and URL on /settings (true).
- ✅ **goal "resetBrowserData" — confirm leg (redirect + sign-out)** — Landed on /login: true (url=http://0.0.0.0:3003/login); subsequent GET /api/accounts → 401 (expected 401 or 3xx → /login).
- ✅ **goal "resetBrowserData" — local-state cleanup** — localStorage.length=0, sessionStorage.length=0; theme cookie gone=true; NextAuth session cookie gone=true.

<!-- monkey:end -->
