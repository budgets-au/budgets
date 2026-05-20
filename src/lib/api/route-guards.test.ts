import { beforeEach, describe, expect, it, vi } from "vitest";

/** Mock the auth module so each test can flip the "logged in" /
 *  "admin" stubs without spinning up NextAuth. `vi.hoisted` puts the
 *  shared state object above the `vi.mock` factory so the factory's
 *  closure can read it. */
const mocks = vi.hoisted(() => ({
  session: null as { user?: { role?: string } } | null,
  isAdminResult: false,
}));

vi.mock("@/lib/auth", () => ({
  auth: () => Promise.resolve(mocks.session),
  isAdmin: () => mocks.isAdminResult,
}));

// Imports AFTER the mock so they pick up the stubbed module.
import {
  withAuth,
  withAuthAndId,
  withAdminAuth,
  withAdminAuthAndId,
} from "./route-guards";

const fakeReq = () => new Request("http://test.local/");
const validUuid = "123e4567-e89b-12d3-a456-426614174000";

beforeEach(() => {
  mocks.session = null;
  mocks.isAdminResult = false;
});

describe("withAuth", () => {
  it("returns 401 when no session", async () => {
    const handler = vi.fn();
    const wrapped = withAuth(handler);
    const res = await wrapped(fakeReq(), {});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the inner handler when session present", async () => {
    mocks.session = { user: { role: "member" } };
    const { NextResponse } = await import("next/server");
    const handler = vi
      .fn()
      .mockImplementation(async () => NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);
    const res = await wrapped(fakeReq(), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("withAuthAndId", () => {
  it("returns 400 when the id segment isn't a UUID", async () => {
    mocks.session = { user: { role: "member" } };
    const handler = vi.fn();
    const wrapped = withAuthAndId(handler);
    const res = await wrapped(fakeReq(), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid id" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 401 when not logged in (auth gate runs before UUID parse)", async () => {
    mocks.session = null;
    const handler = vi.fn();
    const wrapped = withAuthAndId(handler);
    const res = await wrapped(fakeReq(), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes the validated id to the handler", async () => {
    mocks.session = { user: { role: "member" } };
    const { NextResponse } = await import("next/server");
    const handler = vi
      .fn()
      .mockImplementation(async (id: string) => NextResponse.json({ id }));
    const wrapped = withAuthAndId(handler);
    const res = await wrapped(fakeReq(), {
      params: Promise.resolve({ id: validUuid }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: validUuid });
    expect(handler.mock.calls[0][0]).toBe(validUuid);
  });
});

describe("withAdminAuth", () => {
  it("returns 401 when no session (auth gate fires first)", async () => {
    const handler = vi.fn();
    const wrapped = withAdminAuth(handler);
    const res = await wrapped(fakeReq(), {});
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when session exists but user isn't admin", async () => {
    mocks.session = { user: { role: "member" } };
    mocks.isAdminResult = false;
    const handler = vi.fn();
    const wrapped = withAdminAuth(handler);
    const res = await wrapped(fakeReq(), {});
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Admin role required" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the inner handler when session + admin", async () => {
    mocks.session = { user: { role: "admin" } };
    mocks.isAdminResult = true;
    const { NextResponse } = await import("next/server");
    const handler = vi
      .fn()
      .mockImplementation(async () => NextResponse.json({ ok: true }));
    const wrapped = withAdminAuth(handler);
    const res = await wrapped(fakeReq(), {});
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("withAdminAuthAndId", () => {
  it("combines admin + id gates: 401 → 403 → 400 → 200 order", async () => {
    const handler = vi.fn().mockImplementation(async (id) => {
      const { NextResponse } = await import("next/server");
      return NextResponse.json({ id });
    });
    const wrapped = withAdminAuthAndId(handler);

    // No session → 401, no inner call
    mocks.session = null;
    let res = await wrapped(fakeReq(), {
      params: Promise.resolve({ id: validUuid }),
    });
    expect(res.status).toBe(401);

    // Session but not admin → 403
    mocks.session = { user: { role: "member" } };
    mocks.isAdminResult = false;
    res = await wrapped(fakeReq(), {
      params: Promise.resolve({ id: validUuid }),
    });
    expect(res.status).toBe(403);

    // Admin but bad id → 400
    mocks.isAdminResult = true;
    res = await wrapped(fakeReq(), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);

    expect(handler).not.toHaveBeenCalled();

    // Admin + valid id → handler runs
    res = await wrapped(fakeReq(), {
      params: Promise.resolve({ id: validUuid }),
    });
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toBe(validUuid);
  });
});
