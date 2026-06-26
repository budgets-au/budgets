import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/** Test surface: proxy() in src/proxy.ts.
 *
 *  Issue #79: the proxy used to call `auth()` for every non-unlock
 *  request, including /api/*. API routes also re-decode the JWT
 *  inside their `withAuth*` guard — so every API hit was paying
 *  for two JWT verifications. This test pins the fix: proxy()
 *  must skip `auth()` for /api/* and only invoke it on page
 *  routes (where the redirect-to-/login behaviour matters). */

// vi.mock is hoisted to the top of the file, above all imports — local
// variables can't be referenced inside the factory. Use vi.hoisted()
// so the spies are constructed in the hoisted phase too.
const { isUnlockedMock, authSpy } = vi.hoisted(() => ({
  isUnlockedMock: vi.fn<() => boolean>(() => true),
  authSpy: vi.fn(() => new Response(null, { status: 200 })),
}));

vi.mock("@/db", () => ({ isUnlocked: isUnlockedMock }));
vi.mock("@/lib/backup/scheduler", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: authSpy }));

import { proxy } from "./proxy";

afterEach(() => {
  authSpy.mockClear();
  isUnlockedMock.mockReturnValue(true);
});

describe("proxy() — Issue #79: single auth() decode per API hit", () => {
  it("does not call auth() for /api/transactions (uses withAuth guard)", async () => {
    await proxy(new NextRequest("http://localhost:3002/api/transactions"));
    expect(authSpy).not.toHaveBeenCalled();
  });

  it("does not call auth() for /api/auth/[...nextauth] (NextAuth's own handler)", async () => {
    await proxy(
      new NextRequest("http://localhost:3002/api/auth/callback/credentials"),
    );
    expect(authSpy).not.toHaveBeenCalled();
  });

  it("calls auth() for /transactions (page route — needs /login redirect)", async () => {
    await proxy(new NextRequest("http://localhost:3002/transactions"));
    expect(authSpy).toHaveBeenCalledTimes(1);
  });

  it("calls auth() for /dashboard (page route)", async () => {
    await proxy(new NextRequest("http://localhost:3002/dashboard"));
    expect(authSpy).toHaveBeenCalledTimes(1);
  });

  it("skips auth() for /unlock (chicken-and-egg with DB-backed auth)", async () => {
    await proxy(new NextRequest("http://localhost:3002/unlock"));
    expect(authSpy).not.toHaveBeenCalled();
  });

  it("skips auth() for /api/unlock", async () => {
    await proxy(new NextRequest("http://localhost:3002/api/unlock"));
    expect(authSpy).not.toHaveBeenCalled();
  });

  it("skips auth() for /api/databases/* (profile registry — pre-unlock)", async () => {
    await proxy(new NextRequest("http://localhost:3002/api/databases/switch"));
    expect(authSpy).not.toHaveBeenCalled();
  });

  it("redirects to /unlock when DB is locked, regardless of path", async () => {
    isUnlockedMock.mockReturnValue(false);
    const res = await proxy(new NextRequest("http://localhost:3002/api/transactions"));
    expect(authSpy).not.toHaveBeenCalled();
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toMatch(/\/unlock\?next=/);
  });
});
