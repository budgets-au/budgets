import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

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

const db = drizzle(sqlite as unknown as BetterSqlite3.Database);
migrate(db, { migrationsFolder: "./drizzle" });

console.log(`Migrations applied to ${sqlitePath}`);
sqlite.close();
