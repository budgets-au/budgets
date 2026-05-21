import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, isAdmin } from "@/lib/auth";

/** Wraps a Next.js route handler with the session check that every
 *  protected endpoint used to copy-paste:
 *  ```
 *  const session = await auth();
 *  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 *  ```
 *  Usage:
 *  ```ts
 *  export const POST = withAuth(async (request) => {
 *    // handler body — auth confirmed before this runs
 *  });
 *  ```
 *  Almost no routes need anything from `session` itself (a handful
 *  of user-management routes read `session.user.id` and stay on the
 *  manual pattern). Skipping a session parameter here keeps the
 *  wrapper free of NextAuth's overloaded return-type gymnastics.
 *
 *  The generic `TCtx` carries the second positional arg Next.js
 *  passes to dynamic routes (e.g. `{ params: Promise<{ id: string }> }`).
 *  For static routes it defaults to `unknown` and callers can ignore
 *  it. */
export function withAuth<TCtx = unknown>(
  handler: (
    request: Request,
    ctx: TCtx,
  ) => Promise<NextResponse> | NextResponse,
) {
  return async (request: Request, ctx: TCtx): Promise<NextResponse> => {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handler(request, ctx);
  };
}

const uuidSchema = z.string().uuid();

/** Wraps a Next.js dynamic `[id]` route with the same auth check
 *  PLUS the UUID parse that every `[id]` handler used to copy-paste:
 *  ```
 *  const { id: rawId } = await params;
 *  const idParse = z.string().uuid().safeParse(rawId);
 *  if (!idParse.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
 *  const id = idParse.data;
 *  ```
 *  Usage:
 *  ```ts
 *  export const GET = withAuthAndId(async (id, request) => {
 *    // handler body — id is guaranteed a valid UUID
 *  });
 *  ``` */
export function withAuthAndId(
  handler: (
    id: string,
    request: Request,
  ) => Promise<NextResponse> | NextResponse,
) {
  return withAuth<{ params: Promise<{ id: string }> }>(
    async (request, ctx) => {
      const { id: rawId } = await ctx.params;
      const parsed = uuidSchema.safeParse(rawId);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
      }
      return handler(parsed.data, request);
    },
  );
}

/** Auth + admin-role gate. Mirror of `withAuth` for the
 *  privileged routes (backup management, user management,
 *  rekey, lock, etc.) that used to call
 *  `if (!isAdmin(session))` after the auth check. */
export function withAdminAuth<TCtx = unknown>(
  handler: (
    request: Request,
    ctx: TCtx,
  ) => Promise<NextResponse> | NextResponse,
) {
  return async (request: Request, ctx: TCtx): Promise<NextResponse> => {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isAdmin(session)) {
      return NextResponse.json(
        { error: "Admin role required" },
        { status: 403 },
      );
    }
    return handler(request, ctx);
  };
}

/** Admin-gated dynamic-id variant — combines `withAdminAuth`
 *  with the UUID parse from `withAuthAndId`. */
export function withAdminAuthAndId(
  handler: (
    id: string,
    request: Request,
  ) => Promise<NextResponse> | NextResponse,
) {
  return withAdminAuth<{ params: Promise<{ id: string }> }>(
    async (request, ctx) => {
      const { id: rawId } = await ctx.params;
      const parsed = uuidSchema.safeParse(rawId);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
      }
      return handler(parsed.data, request);
    },
  );
}

/** Admin-gated variant for routes whose `[id]` segment is a
 *  short profile id (`isValidProfileId` regex —
 *  `/^[a-z0-9][a-z0-9-]{0,39}$/`) rather than a UUID. Routes
 *  under `/api/databases/[id]/...` need this — pre-0.218 they
 *  used `withAdminAuthAndId` which always rejected short ids
 *  as "Invalid id" (so DELETE on any non-default profile was
 *  unreachable, even from the Settings UI).
 *
 *  Light-weight regex inline rather than importing
 *  `isValidProfileId` from db-profiles, because route-guards is
 *  imported by many api/ routes and we want to keep its module
 *  graph minimal. The regex is duplicated; the same shape is
 *  guarded in db-profiles too. */
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export function withAdminAuthAndProfileId(
  handler: (
    id: string,
    request: Request,
  ) => Promise<NextResponse> | NextResponse,
) {
  return withAdminAuth<{ params: Promise<{ id: string }> }>(
    async (request, ctx) => {
      const { id: rawId } = await ctx.params;
      if (typeof rawId !== "string" || !PROFILE_ID_RE.test(rawId)) {
        return NextResponse.json(
          { error: "Invalid profile id" },
          { status: 400 },
        );
      }
      return handler(rawId, request);
    },
  );
}
