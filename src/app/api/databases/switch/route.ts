import { NextResponse } from "next/server";
import { z } from "zod";
import { switchProfile } from "@/db";
import { parseJsonBody } from "@/lib/api/parse-body";

// Tighter than the old `z.string().min(1).max(40)` — restricts to the
// profile-id charset that `db-profiles.ts:isValidProfileId` accepts.
// (Issue #89.)
const switchSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
});

/** POST /api/databases/switch — switch the active profile. Locks the
 *  currently-open connection (per the user spec, re-unlock on switch)
 *  and writes the new active id to the registry. The client should
 *  navigate to `/unlock` after this returns so the user enters the
 *  passphrase for the now-active profile.
 *
 *  Deliberately unauthenticated: the /unlock page must be able to call
 *  this when no one is signed in yet (first-time install, or a
 *  household member who hasn't logged in for the first time on this
 *  device). Switching just changes which encrypted file the next
 *  unlock attempt targets; the data in each file stays inaccessible
 *  without its passphrase.
 *
 *  Issue #89: anonymous LAN attackers could previously force-lock the
 *  active DB and steer the profile pointer by hitting this endpoint
 *  with a registered id. We now require the request to be same-origin
 *  (Origin header present + matching). Browser semantics enforce this
 *  on cross-origin POSTs — Origin is mandatory on POST and cross-origin
 *  callers can't spoof it. Direct curl from the host can still call
 *  the endpoint (no Origin header), which is correct for the LAN-trust
 *  model: the threat surface is hostile browsers on the LAN, not
 *  scripts running on the operator's own machine. */
export async function POST(request: Request) {
  if (!isSameOriginPost(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed for this endpoint." },
      { status: 403 },
    );
  }
  const parsed = await parseJsonBody(request, switchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    switchProfile(parsed.data.id);
    return NextResponse.json({ ok: true, redirect: "/unlock" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/** Allow when Origin is absent (curl / server-to-server inside the
 *  trust boundary) OR when Origin matches the request's own host
 *  (legit same-origin browser POST). Reject every other case — a
 *  cross-origin browser POST from `evil.lan` would set Origin to that
 *  host, and we reject. */
function isSameOriginPost(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const reqUrl = new URL(request.url);
    const originUrl = new URL(origin);
    return reqUrl.host === originUrl.host;
  } catch {
    return false;
  }
}
