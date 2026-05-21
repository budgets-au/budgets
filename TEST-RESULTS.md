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
_Last run: 2026-05-21T23:44:05.310Z · 0 issues, 1 question, 0 verified._

#### Smart Monkey expert system

| Goal | Achieved | Last attempt | Total attempts | Pass rate | Last successful run |
| --- | --- | --- | --- | --- | --- |
| `createTransaction` | ❌ | — | 0 | — | _(not yet)_ |
| `createBudget` | ❌ | — | 0 | — | _(not yet)_ |
| `createSchedule` | ❌ | — | 0 | — | _(not yet)_ |
| `addTenToCategory` | ❌ | — | 0 | — | _(not yet)_ |
| `scheduleOnCalendar` | ❌ | — | 0 | — | _(not yet)_ |
| `searchTransaction` | ❌ | — | 0 | — | _(not yet)_ |
| `addAndViewNote` | ❌ | — | 0 | — | _(not yet)_ |
| `searchForNote` | ❌ | — | 0 | — | _(not yet)_ |
| `clearSampleData` | ❌ | — | 0 | — | _(not yet)_ |
| `rekeyPassphrase` | ❌ | — | 0 | — | _(not yet)_ |
| `multiDbSwitcher` | ❌ | — | 0 | — | _(not yet)_ |
| `lockUnlockRoundTrip` | ❌ | — | 0 | — | _(not yet)_ |
| `savedFilterDeleteReorder` | ❌ | — | 0 | — | _(not yet)_ |

_Coverage: 10 routes mapped, 319 interactive controls catalogued, 82 in-app links discovered._

#### Smart Monkey run report

| Metric | Count |
| --- | --- |
| Total wall time | 108.5s |
| Routes visited | 10 |
| Button clicks | 161 |
| Switch toggles | 11 |
| Select cycles | 3 |
| Text inputs filled | 5 |
| Dialogs opened | 38 |
| Form submits | 2 |
| Links discovered | 105 |
| Console errors | 0 |
| Goals attempted | 0 |
| Goals achieved | 0 |
| Findings logged | 1 |

##### Workflows completed
- ❌ `createTransaction` — _(not yet completed)_
- ❌ `createBudget` — _(not yet completed)_
- ❌ `createSchedule` — _(not yet completed)_
- ❌ `addTenToCategory` — _(not yet completed)_
- ❌ `scheduleOnCalendar` — _(not yet completed)_
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

#### Questions for review

_The crawl filled these forms and clicked their submit, but saw no network call, toast, or navigation. Possibly a silent no-op bug, possibly intentional — decide which._

##### /superannuation
- ❓ **submit "Save"** — Filled 3 inputs and clicked **Save** — no network call, toast, or navigation fired. Should it have?

<!-- monkey:end -->
