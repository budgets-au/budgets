import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "@signalapp/better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { hashSync } from "bcryptjs";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import {
  accounts,
  appSettings,
  categories,
  scheduledTransactions,
  transactions,
} from "./schema";
import { describeOpenError } from "./open-error";
import { DEFAULT_CATEGORIES } from "./default-categories";
import { buildSampleData } from "./sample-data";
import {
  activeLivePath,
  getActiveProfile,
  pathForProfile,
  readRegistry,
  setActiveProfileId,
} from "@/lib/db-profiles";

/** Where the live database lives — derived from the active profile in
 * the registry. The backup module + restore flow call this to copy
 * from / swap to the on-disk file. Falls back to the SQLITE_PATH
 * basename via the default profile when no registry exists yet. */
export function livePath(): string {
  return activeLivePath();
}

/**
 * Lock state for the SQLCipher passphrase. The app boots in LOCKED
 * mode — no DB connection is opened until `unlock(passphrase)` is
 * called with a working key. While locked, importing `db` is fine
 * (the module loads); but any actual query throws `DbLockedError`.
 *
 * Two unlock paths:
 *   - Set `SQLITE_KEY` in the env at startup → auto-unlock on first
 *     module load (the existing flow; useful for containers where the
 *     orchestrator injects the key from a secret store).
 *   - POST the passphrase to `/api/unlock` after the server is up →
 *     interactive flow for personal-use deployments where the user
 *     wants to keep the key off disk.
 *
 * The key lives in `state.client` — i.e. inside the better-sqlite3
 * connection's internal SQLCipher state — and isn't exposed via the
 * module. Stopping the process drops it.
 */
type Schema = typeof schema;
type DrizzleDb = BetterSQLite3Database<Schema>;

interface DbState {
  client: BetterSqlite3.Database | null;
  drizzleDb: DrizzleDb | null;
  /** Id of the profile whose file `client` is currently keyed against.
   * Compared against `getActiveProfile().id` on every unlock to detect
   * a profile switch that happened while the connection was held —
   * if they differ, the old connection is dropped so the new one
   * opens the right file. */
  openProfileId: string | null;
}

// Pin the lock state to globalThis ALWAYS, not just in dev. In prod
// Next.js's bundler can load this module into multiple chunks (the
// API routes are one bundle; the proxy/middleware is another). Each
// chunk's module evaluation creates its own `state` literal — so
// /api/unlock setting state.client in the route bundle doesn't make
// isUnlocked() in the middleware bundle return true. Result: the
// user unlocks successfully, then gets redirected straight back to
// /unlock by the middleware's stale state.
//
// globalThis is the same object across every chunk in the same Node
// process, so reading/writing through it gives one shared state
// regardless of how the bundler split things up. The dev path used
// this for HMR survival; the prod path needs it for chunk-boundary
// survival.
const globalForDb = globalThis as unknown as { __dbState?: DbState };
const state: DbState = globalForDb.__dbState ?? {
  client: null,
  drizzleDb: null,
  openProfileId: null,
};
globalForDb.__dbState = state;

export class DbLockedError extends Error {
  constructor() {
    super(
      "Database is locked. Visit /unlock and provide the passphrase before " +
        "any other route can read or write data.",
    );
    this.name = "DbLockedError";
  }
}

export function isUnlocked(): boolean {
  return state.client !== null;
}

/** True when a SQLCipher file is already present at the active
 * profile's path. Used by /api/unlock to tell the unlock page
 * whether this is a first-run scenario (no file → typing a
 * passphrase CREATES the DB) or an existing-DB unlock (typing the
 * wrong passphrase fails). */
export function dbExists(): boolean {
  return existsSync(livePath());
}

/** Direct access to the underlying better-sqlite3 handle. Used by the
 * backup module — `client.backup(path)` runs SQLite's online backup
 * API and `client.close()` is needed during a restore swap. Throws
 * `DbLockedError` when the DB hasn't been unlocked yet so callers
 * never have to null-check. */
export function getClient(): BetterSqlite3.Database {
  if (!state.client) {
    throw new DbLockedError();
  }
  return state.client;
}

type OpenResult =
  | { ok: true; client: BetterSqlite3.Database }
  | { ok: false; error: string };

