import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { applyMigrations } from "../src/db/migrations";

const sqlitePath = process.env.SQLITE_PATH ?? "/data/budget.db";
const sqliteKey = process.env.SQLITE_KEY;
if (!sqliteKey) {
  console.error(
    "SQLITE_KEY is required. Generate one with `openssl rand -hex 32` " +
      "and export it before running migrations.",
  );
  process.exit(1);
}
mkdirSync(dirname(sqlitePath), { recursive: true });

const sqlite = new Database(sqlitePath);
// Legacy-SQLCipher open sequence — mirror src/db/index.ts
// unlockAndVerify. Pragma NAME matters: `legacy=4` (not
// cipher_compatibility=4) is what triggers the fork's SQLCipher-v4
// compat mode.
sqlite.pragma("cipher='sqlcipher'");
sqlite.pragma("legacy=4");
sqlite.pragma(`key = '${sqliteKey.replace(/'/g, "''")}'`);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Same per-migration runner the app uses on unlock, so the two can't disagree.
const r = applyMigrations(sqlite as unknown as BetterSqlite3.Database, resolve("drizzle"));
sqlite.close();
if (r.repaired.length) console.warn(`Repaired drifted migrations: ${r.repaired.join(", ")}`);
if (r.error) {
  console.error(`Migration ${r.error.tag} failed: ${r.error.message}`);
  process.exit(1);
}
console.log(`Applied ${r.applied.length} migration(s) to ${sqlitePath}`);
