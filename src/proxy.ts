// Renamed from middleware.ts in Next.js 16 — the file convention is now
// `proxy.ts` and the exported function name is `proxy`.
//
// Two responsibilities, in order:
//   1. If the SQLCipher key hasn't been provided yet, redirect every
//      request to /unlock (except /unlock itself + the unlock API +
//      static asset bypass paths). All non-unlock routes need DB
//      access — auth itself reads from the users table — so there's
//      nothing useful they can render before the key lands.
//   2. Otherwise, defer to NextAuth's `auth` middleware, which redirects
//      unauthenticated users to /login.
//
// Next.js's static analyser doesn't pick up `export { auth as proxy }`
// re-exports — it specifically looks for an exported binding named
// `proxy` in the file's source. Define a wrapper so the named export
// is present locally and the lock-check runs first.
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { isUnlocked } from "@/db";
// Eagerly load the scheduler so its singleton setInterval starts at
// server boot, not first request. Side-effect import only.
import "@/lib/backup/scheduler";

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // Routes that have to keep working while the DB is locked: the
  // unlock screen and its API, plus the framework's own static paths
  // (already filtered by the matcher below, but kept here for clarity
  // in case the matcher widens later). The `/api/databases*` routes
  // also bypass the lock since they touch the filesystem registry
  // (not the encrypted DB) — the user needs to be able to switch
  // between profiles or create a new one before unlocking either.
  const isUnlockRoute =
    pathname === "/unlock" ||
    pathname === "/api/unlock" ||
    pathname.startsWith("/api/databases");
  if (!isUnlocked() && !isUnlockRoute) {
    const url = req.nextUrl.clone();
    url.pathname = "/unlock";
    // Round-trip the originally-requested path so the unlock page can
    // hand the user back to where they were aiming.
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  if (isUnlockRoute) {
    // No auth on the unlock route — the auth flow itself reads from
    // the DB, which would be a chicken-and-egg deadlock.
    return NextResponse.next();
  }
  // Otherwise, normal auth.
  return (auth as unknown as (r: NextRequest) => Response | Promise<Response>)(
    req,
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login).*)"],
};