/**
 * Open a fresh connection keyed with the supplied passphrase and
 * verify it can decrypt the file. Returns the keyed Database on
 * success or a structured error on filesystem / wrong-key failure.
 * Caller is responsible for closing or promoting the returned
 * handle.
 */
function openWithKey(passphrase: string): OpenResult {
  if (!passphrase) {
    return { ok: false, error: "Passphrase is required." };
  }
  const path = livePath();
  let client: BetterSqlite3.Database | undefined;
  try {
    mkdirSync(dirname(path), { recursive: true });
    client = new Database(path) as unknown as BetterSqlite3.Database;
    // PRAGMA key MUST be the very first statement on the connection,
    // before any read or write.
    client.pragma(`key = '${passphrase.replace(/'/g, "''")}'`);
    client.pragma("cipher_compatibility = 4");
    // SELECT against sqlite_master forces SQLCipher to decrypt at
    // least one page; a wrong key surfaces here as
    // "file is not a database".
    client.prepare("SELECT count(*) AS n FROM sqlite_master").get();
    return { ok: true, client };
  } catch (err) {
    try {
      client?.close();
    } catch {
      /* ignore */
    }
    return { ok: false, error: describeOpenError(err, path) };
  }
}

/**
 * Validate the passphrase by opening a fresh connection. If the file
 * isn't already unlocked in this process, promote the verified
 * connection to the live one. If it is already unlocked, the supplied
 * passphrase still has to round-trip the file — we never trust the
 * "already unlocked" state alone because /api/unlock is intentionally
 * unauthenticated, and a permissive shortcut would let any caller
 * succeed with any string after the first real unlock.
 */
export function unlock(
  passphrase: string,
): { ok: true } | { ok: false; error: string } {
  const probe = openWithKey(passphrase);
  if (!probe.ok) return probe;

  const activeId = getActiveProfile().id;
  // If a stale connection is still open against a DIFFERENT profile —
  // e.g. the operator called switchProfile() but didn't unlock the
  // new one — drop it first so the in-memory client always matches
  // the active profile id.
  if (state.client && state.openProfileId && state.openProfileId !== activeId) {
    try {
      state.client.close();
    } catch {
      /* ignore */
    }
    state.client = null;
    state.drizzleDb = null;
    state.openProfileId = null;
  }

  if (state.client) {
    // Already keyed in this process (and against the same profile).
    // The probe confirmed the supplied passphrase opens the file, so
    // the state stays — discard the probe handle and reuse the live
    // connection.
    try {
      probe.client.close();
    } catch {
      /* ignore */
    }
    // Even on the already-unlocked path, run pending migrations —
    // drizzle's migrator is idempotent and this lets a freshly-shipped
    // schema change self-apply when the running process re-unlocks
    // (e.g. after HMR shipped a fix without restarting the server).
    runPendingMigrations();
    seedDefaultUserIfMissing();
    seedSystemCategoriesIfMissing();
    seedSampleDataIfMissing();
    runOrphanTransferBackfill();
    runLegacyBackupMigration();
    return { ok: true };
  }

  // Promote: apply the live-connection pragmas and stash globally.
  probe.client.pragma("journal_mode = WAL");
  probe.client.pragma("foreign_keys = ON");
  probe.client.pragma("busy_timeout = 5000");
  state.client = probe.client;
  state.drizzleDb = drizzle(probe.client, { schema });
  state.openProfileId = activeId;

  runPendingMigrations();
  seedDefaultUserIfMissing();
  seedSystemCategoriesIfMissing();
  seedSampleDataIfMissing();
  runOrphanTransferBackfill();
  runLegacyBackupMigration();

  return { ok: true };
}

/** Move any legacy backup files (sitting at `<base>/budgets_*.sqlite`
 *  from the single-DB layout) into `<base>/default/` so the
 *  per-profile backup layout takes over. Lazy-imported to avoid a
 *  cycle with the backup module. Errors are logged but never thrown. */
function runLegacyBackupMigration(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("@/lib/backup/sqlite-backup");
    m.migrateLegacyBackups();
  } catch (e) {
    console.error("[db] Legacy-backup migration failed:", e);
  }
}

