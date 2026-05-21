<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Contributing to Budgets

Anything below is the contributor primer for both humans and AI
agents. Read it before opening a PR — the conventions here aren't
visible from the README or the surface code.

## Local dev quickstart

```bash
pnpm install
pnpm db:migrate
pnpm dev          # binds 0.0.0.0:3002
```

Required env var:

- `AUTH_SECRET` — NextAuth signing key. Generate with `openssl rand
  -hex 32`.

Optional:

- `SQLITE_PATH` — defaults to `/data/budget.db` (the container
  path). Override to `./data/budget.db` (or anywhere) for local
  dev outside a container.
- `SQLITE_KEY` — SQLCipher passphrase. If unset the app boots
  locked and redirects every request to `/unlock` until you enter
  the passphrase. For local hacking, you can set it and skip the
  unlock screen.
- `NEXTAUTH_URL` — only needed when the app is reachable on a
  hostname other than `localhost` (e.g. `http://budgets.lan`)
  for login redirects.
- `BRAVE_SEARCH_API_KEY` — Brave Search subscription token for
  the supplemental web-source announcements on the investment
  detail panel. Unset is supported — Yahoo Finance continues to
  feed the panel alone, no UI degradation. Free tier (2000 q/mo,
  1 q/s) is plenty given the 24h per-symbol cache. The same key
  can also be set per-database via Settings → General → Brave
  Search API key (DB-stored, encrypted with the rest of the
  ledger); the env var takes precedence when both are set.

Database migrations apply automatically on every unlock via
`runPendingMigrations()` in [src/db/index.ts](src/db/index.ts) —
you only need `pnpm db:migrate` for a fresh local file that's
already unlocked.

## Commit + version policy

The canonical version pointer is `APP_VERSION` in
[src/lib/version.ts](src/lib/version.ts) — **not**
`package.json`'s `version` (which is pinned so the Docker
`pnpm install` layer stays cached across releases).

- **Bump minor every shipped change.** Patch stays at `0` unless
  a real hotfix warrants it.
- Commit subject: `0.X.Y: <short title>` — atomic with the
  version bump and the CHANGELOG entry.
- Author / trailer convention:
  ```
  Author: budgets-au <budgets-au@users.noreply.github.com>
  ...
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
  (or whichever model you're collaborating with). Use the
  `budgets-au` identity for the primary author line; the
  `Co-Authored-By` trailer credits the agent.

## CHANGELOG style

[CHANGELOG.md](CHANGELOG.md) is the source of truth for what
shipped in each version. One section per version, dated, with
sub-headings `### Added`, `### Changed`, `### Fixed`, `### Removed`
as needed.

Each entry is a **bold lead-in** followed by prose:

```markdown
### Fixed
- **Bulk-category update on /transactions didn't refresh.**
  Searching, selecting all, picking a category from the toolbar
  PATCH'd the rows but the per-row CategoryPicker stayed
  showing its old trigger label until the page was refreshed.
  [...]
```

Skim a few recent entries before writing yours — the prose style
is "what changed and why" with enough specificity that someone
debugging six months later can recognise the symptom.

## File / naming conventions

- React components: **`kebab-case-*.tsx`** files; exported
  `PascalCase` symbols. Same convention for the colocated test:
  `kebab-case.test.ts` next to `kebab-case.ts(x)`.
- Tests: Vitest. Pure-logic tests sit next to source. E2E specs
  live under [tests/e2e/](tests/e2e/) and run under Playwright.
- Test fixtures (seeded books, golden datasets) live in
  [src/lib/test-fixtures/](src/lib/test-fixtures/).
- API routes: `src/app/api/<segment>/route.ts`, one file per
  HTTP endpoint, exporting named `GET` / `POST` / `PATCH` /
  `DELETE` functions.
- Hooks: `src/hooks/use-*.ts(x)`. Globally-mounted providers
  (Add-Category, Add-Account, Add-Transaction, Confirm) live in
  the same folder and are mounted once at
  [src/app/(app)/layout.tsx](src/app/(app)/layout.tsx).

