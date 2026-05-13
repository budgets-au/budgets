import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accounts } from "@/db/schema";
import { createTestDb, type TestDb } from "./test-db";

describe("test-db harness", () => {
  let db: TestDb;

  beforeAll(() => {
    db = createTestDb();
  });
  afterAll(() => {
    db.close();
  });

  it("applies migrations and exposes drizzle access", () => {
    // Every table from drizzle/0000_… onwards should exist post-migrate.
    db.drizzleDb
      .insert(accounts)
      .values({
        id: "acc-1",
        name: "Cheque",
        type: "checking",
        currentBalance: "0",
        startingBalance: "1000",
      })
      .run();
    const rows = db.drizzleDb.select().from(accounts).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Cheque");
    expect(rows[0].startingBalance).toBe("1000");
  });
});
