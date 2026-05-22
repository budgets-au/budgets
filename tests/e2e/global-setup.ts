import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";

/** Spin up a fresh, fully-migrated SQLCipher DB for the E2E tier.
 *
 * Runs once before any test. Uses a fixed test key + a project-local
 * path so the live dev DB at `/data/budget.db` is never touched.
 * The next-server `webServer` block in `playwright.config.ts` reads
 * the same env values to point its in-memory state at the same DB.
 *
 * Idempotent: rebuilds from scratch every run to avoid drift from
 * a previous failed test leaving stale rows around. */
export default async function globalSetup(): Promise<void> {
  const dbPath = process.env.E2E_SQLITE_PATH ?? resolve("./tests/e2e/.data/test.db");
  const key =
    process.env.E2E_SQLITE_KEY ??
    "0000000000000000000000000000000000000000000000000000000000000000";

  // Rebuild from scratch each run — the goal is a deterministic
  // starting state, not preserving test data.
  mkdirSync(dirname(dbPath), { recursive: true });
  if (existsSync(dbPath)) rmSync(dbPath);
  // -wal, -shm, AND -journal: a crashed prior run can leave the
  // DELETE-mode journal orphaned; SQLite's open-time recovery would
  // try to roll it back under a contended lock. Issue #81's secondary
  // fix list.
  for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
    if (existsSync(sidecar)) rmSync(sidecar);
  }

  // Apply all drizzle migrations to the fresh DB. Re-uses the same
  // migrate.ts script the deploy pipeline uses, so the test DB ends
  // up structurally identical to production.
  execSync("npx tsx scripts/migrate.ts", {
    env: {
      ...process.env,
      SQLITE_PATH: dbPath,
      SQLITE_KEY: key,
    },
    stdio: "inherit",
  });

  // Echo the path/key so the webServer block can pick them up. Set
  // on process.env (Playwright forwards it to the webServer).
  process.env.E2E_SQLITE_PATH = dbPath;
  process.env.E2E_SQLITE_KEY = key;

  // Clear the previous run's monkey findings so this run starts
  // fresh. Both monkey-goals.spec and monkey.spec append into the
  // same report; wiping it here (instead of in either spec's
  // beforeAll) keeps the two specs from clobbering each other
  // regardless of alphabetical execution order.
  //
  // NOTE: tests/e2e/.data/app-map.json is NOT wiped — it accrues
  // learning across runs by design. Schema-version bumps in
  // _app-map.ts invalidate stale maps; everything else carries
  // forward.
  const reportPath = resolve("./tests/e2e/.data/monkey-report.json");
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, "[]");
}
