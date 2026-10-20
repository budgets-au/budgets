import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { applyMigrations, getSchemaStatus, readJournal } from "./migrations";

const REAL = resolve(process.cwd(), "drizzle");
const realJournal = readJournal(REAL);
const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Build a migrations folder holding the first `upTo` real migrations plus any
 *  `extra` hand-made ones appended after them. */
function folder(upTo: number, extra: Array<{ tag: string; sql: string }> = []): string {
  const dir = mkdtempSync(join(tmpdir(), "migr-"));
  temps.push(dir);
  mkdirSync(join(dir, "meta"));
  const entries = realJournal.slice(0, upTo).map((m, idx) => {
    copyFileSync(join(REAL, `${m.tag}.sql`), join(dir, `${m.tag}.sql`));
    return { idx, version: "6", when: m.when, tag: m.tag, breakpoints: true };
  });
  let when = realJournal[realJournal.length - 1].when;
  for (const e of extra) {
    when += 100_000_000;
    writeFileSync(join(dir, `${e.tag}.sql`), e.sql);
    entries.push({ idx: entries.length, version: "6", when, tag: e.tag, breakpoints: true });
  }
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "sqlite", entries }),
  );
  return dir;
}

const idx0021 = realJournal.findIndex((m) => m.tag.startsWith("0021_"));
const cols = (db: Database.Database, t: string) =>
  (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);

describe("applyMigrations", () => {
  it("applies every migration to a fresh DB and the result matches schema.ts", () => {
    const db = new Database(":memory:");
    const r = applyMigrations(db, REAL);
    expect(r.error).toBeNull();
    expect(r.applied).toHaveLength(realJournal.length);
    const s = getSchemaStatus(db, REAL);
    expect(s.pending).toEqual([]);
    expect(s.missingTables).toEqual([]);
    expect(s.missingColumns).toEqual([]);
  });

  it("is a no-op on the second run", () => {
    const db = new Database(":memory:");
    applyMigrations(db, REAL);
    expect(applyMigrations(db, REAL)).toEqual({ applied: [], repaired: [], error: null });
  });

  it("recovers a DB missing scheduled_forecasts before 0021 (the production failure)", () => {
    const db = new Database(":memory:");
    applyMigrations(db, folder(idx0021));
    db.exec("DROP TABLE scheduled_forecasts");
    const r = applyMigrations(db, REAL);
    expect(r.error).toBeNull();
    expect(r.repaired).toContain("0021_scheduled_forecasts_date_override");
    expect(r.applied).toContain("0022_transaction_attachments");
    expect(cols(db, "scheduled_forecasts")).toContain("new_date");
    expect(getSchemaStatus(db, REAL).missingTables).toEqual([]);
  });

  it("un-wedges a DB where the 0.357.1 self-heal pre-created 0022's objects", () => {
    const db = new Database(":memory:");
    applyMigrations(db, folder(idx0021));
    db.prepare(
      "INSERT INTO scheduled_transactions (id, amount, type, frequency, start_date, lineage_id, created_at, updated_at) VALUES ('s1','10','expense','monthly','2026-01-01','s1',0,0)",
    ).run();
    db.prepare(
      "INSERT INTO scheduled_forecasts (id, scheduled_id, occurrence_date, amount, created_at, updated_at) VALUES ('f1','s1','2026-01-01','10',0,0)",
    ).run();
    db.exec(`CREATE TABLE transaction_attachments (id TEXT PRIMARY KEY NOT NULL, transaction_id TEXT NOT NULL,
      filename TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    db.exec("ALTER TABLE app_settings ADD COLUMN attachments_dek TEXT");

    // Demonstrate the wedge with drizzle's own runner first.
    expect(() =>
      migrate(drizzle(db), { migrationsFolder: folder(realJournal.length, [{ tag: "0099_x", sql: "SELECT 1;" }]) }),
    ).toThrow();

    const r = applyMigrations(db, folder(realJournal.length, [{ tag: "0099_later", sql: "CREATE TABLE later_thing (id TEXT);" }]));
    expect(r.error).toBeNull();
    expect(r.applied).toContain("0021_scheduled_forecasts_date_override"); // real rebuild ran
    expect(r.repaired).toEqual(["0022_transaction_attachments"]);
    expect(r.applied).toContain("0099_later");
    // The 0021 rebuild preserved the existing override row.
    expect(db.prepare("SELECT amount FROM scheduled_forecasts WHERE id='f1'").get()).toEqual({ amount: "10" });
  });

  it("stops at the first failing migration and does not record later ones", () => {
    const db = new Database(":memory:");
    const dir = folder(realJournal.length, [
      { tag: "0099_bad", sql: "CREATE TABLE nope (id TEXT REFERENCES" },
      { tag: "0100_good", sql: "CREATE TABLE fine (id TEXT);" },
    ]);
    const r = applyMigrations(db, dir);
    expect(r.error?.tag).toBe("0099_bad");
    expect(r.applied).not.toContain("0100_good");
    expect(getSchemaStatus(db, dir).pending).toEqual(["0099_bad", "0100_good"]);
  });

  it("leaves bookkeeping drizzle-compatible", () => {
    const db = new Database(":memory:");
    applyMigrations(db, REAL);
    expect(() => migrate(drizzle(db), { migrationsFolder: REAL })).not.toThrow();
    expect(getSchemaStatus(db, REAL).recordedCount).toBe(realJournal.length);
  });
});
