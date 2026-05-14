# TODO

Running scratchpad of ideas, half-baked thoughts, known bugs and
follow-up work. Triaged loosely — promote anything that's lined
up for "next session" into the top section.

> Convention: when you fix or drop an item, move it to the bottom
> under **Done / dropped** with a one-line note so we keep
> institutional memory rather than vanishing the context.

## Up next

- (none queued; add as you find them)

## Known bugs / regressions to investigate

### 1000-monkeys crawl findings

<!-- monkey:start -->
_Last run: 2026-05-14T01:57:46.817Z · 11 findings._

### /calendar
- 🔴 **(console)** — a: Failed to fetch. Read more at https://errors.authjs.dev#autherror at s (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:1008) at async b (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:2220) at async d._getSession (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:2:1656)

### /categories
- 🔴 **(console)** — a: Failed to fetch. Read more at https://errors.authjs.dev#autherror at s (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:1008) at async b (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:2220) at async d._getSession (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:2:1656)

### /dashboard
- 🔴 **(console)** — a: Failed to fetch. Read more at https://errors.authjs.dev#autherror at s (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:1008) at async b (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:2220) at async d._getSession (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:2:1656)

### /investments
- 🔴 **(console)** — a: Failed to fetch. Read more at https://errors.authjs.dev#autherror at s (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:1008) at async b (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:2220) at async d._getSession (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:2:1656)

### /reports
- 🔴 **(console)** — a: Failed to fetch. Read more at https://errors.authjs.dev#autherror at s (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:1008) at async b (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:2220) at async d._getSession (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:2:1656)

### /scheduled
- 🔴 **(console)** — a: Failed to fetch. Read more at https://errors.authjs.dev#autherror at s (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:1008) at async b (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:2220) at async d._getSession (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:2:1656)
- 🔴 **toggle "Use min/max amount range"** — Switch did not persist across reload (was true, became false).
- 🔴 **toggle "Pause schedule"** — Switch did not persist across reload (was false, became true).

### /settings
- 🔴 **(console)** — a: Failed to fetch. Read more at https://errors.authjs.dev#autherror at s (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:1008) at async b (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:2220) at async d._getSession (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:2:1656)

### /superannuation
- 🔴 **(console)** — a: Failed to fetch. Read more at https://errors.authjs.dev#autherror at s (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:1008) at async b (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:2220) at async d._getSession (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:2:1656)

### /transactions
- 🔴 **(console)** — a: Failed to fetch. Read more at https://errors.authjs.dev#autherror at s (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:1008) at async b (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:1:2220) at async d._getSession (http://0.0.0.0:3003/_next/static/chunks/0jiypb2yyeh_v.js:2:1656)

<!-- monkey:end -->

- _none open_

## Ideas

### Dashboard / widgets
- Multiple instances of the same widget type — right now `onDrop`
  rejects a duplicate widget id. Tracked-stock is the only widget
  where this matters; would need stable per-instance ids in the
  saved layout (today the RGL `i` collides with the registry id).
- Account-balance-trend widget (per-account, like net-worth-trend
  but scoped). Needs per-instance config (`accountId`).
- Category-spend widget (single category over a window).
- Sticky widget order on mobile — the responsive grid wraps to
  one column; preserve a saved priority rather than reading off
  the `lg` layout.

### Settings
- Palette editor for the OTHER chart types — cashflow, calendar,
  Sankey. Same pattern as the schedule-chart palette editor.
- "Show advanced" toggle to hide grace-days / match-window inputs
  by default.

### Reports / scheduled / etc.
- (placeholders — add as you walk the app and find rough edges)

### Infrastructure / tests
- Expand E2E coverage:
  - Transactions: add a transaction via UI, verify it appears in
    the list and updates the dashboard total.
  - Scheduled: add a scheduled txn via the global "+ scheduled"
    dialog, verify it appears on /scheduled and the calendar.
  - Reports: walk each tab (Cashflow / Sankey / Envelope / YoY),
    confirm no console errors with seeded data.
  - Settings → Reset browser data: verify the action signs the
    operator out and lands them on /login.
- Seed-data fixtures: helpers under `tests/e2e/_seed.ts` for
  inserting accounts / transactions / categories so tests aren't
  forced to drive the UI through every setup step.
- Visual regression — Playwright + screenshots — at least on the
  dashboard with each chart palette applied.

## Architecture notes / risks

- Recharts 3.x bundles react-redux for its internal store. Any
  widget that mounts a `ResponsiveContainer` inside a layout that
  resizes rapidly (RGL drag, window resize during animation, etc.)
  risks the same subscriber-loop crash. The fix in 0.48 is to
  swap the chart for a static placeholder while `editMode` is on.
  If we add new chart-rendering widgets, they MUST follow the
  same pattern.
- Drizzle migrations are hand-applied via `npm run db:migrate`
  (which needs the SQLCipher key in env). The deploy image runs
  this on startup; dev machines have to remember.
- `next dev` holds a lock on `.next`, so the E2E rig uses a
  separate `.next-e2e` build dir (toggled via `E2E_TEST_BUILD=1`
  in `next.config.ts`).

## Done / dropped

- 2026-05-13: **React error #185 "Maximum update depth exceeded"
  when adding any dashboard widget.** Symptom: edit dashboard,
  drag any pill from the drawer, page crashes with the error
  overlay. Confirmed reproducible from `tests/e2e/dashboard-edit
  .spec.ts` "multi-step slow drag" case. Root cause: recharts
  3.x's react-redux store fires nested subscriber notifications
  every time its `ResponsiveContainer` resizes; RGL was resizing
  every chart cell on every drag-over event. Fix in 0.48: the
  chart inside `net-worth-trend-card` and `tracked-stock-card`
  is replaced with a "Chart hidden while editing" placeholder
  when `editMode === true`.
- 2026-05-13: **E2E rig set up.** Playwright + headless chromium
  + fresh SQLCipher DB at `tests/e2e/.data/test.db` + Next
  production build under `.next-e2e/` so the live dev server is
  untouched. Three spec files: `dashboard-widgets`,
  `dashboard-edit`, `pages-smoke`. Run with `npm run test:e2e`.