/**
 * Switch the active profile. Closes the currently-open connection
 * (re-unlock-on-switch semantics), updates the registry's active
 * pointer, and returns. The next request will hit DbLockedError and
 * the proxy/middleware will redirect to /unlock against the newly-
 * active profile's file.
 *
 * Throws if the supplied id isn't a known profile.
 */
export function switchProfile(id: string): void {
  const reg = readRegistry();
  if (!reg.profiles.some((p) => p.id === id)) {
    throw new Error(`Unknown profile id: ${id}`);
  }
  // Always lock first — even when switching to the SAME id, the
  // caller is asking us to re-unlock from scratch.
  try {
    state.client?.close();
  } catch {
    /* ignore */
  }
  state.client = null;
  state.drizzleDb = null;
  state.openProfileId = null;
  setActiveProfileId(id);
}

/** One-shot data backfill that gives every legacy "this is a transfer"
 *  row a real `transfer_pair_id` by minting synthetics in a default
 *  "External" account. Gated by the `transferBackfillDone` flag on
 *  `app_settings` so it runs exactly once per DB instance — a restored
 *  older DB whose flag is unset gets one pass; a restored DB with the
 *  flag set is left alone (avoids minting fresh synthetics for rows
 *  the operator considered "matched" in the source state). Re-runs
 *  are opt-in via Settings → Maintenance.
 *
 *  Errors are logged but never thrown (the unlock has already
 *  succeeded and the app remains usable). */
function runOrphanTransferBackfill(): void {
  if (!state.drizzleDb || !state.client) return;
  try {
    const flagRow = state.client
      .prepare(
        `SELECT transfer_backfill_done FROM app_settings WHERE id = 1`,
      )
      .get() as { transfer_backfill_done?: number } | undefined;
    if (flagRow?.transfer_backfill_done === 1) {
      // Already done on this DB — restore-safe no-op.
      return;
    }
    // Lazy import: the helper pulls from `@/db` itself; importing it
    // at module-init would create a cycle. Resolved at call time
    // when the singleton is already initialised.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("@/lib/backfill-orphan-transfers");
    const result = m.backfillOrphanTransfers();
    if (result.paired > 0) {
      console.log(
        `[db] Backfilled ${result.paired} orphan transfer row(s) with synthetic counterparts.`,
      );
    }
    // Mark the flag regardless of whether anything was paired — a
    // fresh DB with zero orphans still "counts" as backfilled, and
    // we don't want to re-scan on every unlock thereafter.
    state.client
      .prepare(
        `UPDATE app_settings SET transfer_backfill_done = 1 WHERE id = 1`,
      )
      .run();
  } catch (e) {
    console.error("[db] Orphan-transfer backfill failed:", e);
  }
}

/** Apply any pending drizzle migrations against the live keyed
 * connection. drizzle's migrator records what it ran in
 * `__drizzle_migrations`, so re-running is cheap. Errors are logged
 * but never thrown — the unlock has already succeeded by the time
 * this is called, and a partial schema is still usable for many
 * routes. */
function runPendingMigrations(): void {
  if (!state.drizzleDb) return;
  try {
    migrate(state.drizzleDb, {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });
  } catch (e) {
    console.error("[db] Pending migrations failed to apply:", e);
  }
}

/** Insert a default admin/admin user when the users table is empty.
 * Runs after every successful unlock so a freshly-created DB (web
 * /unlock flow, no env-driven seed) gets a working login on the
 * first try. Subsequent unlocks no-op because the count > 0. The
 * operator is expected to either change the password via Settings →
 * Users, or create their own user and delete this one. */
function seedDefaultUserIfMissing(): void {
  if (!state.client) return;
  try {
    const row = state.client
      .prepare("SELECT COUNT(*) AS n FROM users")
      .get() as { n: number } | undefined;
    if ((row?.n ?? 0) > 0) return;
    const passwordHash = hashSync("admin", 12);
    // `INSERT … ON CONFLICT(username) DO NOTHING` so concurrent
    // module evaluations (Turbopack chunks during dev / e2e cold
    // start can both pass the COUNT check before either has
    // committed) don't trip a UNIQUE-constraint error and spam the
    // logs. The first writer wins; later ones quietly no-op.
    const result = state.client
      .prepare(
        "INSERT INTO users (id, name, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(username) DO NOTHING",
      )
      .run(crypto.randomUUID(), "Admin", "admin", passwordHash, "admin", Date.now());
    if (result.changes > 0) {
      console.log(
        "[db] Seeded default admin/admin user. Change the password in Settings → Users.",
      );
    }
  } catch (e) {
    console.error("[db] Failed to seed default user:", e);
  }
}