## Schema migrations

- Migrations are **hand-written SQL** in [drizzle/](drizzle/),
  tracked by [drizzle/meta/_journal.json](drizzle/meta/_journal.json).
  **Do not** run `drizzle-kit generate` — the journal is the
  source of truth, not a regenerated artefact.
- The first unlock applies any pending migrations via
  `runPendingMigrations()` against the keyed SQLCipher handle.
  The migrator is idempotent and safe to re-run.
- New migration → next-numbered `0NNN_<slug>.sql` plus an entry
  appended to `drizzle/meta/_journal.json`. Use the existing
  files as a template (the journal entry format is strict).

## Display prefs are persisted, not local

If you find yourself reaching for `useState` for a user-visible
toggle, **stop** and add a key to
[src/lib/display-prefs.ts](src/lib/display-prefs.ts) instead.
Persisted state in `app_settings.display_prefs` (a JSON column on
the active DB) follows the operator across devices and sessions;
local `useState` resets on reload, drifts between browsers, and
becomes a "why didn't my pref stick?" bug a week later.

Adding a key is three small edits in the same file:

1. Add the field to the `DisplayPrefs` interface (with a JSDoc
   line that documents the semantics).
2. Add the default to `DISPLAY_PREFS_DEFAULT`.
3. Add the read to `parseDisplayPrefs` (use `bool`, `num`,
   `pickEnum`, `stringArray`, or the matching parser helper).

Consumers use `useDisplayPrefs()`:

```tsx
const { prefs, setPref } = useDisplayPrefs();
const value = prefs.myNewKey;
function onChange(next: typeof value) {
  setPref("myNewKey", next);
}
```

`setPref` writes optimistically + revalidates from the server,
so the toggle feels instant and self-corrects if the PATCH
fails.

## Multi-DB profile model

Every install can host multiple SQLCipher databases side-by-side
via [src/lib/db-profiles.ts](src/lib/db-profiles.ts) +
`databases.json` (unencrypted metadata, in the data directory).
Each DB has its own passphrase; switching profiles re-locks and
routes to `/unlock`.

When adding code that touches the on-disk DB or its backups:

- **Don't hard-code paths.** Use `livePath()` /
  `getActiveProfile()` from `src/db/index.ts` and `backupDir()`
  from [src/lib/backup/sqlite-backup.ts](src/lib/backup/sqlite-backup.ts).
- Backups live per-profile under `<base>/<profileId>/`. For
  cross-profile work (delete a profile, etc.) use
  `backupDirForProfile(id)`.
- Profile-modifying API routes (create / archive / delete) must
  guard the **active** profile and the **last remaining**
  profile — that logic lives in
  `archiveProfile()` / `deleteProfile()`.

## Gotchas worth knowing before you ship a bug

- **shadcn primitives wrap `@base-ui/react`, not Radix.**
  `Menu.Item` fires `onClick`, **not** `onSelect`. Silent no-ops
  in dropdowns / context menus almost always trace to this. See
  the canonical pattern in
  [src/components/layout/database-switcher.tsx](src/components/layout/database-switcher.tsx).
- **Theme `--primary` is near-black** (`oklch(0.205 0 0)`), not
  a coloured accent. Use indigo (`#6366f1` / `#4f46e5`, or the
  `indigo-*` Tailwind palette) when you want an accent. Pure
  `bg-blue-*` is a maintenance-day target.
- **`useState(prop)` doesn't re-sync when the prop changes.** If
  you propagate a value down via SWR + a child holds local
  state, sync via a `lastSeenProp` ref + `useEffect` so external
  cache updates flow into the child. Canonical pattern at
  [src/components/transactions/category-picker.tsx](src/components/transactions/category-picker.tsx).
- **Don't read `localStorage` in a `useState` initializer.**
  SSR / client hydration mismatch. Initialize with the default,
  sync from storage inside `useEffect`.
