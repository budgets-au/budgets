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
_No monkey-crawl findings on the last run._
<!-- monkey:end -->

- _none open_

## Ideas

### Dashboard / widgets
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

- 2026-05-15: **Category-spend dashboard widget.** Shipped 0.79.0.
  Single-category multiInstance tile; picks a category in edit
  mode, renders total + count over the last 30 days, links into
  the transactions list filtered to that category. Rolls up
  descendants by default (matches cashflow report semantics).
- 2026-05-15: **Per-account balance-trend widget.** Shipped 0.60
  → 0.68 as the "Account" widget — multiInstance, picks an
  account (including archived), shows balance + institution +
  7-day running-balance area sparkline.
- 2026-05-14: **Multiple instances of the same widget type.**
  Shipped 0.55 as `WidgetSpec.multiInstance`. Tracked-stock was
  the first opt-in; the saved layout now carries a UUID
  `instanceId` per placement so RGL keys don't collide.
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
