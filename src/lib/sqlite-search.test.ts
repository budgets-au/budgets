import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "@signalapp/better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { like } from "drizzle-orm";

/**
 * Locks in that the transactions search predicate compiles to valid
 * SQLite SQL. We were hit by `drizzle-orm/ilike` (a Postgres-only
 * operator) leaking into the SQLite codebase after the PG → SQLite
 * migration; the SQL came back as `near "ilike": syntax error` from
 * the engine. The fix is `like()`, which SQLite supports natively
 * and treats as case-insensitive for ASCII by default.
 *
 * Running this against an actual `:memory:` SQLite catches the same
 * class of bug — it would fire if anyone reaches for `ilike` again
 * (or any other PG-only operator) in a SQLite query.
 */
describe("transactions search predicate (regression for the ilike → like fix)", () => {
  const tx = sqliteTable("tx", {
    payee: text("payee").notNull(),
  });

  function freshDb() {
    const sqlite = new Database(":memory:") as unknown as BetterSqlite3.Database;
    sqlite.exec(`CREATE TABLE tx (payee TEXT NOT NULL)`);
    sqlite.exec(`
      INSERT INTO tx (payee) VALUES
        ('Coffee Shop'),
        ('GROCERY STORE'),
        ('woolworths'),
        ('Local Pluck Cafe'),
        ('Gas');
    `);
    return drizzle(sqlite);
  }

  it("compiles to valid SQLite — no syntax error", () => {
    const db = freshDb();
    // The act of running .all() throws with `near "ilike"` if the
    // wrong operator is used. A clean run is the assertion.
    expect(() =>
      db.select().from(tx).where(like(tx.payee, "%coffee%")).all(),
    ).not.toThrow();
  });

  it("matches case-insensitively for ASCII payees (lowercase query, mixed-case data)", () => {
    const db = freshDb();
    const rows = db
      .select()
      .from(tx)
      .where(like(tx.payee, "%coffee%"))
      .all();
    expect(rows.map((r) => r.payee)).toEqual(["Coffee Shop"]);
  });

  it("matches case-insensitively the other direction (uppercase query, lowercase data)", () => {
    const db = freshDb();
    const rows = db
      .select()
      .from(tx)
      .where(like(tx.payee, "%WOOL%"))
      .all();
    expect(rows.map((r) => r.payee)).toEqual(["woolworths"]);
  });

  it("matches a substring anywhere in the payee", () => {
    const db = freshDb();
    const rows = db
      .select()
      .from(tx)
      .where(like(tx.payee, "%pluck%"))
      .all();
    expect(rows.map((r) => r.payee)).toEqual(["Local Pluck Cafe"]);
  });

  it("returns nothing when the substring isn't present", () => {
    const db = freshDb();
    const rows = db
      .select()
      .from(tx)
      .where(like(tx.payee, "%nope%"))
      .all();
    expect(rows).toEqual([]);
  });
});
