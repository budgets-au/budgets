import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb, installTestDb, type TestDb } from "@/__tests__/golden/_helpers/test-db";
import { testAuth } from "@/__tests__/golden/_helpers/auth-mock";

const root = mkdtempSync(join(tmpdir(), "att-int-"));
vi.mock("@/lib/auth", () => ({ auth: testAuth }));
vi.mock("@/lib/db-profiles", () => ({
  getActiveProfile: () => ({ id: "default" }),
  dataDir: () => root,
}));

type Ctx<T> = { params: Promise<T> };
type Handler<T> = (req: Request, ctx: Ctx<T>) => Promise<Response>;

const ACCT = randomUUID();
const TXN = randomUUID();
const profileDir = join(root, "attachments", "default");
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 7)]);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function upload(name: string, type: string, bytes: Buffer): Request {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type }));
  return new Request(`http://t/api/transactions/${TXN}/attachments`, { method: "POST", body: form });
}

describe("receipt attachments round-trip", () => {
  let db: TestDb;
  let POST: Handler<{ id: string }>;
  let GET_ONE: Handler<{ id: string; attId: string }>;
  let DELETE_TXN: Handler<{ id: string }>;
  let sweep: typeof import("@/lib/attachments/cleanup").sweepOrphanAttachmentFiles;

  beforeAll(async () => {
    process.env.ATTACHMENTS_PATH = join(root, "attachments");
    db = createTestDb();
    installTestDb(db);
    db.client.prepare("INSERT INTO accounts (id, name, type, created_at, updated_at) VALUES (?, 'A', 'checking', 0, 0)").run(ACCT);
    db.client.prepare("INSERT INTO transactions (id, account_id, date, amount, created_at, updated_at) VALUES (?, ?, '2026-01-01', '-5', 0, 0)").run(TXN, ACCT);
    POST = (await import("./route")).POST as unknown as Handler<{ id: string }>;
    GET_ONE = (await import("./[attId]/route")).GET as unknown as Handler<{ id: string; attId: string }>;
    DELETE_TXN = (await import("../route")).DELETE as unknown as Handler<{ id: string }>;
    sweep = (await import("@/lib/attachments/cleanup")).sweepOrphanAttachmentFiles;
  });
  afterAll(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
    delete process.env.ATTACHMENTS_PATH;
  });

  let attId = "";

  it("stores an encrypted file and returns the plaintext on GET", async () => {
    const res = await POST(upload("receipt.png", "image/png", png), { params: Promise.resolve({ id: TXN }) });
    expect(res.status).toBe(201);
    attId = (await res.json()).attachment.id;
    const onDisk = readdirSync(profileDir);
    expect(onDisk).toEqual([`${attId}.enc`]);

    const got = await GET_ONE(new Request(`http://t/x`), { params: Promise.resolve({ id: TXN, attId }) });
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(got.headers.get("x-content-type-options")).toBe("nosniff");
    expect(sha(Buffer.from(await got.arrayBuffer()))).toBe(sha(png));
  });

  it("rejects HTML disguised as an image", async () => {
    const res = await POST(upload("x.png", "image/png", Buffer.from("<html><script>1</script>")), {
      params: Promise.resolve({ id: TXN }),
    });
    expect(res.status).toBe(415);
  });

  it("sweeps files that have no row and keeps live ones", async () => {
    const orphan = join(profileDir, `${randomUUID()}.enc`);
    writeFileSync(orphan, "stale");
    expect(await sweep()).toEqual({ removed: 1 });
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(join(profileDir, `${attId}.enc`))).toBe(true);
  });

  it("deleting the transaction removes its receipt file from disk", async () => {
    const res = await DELETE_TXN(new Request(`http://t/x`, { method: "DELETE" }), {
      params: Promise.resolve({ id: TXN }),
    });
    expect(res.status).toBe(200);
    expect(readdirSync(profileDir)).toEqual([]);
  });
});