- **SWR optimistic updates** want the function-updater form:
  `mutate(key, (current) => next, { revalidate: true })`. The
  cache lands synchronously so every subscriber sees the new
  value on the same React tick; a background revalidation still
  reconciles with the server.
- **Avoid stale-closure bugs when an async callback fires after
  prop refreshes.** If a handler captures `categories` (or any
  SWR-driven prop) and runs after an async POST, it'll read the
  closure-time value, not the latest. Sync via a ref inline
  (`categoriesRef.current = categories` at the top of the
  component) and read `.current` inside the handler.
- **Hover-only controls need a touch fallback.** Use
  `lg:opacity-0 lg:group-hover:opacity-100` (NOT bare
  `opacity-0 group-hover:opacity-100`) so the control stays
  visible on touch viewports that don't have `:hover`.
- **Safari renders form inputs wider than Chrome.** Test both;
  use `min-w-*` not `basis-*` in `flex-wrap`; reset native
  date/number input chrome in `globals.css`.
- **Tests for new behaviour are non-optional.** Pair tests with
  refactors / bug fixes / perf work. Vitest is already wired up
  (`pnpm test`). The repo has ~300 unit tests; one or two new
  ones with every feature is the floor.
- **Avoid TDZ cycles into [src/db/index.ts](src/db/index.ts).**
  A top-level `import { db } from "@/db"` in a module reachable
  from the unlock path can be bundled by webpack into a cycle
  that crashes production with `ReferenceError: Cannot access
  'al' before initialization`. Use a lazy `require()` inside
  the function for modules called from `unlock()` /
  `runPendingMigrations()`.

## Testing

| Command | What it runs |
| --- | --- |
| `pnpm test` | Vitest single pass (unit + colocated integration) |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:e2e` | Playwright suite — pages-smoke, monkey crawl, saved filters, dashboard, screenshots |

The E2E rig builds a separate `.next-e2e` (controlled by
`E2E_TEST_BUILD=1` in `next.config.ts`) so it doesn't fight
`pnpm dev`'s `.next` lock.

`tests/e2e/monkey.spec.ts` is the "1000 monkeys" exploratory
crawl that visits each page, toggles every switch / select, fills
every form with `monkey-test` / `42` / `2026-01-01`, and writes
findings into the `<!-- monkey:start -->` block in `TODO.md`.
Re-run it before triaging the findings — they're snapshots, not
truths.

## Release flow

Releases are the trio of `version.ts` + CHANGELOG + commit:

1. Bump `APP_VERSION` in
   [src/lib/version.ts](src/lib/version.ts).
2. Append a CHANGELOG entry under a new `## X.Y.Z — YYYY-MM-DD`
   heading.
3. Commit with the `0.X.Y: short title` shape (see Commit policy
   above).

Then build + push the image:

```bash
DOCKER_REGISTRY=<your-target> pnpm docker:release
```

[scripts/docker-release.mjs](scripts/docker-release.mjs) builds
once and pushes three tags pointing at the same digest:

- `:<semver>` — human handle.
- `:<short-sha>` — immutable per commit. **Pin cluster
  manifests to this.**
- `:latest` — mutable convenience pointer.

Safety:

- Refuses to push from a dirty tree. Override with
  `--allow-dirty` only if you really mean it.
- `--dry-run` prints the planned commands without executing.
- Runtime auto-detects between `docker` and `podman`; override
  with `CONTAINER_RUNTIME=...`.

For public releases, also tag + cut a GitHub Release:

```bash
git tag v${VERSION}
git push origin v${VERSION}
gh release create v${VERSION} --title "v${VERSION} — <title>" \
  --notes "<container block + CHANGELOG section + upgrade hints>"
```

See any of the past releases at
[github.com/budgets-au/budgets/releases](https://github.com/budgets-au/budgets/releases)
for the body shape.

## TODO.md

[TODO.md](TODO.md) is the running scratchpad — half-baked ideas,
known bugs, follow-ups, monkey-crawl findings. The convention is
to **move** completed items down into the dated "Done /
dropped" section with a one-line note rather than vanishing
them; keeps institutional memory around for the next reader.
