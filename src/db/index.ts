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

// Default DB path: /data/budget.db inside the container (mount ./data
// to /data on the host), or process.env.SQLITE_PATH for non-Docker /
// dev.
const sqlitePath = process.env.SQLITE_PATH ?? "/data/budget.db";
/** Where the live database lives — re-exported so the backup module
 * can copy from / swap to it without re-resolving the env. */
export const livePath = sqlitePath;

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
const state: DbState = globalForDb.__dbState ?? { client: null, drizzleDb: null };
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

/** True when a SQLCipher file is already present at the configured
 * path. Used by /api/unlock to tell the unlock page whether this is
 * a first-run scenario (no file → typing a passphrase CREATES the
 * DB) or an existing-DB unlock (typing the wrong passphrase
 * fails). */
export function dbExists(): boolean {
  return existsSync(sqlitePath);
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
  let client: BetterSqlite3.Database | undefined;
  try {
    mkdirSync(dirname(sqlitePath), { recursive: true });
    client = new Database(sqlitePath) as unknown as BetterSqlite3.Database;
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
    return { ok: false, error: describeOpenError(err, sqlitePath) };
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

  if (state.client) {
    // Already keyed in this process. The probe confirmed the supplied
    // passphrase opens the file, so the state stays — discard the
    // probe handle and reuse the live connection.
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
    return { ok: true };
  }

  // Promote: apply the live-connection pragmas and stash globally.
  probe.client.pragma("journal_mode = WAL");
  probe.client.pragma("foreign_keys = ON");
  probe.client.pragma("busy_timeout = 5000");
  state.client = probe.client;
  state.drizzleDb = drizzle(probe.client, { schema });

  runPendingMigrations();
  seedDefaultUserIfMissing();
  seedSystemCategoriesIfMissing();
  seedSampleDataIfMissing();

  return { ok: true };
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
    state.client
      .prepare(
        "INSERT INTO users (id, name, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(crypto.randomUUID(), "Admin", "admin", passwordHash, "admin", Date.now());
    console.log(
      "[db] Seeded default admin/admin user. Change the password in Settings → Users.",
    );
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
    const settingsRow = state.drizzleDb
      .select({ flag: appSettings.sampleDataSeeded })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .all();
    if (settingsRow[0]?.flag) return;

    // Existing-install gate: if the DB already has any non-sample
    // accounts or transactions, skip seeding and lock the flag so
    // we never re-check.
    const existingAccount = state.drizzleDb
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.isSample, false))
      .limit(1)
      .all();
    const existingTxn = state.drizzleDb
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.isSample, false))
      .limit(1)
      .all();
    if (existingAccount.length > 0 || existingTxn.length > 0) {
      upsertSampleDataSeededFlag(true);
      return;
    }

    const cats = state.drizzleDb
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .all();
    const categoryIdsByName = new Map(cats.map((c) => [c.name, c.id]));

    const payload = buildSampleData({ today: new Date(), categoryIdsByName });

    state.drizzleDb.transaction((tx) => {
      // Defer FK enforcement to COMMIT so the self-referencing
      // transferPairId between paired transactions doesn't fail the
      // first half before the second half lands. SQLite resets this
      // pragma at end-of-transaction.
      state.client!.pragma("defer_foreign_keys = 1");
      tx.insert(accounts).values(payload.accounts).run();
      tx.insert(transactions).values(payload.transactions).run();
      tx.insert(scheduledTransactions).values(payload.schedules).run();
    });
    upsertSampleDataSeededFlag(true);
    console.log(
      `[db] Seeded sample data: ${payload.accounts.length} accounts, ${payload.transactions.length} transactions, ${payload.schedules.length} schedules.`,
    );
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
}

// Auto-unlock from env if the operator chose to inject the key that
// way (containers, tests). Failure is logged but doesn't crash the
// process — the user can still unlock via /unlock.
if (process.env.SQLITE_KEY) {
  const r = unlock(process.env.SQLITE_KEY);
  if (!r.ok) {
    console.error(
      `[db] SQLITE_KEY in env did NOT unlock ${sqlitePath}: ${r.error}. ` +
        `Falling back to web unlock.`,
    );
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
