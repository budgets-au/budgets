import { NextResponse } from "next/server";
import { auth, isAdmin } from "@/lib/auth";
import { lock } from "@/db";

/**
 * Drop the in-memory SQLCipher key by closing the live connection.
 * The next request will see `isUnlocked() === false` and the proxy
 * redirects to /unlock for re-entry of the passphrase.
 *
 * Admin-only — locking the database affects every device on the
 * LAN (everyone gets bounced to /unlock until someone re-enters the
 * passphrase), so it's a household-wide operation, not a personal
 * action. Members can still sign out individually via /api/auth.
 */
export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }
  lock();
  return NextResponse.json({ ok: true });
}
