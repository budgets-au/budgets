import { NextResponse } from "next/server";
import { z } from "zod";
import { switchProfile } from "@/db";
import { parseJsonBody } from "@/lib/api/parse-body";

const switchSchema = z.object({
  id: z.string().min(1).max(40),
});

/** POST /api/databases/switch — switch the active profile. Locks the
 *  currently-open connection (per the user spec, re-unlock on switch)
 *  and writes the new active id to the registry. The client should
 *  navigate to `/unlock` after this returns so the user enters the
 *  passphrase for the now-active profile.
 *
 *  Public (no auth) so the /unlock page can call it. Switching just
 *  changes which encrypted file the next unlock attempt targets; the
 *  data in each file stays inaccessible without its passphrase. */
export async function POST(request: Request) {
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
