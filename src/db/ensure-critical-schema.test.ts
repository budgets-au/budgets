import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { ensureCriticalSchemaOn } from "./index";

/** Regression guard for the post-migration safety net.
 *
 *  Production bug (0.355.x): a user's DB was missing
 *  `scheduled_forecasts` (migration 0021) AND
 *  `transaction_attachments` (migration 0022) even though
 *  drizzle's `migrate()` reported no error. Most likely cause:
 *  migration 0021 rebuilt `scheduled_forecasts` via DROP + RENAME,
 *  and a prior interrupted run left the DB in a state where
 *  `__drizzle_migrations` recorded the hash but the final RENAME
 *  never landed — drizzle then skipped the migration on every
 *  later unlock. Three endpoints that depended on these tables
 *  (`/api/cashflow`, `/api/scheduled`, the paper-clip counter on
 *  `/api/transactions`) started 500ing.
 *
 *  `ensureCriticalSchemaOn()` runs AFTER drizzle's migrator and
 *  idempotently CREATE TABLE IF NOT EXISTS / ADD COLUMN those
 *  critical tables, so a drift between the migrations journal and
 *  the actual schema self-heals on the next unlock. These tests
 *  pin that behaviour against both scenarios: an empty DB (nothing
 *  pre-existing) and a DB that already has the tables (so repeat
 *  runs stay silent).
 */

/** Minimal pre-existing schema the self-heal statements reference
 *  by FOREIGN KEY. Mirrors enough of 0000 to let the test's CREATE
 *  TABLE statements compile; a real DB has far more. */
function seedMinimalParents(db: Database.Database): void {
  db.exec(`CREATE TABLE transactions (id TEXT PRIMARY KEY NOT NULL)`);
  db.exec(`CREATE TABLE scheduled_transactions (id TEXT PRIMARY KEY NOT NULL)`);
  db.exec(`CREATE TABLE app_settings (id INTEGER PRIMARY KEY DEFAULT 1)`);
}

function hasTable(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?")
    .get(name) as { name: string } | undefined;
  return !!row;
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

describe("ensureCriticalSchemaOn", () => {
  it("creates scheduled_forecasts + transaction_attachments on a DB missing them", () => {
    const db = new Database(":memory:");
    seedMinimalParents(db);
    expect(hasTable(db, "scheduled_forecasts")).toBe(false);
    expect(hasTable(db, "transaction_attachments")).toBe(false);
    expect(hasColumn(db, "app_settings", "attachments_dek")).toBe(false);

    ensureCriticalSchemaOn(db);

    expect(hasTable(db, "scheduled_forecasts")).toBe(true);
    expect(hasTable(db, "transaction_attachments")).toBe(true);
    expect(hasColumn(db, "app_settings", "attachments_dek")).toBe(true);
    // The scheduled_forecasts shape matches the post-0021 contract:
    // amount is nullable, new_date column present.
    const cols = db
      .prepare("PRAGMA table_info(scheduled_forecasts)")
      .all() as Array<{ name: string; notnull: number }>;
    const amount = cols.find((c) => c.name === "amount");
    const newDate = cols.find((c) => c.name === "new_date");
    expect(amount?.notnull).toBe(0);
    expect(newDate).toBeDefined();
  });

  it("is idempotent — repeat runs don't throw and don't duplicate columns", () => {
    const db = new Database(":memory:");
    seedMinimalParents(db);
    ensureCriticalSchemaOn(db);
    // Second pass must stay quiet. The ADD COLUMN branch would
    // throw "duplicate column name" without the catch; the catch
    // deliberately filters that out.
    expect(() => ensureCriticalSchemaOn(db)).not.toThrow();
    // Verify we didn't accidentally end up with two attachments_dek
    // columns.
    const dekCols = (
      db.prepare("PRAGMA table_info(app_settings)").all() as Array<{
        name: string;
      }>
    ).filter((c) => c.name === "attachments_dek");
    expect(dekCols.length).toBe(1);
  });

  it("creates the expected indices on scheduled_forecasts", () => {
    const db = new Database(":memory:");
    seedMinimalParents(db);
    ensureCriticalSchemaOn(db);
    const idxs = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='index' AND tbl_name='scheduled_forecasts'",
      )
      .all() as Array<{ name: string }>;
    const names = idxs.map((i) => i.name);
    expect(names).toContain("scheduled_forecasts_unique_idx");
    expect(names).toContain("scheduled_forecasts_scheduled_idx");
  });

  it("creates the transaction_attachments index on transaction_id", () => {
    const db = new Database(":memory:");
    seedMinimalParents(db);
    ensureCriticalSchemaOn(db);
    const idxs = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='index' AND tbl_name='transaction_attachments'",
      )
      .all() as Array<{ name: string }>;
    expect(idxs.map((i) => i.name)).toContain("transaction_attachments_txn_idx");
  });

  it("preserves pre-existing data when tables already exist", () => {
    const db = new Database(":memory:");
    seedMinimalParents(db);
    ensureCriticalSchemaOn(db);
    db.prepare(
      "INSERT INTO transactions (id) VALUES (?)",
    ).run("txn-1");
    db.prepare(
      "INSERT INTO transaction_attachments (id, transaction_id, filename, content_type, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("att-1", "txn-1", "rc.pdf", "application/pdf", 100, "deadbeef", Date.now());
    // Re-run — row must survive.
    ensureCriticalSchemaOn(db);
    const row = db
      .prepare("SELECT id FROM transaction_attachments WHERE id = ?")
      .get("att-1") as { id: string } | undefined;
    expect(row?.id).toBe("att-1");
  });
});
