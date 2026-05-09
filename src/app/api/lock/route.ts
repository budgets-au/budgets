import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { lock } from "@/db";

/**
 * Drop the in-memory SQLCipher key by closing the live connection.
 * The next request will see `isUnlocked() === false` and the proxy
 * redirects to /unlock for re-entry of the passphrase.
 *
 * Auth-gated — only an authenticated session can lock. This is
 * deliberately stricter than /api/unlock (which can't be auth-gated
 * because auth itself reads from the DB): once locked, getting back
 * in requires the passphrase, but until you lock the live process
 * has the key in memory and a logged-in user is the only person
 * authorised to drop it.
 */
export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  lock();
  return NextResponse.json({ ok: true });
}
