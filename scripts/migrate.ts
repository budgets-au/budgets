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
// Cipher scheme + compat level BEFORE key — the
// better-sqlite3-multiple-ciphers fork requires this order to
// open existing SQLCipher-format files (see the long comment at
// src/db/index.ts unlockAndVerify for why).
sqlite.pragma("cipher = 'sqlcipher'");
sqlite.pragma("cipher_compatibility = 4");
sqlite.pragma(`key = '${sqliteKey.replace(/'/g, "''")}'`);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite as unknown as BetterSqlite3.Database);
migrate(db, { migrationsFolder: "./drizzle" });

console.log(`Migrations applied to ${sqlitePath}`);
sqlite.close();
