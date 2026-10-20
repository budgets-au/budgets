import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { is } from "drizzle-orm";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";

// Per-migration runner replacing drizzle's `migrate()`. Drizzle runs every
// pending migration in ONE transaction and skips by `created_at` ordering, so a
// single failing migration (0021 against a DB missing `scheduled_forecasts`)
// silently blocked every later one. Here each migration commits on its own,
// known-drifted migrations are repaired in place, and the first error is
// returned for the Settings "Schema check" instead of being swallowed.
// Bookkeeping stays drizzle-compatible: same table, same (hash, created_at) row.

// Deliberately does NOT import "@/db" — it is called from unlock().

const MIGRATIONS_TABLE = "__drizzle_migrations";

export interface JournalMigration {
  tag: string;
  when: number;
  hash: string;
  statements: string[];
}

export interface MigrationRunResult {
  applied: string[];
  repaired: string[];
  error: { tag: string; message: string } | null;
}

export function readJournal(folder: string): JournalMigration[] {
  const journal = JSON.parse(
    readFileSync(join(folder, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string; when: number }> };
  return journal.entries.map((e) => {
    const sql = readFileSync(join(folder, `${e.tag}.sql`), "utf8");
    return {
      tag: e.tag,
      when: e.when,
      hash: createHash("sha256").update(sql).digest("hex"),
      statements: sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    };
  });
}

function tableExists(db: BetterSqlite3.Database, name: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?")
    .get(name);
}

function columnNames(db: BetterSqlite3.Database, table: string): string[] {
  if (!tableExists(db, table)) return [];
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
}

/** Migrations known to have drifted in the field. `drifted` says the DB already
 *  holds some or all of the migration's objects (so its plain DDL would fail);
 *  `complete` idempotently fills in whatever is missing. Only additive repairs
 *  belong here. */
const REPAIRS: Record<
  string,
  {
    drifted: (db: BetterSqlite3.Database) => boolean;
    complete: (db: BetterSqlite3.Database) => void;
  }
> = {
  // 0021 rebuilds scheduled_forecasts via INSERT…SELECT FROM the old table, so
  // it fails outright when the table is absent. Treat "absent" and "already
  // has new_date" as drift; only the old 0000 shape runs the real rebuild.
  "0021_scheduled_forecasts_date_override": {
    drifted: (db) =>
      !tableExists(db, "scheduled_forecasts") ||
      columnNames(db, "scheduled_forecasts").includes("new_date"),
    complete: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS scheduled_forecasts (
        id TEXT PRIMARY KEY NOT NULL,
        scheduled_id TEXT NOT NULL REFERENCES scheduled_transactions(id) ON DELETE CASCADE,
        occurrence_date TEXT NOT NULL,
        amount TEXT,
        new_date TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`);
      db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS scheduled_forecasts_unique_idx ON scheduled_forecasts(scheduled_id, occurrence_date)",
      );
      db.exec(
        "CREATE INDEX IF NOT EXISTS scheduled_forecasts_scheduled_idx ON scheduled_forecasts(scheduled_id)",
      );
    },
  },
  // 0022's CREATE TABLE / ADD COLUMN are not idempotent; 0.357.1's self-heal
  // could create either half ahead of the migration.
  "0022_transaction_attachments": {
    drifted: (db) =>
      tableExists(db, "transaction_attachments") ||
      columnNames(db, "app_settings").includes("attachments_dek"),
    complete: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS transaction_attachments (
        id TEXT PRIMARY KEY NOT NULL,
        transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`);
      db.exec(
        "CREATE INDEX IF NOT EXISTS transaction_attachments_txn_idx ON transaction_attachments(transaction_id)",
      );
      if (!columnNames(db, "app_settings").includes("attachments_dek")) {
        db.exec("ALTER TABLE app_settings ADD COLUMN attachments_dek TEXT");
      }
    },
  },
};

function ensureMigrationsTable(db: BetterSqlite3.Database): void {
  // Identical DDL to drizzle's so the two stay interchangeable.
  db.exec(`CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )`);
}

function newestRecorded(db: BetterSqlite3.Database): number | null {
  const row = db
    .prepare(`SELECT MAX(CAST(created_at AS INTEGER)) AS m FROM "${MIGRATIONS_TABLE}"`)
    .get() as { m: number | null };
  return row.m;
}

export function applyMigrations(
  db: BetterSqlite3.Database,
  folder: string,
): MigrationRunResult {
  const result: MigrationRunResult = { applied: [], repaired: [], error: null };
  ensureMigrationsTable(db);
  const last = newestRecorded(db);
  const pending = readJournal(folder).filter((m) => last === null || m.when > last);
  const record = db.prepare(
    `INSERT INTO "${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES (?, ?)`,
  );
  for (const m of pending) {
    const repair = REPAIRS[m.tag];
    const isDrift = !!repair && repair.drifted(db);
    try {
      db.transaction(() => {
        if (isDrift) repair.complete(db);
        else for (const stmt of m.statements) db.exec(stmt);
        record.run(m.hash, m.when);
      })();
      (isDrift ? result.repaired : result.applied).push(m.tag);
    } catch (e) {
      // Stop here: later migrations may depend on this one, and recording a
      // later `created_at` would make this one skip forever.
      result.error = { tag: m.tag, message: e instanceof Error ? e.message : String(e) };
      break;
    }
  }
  return result;
}

export interface SchemaStatus {
  journalCount: number;
  recordedCount: number;
  newestRecorded: number | null;
  pending: string[];
  missingTables: string[];
  missingColumns: Array<{ table: string; column: string }>;
}

export function getSchemaStatus(db: BetterSqlite3.Database, folder: string): SchemaStatus {
  ensureMigrationsTable(db);
  const journal = readJournal(folder);
  const last = newestRecorded(db);
  const recordedCount = (
    db.prepare(`SELECT COUNT(*) AS n FROM "${MIGRATIONS_TABLE}"`).get() as { n: number }
  ).n;
  const missingTables: string[] = [];
  const missingColumns: Array<{ table: string; column: string }> = [];
  for (const value of Object.values(schema)) {
    if (!is(value, SQLiteTable)) continue;
    const cfg = getTableConfig(value);
    const existing = columnNames(db, cfg.name);
    if (existing.length === 0) {
      missingTables.push(cfg.name);
      continue;
    }
    for (const col of cfg.columns) {
      if (!existing.includes(col.name)) missingColumns.push({ table: cfg.name, column: col.name });
    }
  }
  return {
    journalCount: journal.length,
    recordedCount,
    newestRecorded: last,
    pending: journal.filter((m) => last === null || m.when > last).map((m) => m.tag),
    missingTables,
    missingColumns,
  };
}