/** Seed the 30 baseline categories from `default-categories.ts` when
 * the categories table is empty. Runs after every successful unlock,
 * so a fresh DB picks them up without anyone running the explicit
 * `npm run db:seed` script. Uses onConflictDoNothing so re-runs on a
 * partially-populated table don't blow up on the (name, type,
 * parent_id) unique index. */
export function seedSystemCategoriesIfMissing(): void {
  if (!state.drizzleDb) return;
  try {
    const existing = state.drizzleDb
      .select({ id: categories.id })
      .from(categories)
      .limit(1)
      .all();
    if (existing.length > 0) return;
    const rows = DEFAULT_CATEGORIES.map((c) => ({
      name: c.name,
      type: c.type,
      color: c.color,
      isSystem: true,
    }));
    state.drizzleDb.insert(categories).values(rows).onConflictDoNothing().run();
    console.log(`[db] Seeded ${rows.length} default categories.`);
  } catch (e) {
    console.error("[db] Failed to seed default categories:", e);
  }
}

/** One-shot seed of demo accounts / transactions / schedules tagged
 * `isSample = true` so the user can see what the app does without
 * importing real bank data. Gated by `app_settings.sample_data_seeded`
 * so it runs at most once per DB lifetime — even if the user removes
 * sample data from Settings later, we don't re-seed.
 *
 * Skips and sets the flag if the DB already contains user data
 * (existing-install upgrade path), so people adopting this feature
 * on populated databases don't get demo rows sprayed in alongside
 * their own. */
export function seedSampleDataIfMissing(): void {
  if (!state.drizzleDb || !state.client) return;
  try {
    // Fast path: skip the transaction entirely when the flag is
    // already set. Avoids the BEGIN IMMEDIATE write-lock on every
    // unlock after the first.
    const flagRow = state.drizzleDb
      .select({ flag: appSettings.sampleDataSeeded })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .all();
    if (flagRow[0]?.flag) return;

    // Wrap the entire flag-check / existing-data-gate / insert /
    // flag-write inside a single SQLite transaction so two
    // simultaneous unlocks can't both pass the gate before either
    // commits — without this, a fast double-unlock can double-seed.
    // `behavior: "immediate"` grabs the write lock on BEGIN so the
    // second concurrent transaction blocks (`busy_timeout = 5000`
    // gives it room) instead of erroring with SQLITE_BUSY when it
    // first tries to write.
    state.drizzleDb.transaction((tx) => {
      const settingsRow = tx
        .select({ flag: appSettings.sampleDataSeeded })
        .from(appSettings)
        .where(eq(appSettings.id, 1))
        .all();
      if (settingsRow[0]?.flag) return;

      // Existing-install gate: if the DB already has any non-sample
      // accounts or transactions, skip seeding and lock the flag so
      // we never re-check.
      const existingAccount = tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.isSample, false))
        .limit(1)
        .all();
      const existingTxn = tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.isSample, false))
        .limit(1)
        .all();
      if (existingAccount.length > 0 || existingTxn.length > 0) {
        tx.insert(appSettings)
          .values({ id: 1, sampleDataSeeded: true })
          .onConflictDoUpdate({
            target: appSettings.id,
            set: { sampleDataSeeded: true, updatedAt: new Date() },
          })
          .run();
        return;
      }

      const cats = tx
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .all();
      const categoryIdsByName = new Map(cats.map((c) => [c.name, c.id]));
      const payload = buildSampleData({ today: new Date(), categoryIdsByName });

      // Defer FK enforcement to COMMIT so the self-referencing
      // transferPairId between paired transactions doesn't fail the
      // first half before the second half lands. SQLite resets this
      // pragma at end-of-transaction.
      state.client!.pragma("defer_foreign_keys = 1");
      tx.insert(accounts).values(payload.accounts).run();
      tx.insert(transactions).values(payload.transactions).run();
      tx.insert(scheduledTransactions).values(payload.schedules).run();
      tx.insert(appSettings)
        .values({ id: 1, sampleDataSeeded: true })
        .onConflictDoUpdate({
          target: appSettings.id,
          set: { sampleDataSeeded: true, updatedAt: new Date() },
        })
        .run();
      console.log(
        `[db] Seeded sample data: ${payload.accounts.length} accounts, ${payload.transactions.length} transactions, ${payload.schedules.length} schedules.`,
      );
    }, { behavior: "immediate" });
  } catch (e) {
    console.error("[db] Failed to seed sample data:", e);
  }
}

