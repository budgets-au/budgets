import { beforeEach, describe, expect, it, vi } from "vitest";

const db = { unlocked: true, switched: [] as string[] };
const session = { value: null as null | { user: { role: string } } };

vi.mock("@/db", () => ({
  isUnlocked: () => db.unlocked,
  switchProfile: (id: string) => {
    if (id === "missing") throw new Error("Unknown profile id: missing (internal detail)");
    db.switched.push(id);
  },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => session.value }));
vi.mock("@/lib/api/api-key", () => ({ readBearerToken: () => null, verifyBearer: async () => null }));

const { POST } = await import("./route");

function req(body: unknown, origin?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", host: "budgets.lan" };
  if (origin) headers.origin = origin;
  return new Request("http://budgets.lan/api/databases/switch", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/databases/switch", () => {
  beforeEach(() => {
    db.unlocked = true;
    db.switched = [];
    session.value = null;
  });

  it("rejects an anonymous caller while the DB is unlocked (no force-lock)", async () => {
    const res = await POST(req({ id: "other" }));
    expect(res.status).toBe(401);
    expect(db.switched).toEqual([]);
  });

  it("allows a signed-in caller while unlocked", async () => {
    session.value = { user: { role: "member" } };
    const res = await POST(req({ id: "other" }, "http://budgets.lan"));
    expect(res.status).toBe(200);
    expect(db.switched).toEqual(["other"]);
  });

  it("allows an anonymous caller while locked (the /unlock page flow)", async () => {
    db.unlocked = false;
    const res = await POST(req({ id: "other" }, "http://budgets.lan"));
    expect(res.status).toBe(200);
  });

  it("still rejects a cross-origin browser POST", async () => {
    db.unlocked = false;
    const res = await POST(req({ id: "other" }, "http://evil.lan"));
    expect(res.status).toBe(403);
  });

  it("does not echo internal error text", async () => {
    db.unlocked = false;
    const res = await POST(req({ id: "missing" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(JSON.stringify(body)).not.toContain("internal detail");
  });
});
