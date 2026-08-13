import { beforeEach, describe, expect, it, vi } from "vitest";

/** Mock the auth module so each test can flip the "logged in" /
 *  "admin" stubs without spinning up NextAuth. `vi.hoisted` puts the
 *  shared state object above the `vi.mock` factory so the factory's
 *  closure can read it.
 *
 *  Note: the admin check inside route-guards is inlined
 *  (`session.user.role === "admin"`) since the split-out helper
 *  from @/lib/auth added a mock-surface gotcha for every test file
 *  that stubs `auth()`. So the `isAdminResult` flag is derived from
 *  the session's role here — bump the session's `user.role` between
 *  "member" and "admin" to move through the guard tiers. */
const mocks = vi.hoisted(() => ({
  session: null as { user?: { role?: string } } | null,
  isAdminResult: false,
  // Bearer path: set to `null` for no bearer, or `{ role, scope }`
  // for a valid one. Ignored when no `authorization: bearer` header
  // is present on the request.
  bearerResult: null as
    | { id: string; role: string; scope: string }
    | null,
}));

vi.mock("@/lib/auth", () => ({
  auth: () => Promise.resolve(mocks.session),
}));

vi.mock("./api-key", () => ({
  readBearerToken: (r: Request) => {
    const h = r.headers.get("authorization");
    if (!h) return null;
    const [scheme, ...rest] = h.split(" ");
    if (scheme.toLowerCase() !== "bearer" || rest.length === 0) return null;
    return rest.join(" ").trim() || null;
  },
  verifyBearer: async () => mocks.bearerResult,
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
  mocks.bearerResult = null;
});

/** Build a request that carries a Bearer token so the guard's
 *  bearer-path fires. Body of the token is opaque — the mock
 *  `verifyBearer` returns whatever `mocks.bearerResult` is. */
const opsReq = (path: string) =>
  new Request(`http://test.local${path}`, {
    headers: { authorization: "Bearer bk_test" },
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

  it("ops-scoped bearer → 200 on allowlisted path", async () => {
    mocks.bearerResult = { id: "k1", role: "admin", scope: "ops" };
    const { NextResponse } = await import("next/server");
    const handler = vi
      .fn()
      .mockImplementation(async () => NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);
    const res = await wrapped(opsReq("/api/health"), {});
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ops-scoped bearer → 403 on non-allowlisted path", async () => {
    mocks.bearerResult = { id: "k1", role: "admin", scope: "ops" };
    const handler = vi.fn();
    const wrapped = withAuth(handler);
    const res = await wrapped(opsReq("/api/accounts"), {});
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Scope does not permit this endpoint",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("full-scoped bearer → 200 on any path", async () => {
    mocks.bearerResult = { id: "k1", role: "admin", scope: "full" };
    const { NextResponse } = await import("next/server");
    const handler = vi
      .fn()
      .mockImplementation(async () => NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);
    const res = await wrapped(opsReq("/api/accounts"), {});
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("invalid bearer → 401, does NOT fall back to session", async () => {
    // Even a valid session is ignored when a bearer is presented:
    // the request has committed to the API-key flow.
    mocks.bearerResult = null;
    mocks.session = { user: { role: "admin" } };
    const handler = vi.fn();
    const wrapped = withAuth(handler);
    const res = await wrapped(opsReq("/api/health"), {});
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
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
    mocks.session = { user: { role: "admin" } };
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
    mocks.session = { user: { role: "admin" } };
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
