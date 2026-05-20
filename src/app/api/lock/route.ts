import { NextResponse } from "next/server";
import { lock } from "@/db";
import { withAdminAuth } from "@/lib/api/route-guards";

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
export const POST = withAdminAuth(async () => {
  lock();
  return NextResponse.json({ ok: true });
});