function upsertSampleDataSeededFlag(value: boolean): void {
  if (!state.drizzleDb) return;
  state.drizzleDb
    .insert(appSettings)
    .values({ id: 1, sampleDataSeeded: value })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { sampleDataSeeded: value, updatedAt: new Date() },
    })
    .run();
}

/**
 * Re-encrypt the database with a new passphrase. Validates the
 * current passphrase against the file FIRST (independent of the
 * already-unlocked state, same reasoning as unlock above) before
 * issuing PRAGMA rekey on the live connection. The live connection
 * remains valid with the new key after rekey returns.
 */
export function rekey(
  currentPassphrase: string,
  newPassphrase: string,
): { ok: true } | { ok: false; error: string } {
  if (!newPassphrase) {
    return { ok: false, error: "New passphrase is required." };
  }
  // Validate current passphrase against the file regardless of the
  // process's unlocked state — see unlock() for the rationale.
  const probe = openWithKey(currentPassphrase);
  if (!probe.ok) return probe;
  try {
    probe.client.close();
  } catch {
    /* ignore */
  }

  if (!state.client) {
    return {
      ok: false,
      error: "Database is locked. Unlock it before changing the passphrase.",
    };
  }
  try {
    state.client.pragma(`rekey = '${newPassphrase.replace(/'/g, "''")}'`);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  return { ok: true };
}

/**
 * Drop the in-memory key by closing the connection. The next query
 * will throw DbLockedError until `unlock` is called again. Useful for
 * a /lock endpoint or shutdown hooks.
 */
export function lock(): void {
  try {
    state.client?.close();
  } catch {
    /* ignore */
  }
  state.client = null;
  state.drizzleDb = null;
  state.openProfileId = null;
}

// Auto-unlock from env if the operator chose to inject the key that
// way (containers, tests). Failure is logged but doesn't crash the
// process — the user can still unlock via /unlock.
if (process.env.SQLITE_KEY) {
  const r = unlock(process.env.SQLITE_KEY);
  if (!r.ok) {
    console.error(
      `[db] SQLITE_KEY in env did NOT unlock ${livePath()}: ${r.error}. ` +
        `Falling back to web unlock.`,
    );
  }
}

/** Create a brand-new SQLCipher file for a freshly-registered profile.
 *  Opens it with the supplied passphrase (this is what writes the
 *  encryption key to the new file), runs pragmas + migrations + the
 *  one-time seeders, then closes the connection. The caller is
 *  responsible for then calling `switchProfile(id)` and routing the
 *  user to `/unlock` so they re-enter the passphrase against the now-
 *  active new file.
 *
 *  Throws if the path already exists (preventing accidental clobber)
 *  or if SQLite/SQLCipher reports an open error.
 *
 *  Imports drizzle migrator + seeders locally to avoid a cycle with
 *  `db/index.ts`'s top-level state.
 */
export function initProfileFile(
  profileId: string,
  passphrase: string,
): { ok: true } | { ok: false; error: string } {
  if (!passphrase) return { ok: false, error: "Passphrase is required." };
  const reg = readRegistry();
  const profile = reg.profiles.find((p) => p.id === profileId);
  if (!profile) return { ok: false, error: `Unknown profile: ${profileId}` };
  const path = pathForProfile(profile);
  if (existsSync(path)) {
    return {
      ok: false,
      error: `File already exists at ${path}; refusing to overwrite.`,
    };
  }
  let client: BetterSqlite3.Database | undefined;
  try {
    mkdirSync(dirname(path), { recursive: true });
    client = new Database(path) as unknown as BetterSqlite3.Database;
    client.pragma(`key = '${passphrase.replace(/'/g, "''")}'`);
    client.pragma("cipher_compatibility = 4");
    client.pragma("journal_mode = WAL");
    client.pragma("foreign_keys = ON");
    client.pragma("busy_timeout = 5000");
    // Run drizzle migrations against this fresh handle directly.
    // We don't promote it to state.client — the caller will switch
    // and the user will re-unlock against this file.
    const d = drizzle(client, { schema });
    migrate(d, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    // Seed system categories + default user so the new DB is
    // immediately usable on first unlock. Skip sample data — fresh
    // multi-DB profiles are intentionally empty so the operator can
    // start with their own data.
    // Use raw inserts here to avoid the singleton-state assumption
    // baked into the seedXxxIfMissing helpers below.
    const count = client
      .prepare("SELECT count(*) AS n FROM categories")
      .get() as { n: number };
    if (count.n === 0) {
      // DEFAULT_CATEGORIES is a flat list — no parent / child
      // relationships (those are created by the operator later via
      // the categories UI). One INSERT per row, parent_id always
      // null.
      const insertCat = client.prepare(
        // categories table has `created_at` but NO `updated_at` —
        // unlike most other tables. Fresh-DB creates via
        // `initProfileFile()` were crashing here with "table
        // categories has no column named updated_at" until this
        // INSERT was trimmed to match.
        `INSERT INTO categories (id, name, type, color, parent_id, is_system, transfer_kind, created_at)
         VALUES (?, ?, ?, ?, NULL, 1, 'none', strftime('%s','now')*1000)`,
      );
      const newId = (): string =>
        Array.from(
          { length: 16 },
          () => Math.floor(Math.random() * 256),
        )
          .map((b, i) => {
            if (i === 6) return ((b & 0x0f) | 0x40).toString(16).padStart(2, "0");
            if (i === 8) return ((b & 0x3f) | 0x80).toString(16).padStart(2, "0");
            return b.toString(16).padStart(2, "0");
          })
          .join("")
          .replace(
            /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
            "$1-$2-$3-$4-$5",
          );
      for (const c of DEFAULT_CATEGORIES) {
        insertCat.run(newId(), c.name, c.type, c.color);
      }
    }
    // Default user. Username admin / password admin — operator should
    // rotate via Settings.
    const userCount = client
      .prepare("SELECT count(*) AS n FROM users")
      .get() as { n: number };
    if (userCount.n === 0) {
      client
        .prepare(
          `INSERT INTO users (id, username, password_hash, role, created_at)
           VALUES (lower(hex(randomblob(16))), 'admin', ?, 'admin', strftime('%s','now')*1000)`,
        )
        .run(hashSync("admin", 10));
    }
    // Mark the orphan-transfer backfill as done so it doesn't fire
    // its first-time pass on a fresh DB.
    client
      .prepare(
        `INSERT INTO app_settings (id, transfer_backfill_done, sample_data_seeded, updated_at)
         VALUES (1, 1, 1, strftime('%s','now')*1000)
         ON CONFLICT(id) DO UPDATE SET transfer_backfill_done = 1, sample_data_seeded = 1`,
      )
      .run();
    client.close();
    return { ok: true };
  } catch (err) {
    try {
      client?.close();
    } catch {
      /* ignore */
    }
    // If we created a partial file, remove it so a retry has a clean
    // slate.
    try {
      if (existsSync(path)) {
        // Don't delete an existing-but-not-mine file — the existsSync
        // check at the top guards that, so this branch only fires on
        // partial writes from this same call.
        const { rmSync } = require("node:fs");
        rmSync(path);
      }
    } catch {
      /* ignore */
    }
    return { ok: false, error: describeOpenError(err, path) };
  }
}

/**
 * Drizzle DB facade. Trapped through a Proxy so that until the user
 * (or the env var) provides a working passphrase, every property
 * access throws DbLockedError. Once unlocked, calls forward to the
 * real drizzle instance with no overhead beyond a `Reflect.get`.
 */
export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    if (!state.drizzleDb) {
      throw new DbLockedError();
    }
    return Reflect.get(state.drizzleDb, prop, receiver);
  },
});
