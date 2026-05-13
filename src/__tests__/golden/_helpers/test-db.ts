import Database from "@signalapp/better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import * as schema from "@/db/schema";

type Schema = typeof schema;
type DrizzleDb = BetterSQLite3Database<Schema>;

export interface TestDb {
  client: BetterSqlite3.Database;
  drizzleDb: DrizzleDb;
  close: () => void;
}

/** Spin up an in-memory SQLite + apply every drizzle migration. The
 * resulting handle is equivalent to a freshly-unlocked production DB:
 * same schema, same FK constraints, no data. Each test file should
 * call this in `beforeAll` and `close()` in `afterAll`. */
export function createTestDb(): TestDb {
  // `@signalapp/better-sqlite3` is the SQLCipher fork the prod app
  // uses; pointing it at `:memory:` skips the encryption layer
  // entirely (no key call needed) and gives us a plain in-memory
  // SQLite. Using the same driver as prod avoids subtle behaviour
  // drift (e.g. JSON1 availability, NUL-byte handling).
  const client = new Database(":memory:") as unknown as BetterSqlite3.Database;
  client.pragma("foreign_keys = ON");
  const drizzleDb = drizzle(client, { schema });
  migrate(drizzleDb, {
    migrationsFolder: resolve(process.cwd(), "drizzle"),
  });
  return {
    client,
    drizzleDb,
    close: () => {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/** Swap the in-process global DB state so the production `@/db`
 * proxy hits our test instance. `src/db/index.ts` stashes its
 * `state` on `globalThis.__dbState`; by pre-populating that global
 * before any code imports the @/db module, the proxy's `state` ref
 * picks up our test handle instead of the locked production one.
 *
 * IMPORTANT: this must be called BEFORE the route handler is
 * imported. Use `await import("@/app/api/...")` inside `beforeAll`
 * AFTER installing, not a top-level static import. */
export function installTestDb(db: TestDb): void {
  (globalThis as unknown as { __dbState?: unknown }).__dbState = {
    client: db.client,
    drizzleDb: db.drizzleDb,
  };
}
