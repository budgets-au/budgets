import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTestDb,
  installTestDb,
  type TestDb,
} from "@/__tests__/golden/_helpers/test-db";

const profile = { id: "default" };
const dataRoot = mkdtempSync(join(tmpdir(), "dek-"));
vi.mock("@/lib/db-profiles", () => ({
  getActiveProfile: () => profile,
  dataDir: () => dataRoot,
}));

type Crypto = typeof import("./crypto");
type DbContext = typeof import("@/lib/db-context");

function freshDb(): TestDb {
  const db = createTestDb();
  installTestDb(db);
  return db;
}

describe("ensureDek", () => {
  let crypto: Crypto;
  let ctx: DbContext;
  const dbs: TestDb[] = [];

  beforeAll(async () => {
    process.env.ATTACHMENTS_PATH = join(dataRoot, "attachments");
    dbs.push(freshDb());
    crypto = await import("./crypto");
    ctx = await import("@/lib/db-context");
  });
  beforeEach(() => {
    profile.id = "default";
    crypto.resetDekCache();
  });
  afterAll(() => {
    for (const d of dbs) d.close();
    rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.ATTACHMENTS_PATH;
  });

  it("creates one key and returns it on every later call", async () => {
    const a = await crypto.ensureDek();
    crypto.resetDekCache();
    expect((await crypto.ensureDek()).equals(a)).toBe(true);
  });

  it("concurrent first calls converge on a single key", async () => {
    const db = freshDb();
    dbs.push(db);
    const keys = await Promise.all(Array.from({ length: 5 }, () => crypto.ensureDek()));
    for (const k of keys) expect(k.equals(keys[0])).toBe(true);
    const stored = db.client
      .prepare("SELECT attachments_dek AS k FROM app_settings WHERE id = 1")
      .get() as { k: string };
    expect(Buffer.from(stored.k, "base64").equals(keys[0])).toBe(true);
  });

  it("does not leak one profile's key into another after a context change", async () => {
    const dbA = freshDb();
    dbs.push(dbA);
    const keyA = await crypto.ensureDek();

    const dbB = freshDb();
    dbs.push(dbB);
    profile.id = "other";
    ctx.notifyDbContextChange();
    const keyB = await crypto.ensureDek();

    expect(keyB.equals(keyA)).toBe(false);
    const storedB = dbB.client
      .prepare("SELECT attachments_dek AS k FROM app_settings WHERE id = 1")
      .get() as { k: string };
    expect(Buffer.from(storedB.k, "base64").equals(keyB)).toBe(true);
  });

  it("even without a notify, a different profile id misses the cache", async () => {
    const dbA = freshDb();
    dbs.push(dbA);
    const keyA = await crypto.ensureDek();
    dbs.push(freshDb());
    profile.id = "third";
    expect((await crypto.ensureDek()).equals(keyA)).toBe(false);
  });

  it("refuses to mint a key when attachment rows exist without one", async () => {
    const db = freshDb();
    dbs.push(db);
    db.client.prepare("INSERT INTO accounts (id, name, type, created_at, updated_at) VALUES ('a1','A','checking',0,0)").run();
    db.client.prepare("INSERT INTO transactions (id, account_id, date, amount, created_at, updated_at) VALUES ('t1','a1','2026-01-01','1',0,0)").run();
    db.client
      .prepare(
        "INSERT INTO transaction_attachments (id, transaction_id, filename, content_type, size, sha256, created_at) VALUES ('x1','t1','r.pdf','application/pdf',1,'h',0)",
      )
      .run();
    await expect(crypto.ensureDek()).rejects.toBeInstanceOf(crypto.AttachmentKeyMissingError);
  });

  it("refuses to mint a key when ciphertext files exist without one", async () => {
    dbs.push(freshDb());
    profile.id = "restored";
    const dir = join(dataRoot, "attachments", "restored");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "550e8400-e29b-41d4-a716-446655440000.enc"), "x");
    await expect(crypto.ensureDek()).rejects.toBeInstanceOf(crypto.AttachmentKeyMissingError);
  });
});
