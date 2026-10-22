import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminCaller, withAdminAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";
import {
  initProfileFile,
  isUnlocked,
  switchProfile,
  unlock,
} from "@/db";
import {
  createProfile,
  deleteProfile,
  getActiveProfile,
  readRegistry,
} from "@/lib/db-profiles";

/** GET /api/databases — list every profile + which one is currently
 *  active. Public so the /unlock page (and the sidebar switcher for
 *  non-admins) can render the switcher before / without admin rights.
 *  Anonymous and non-admin callers get ids + labels only; filenames and
 *  creation dates are admin-only (Settings → Database files). */
export async function GET(request: Request) {
  const admin = await isAdminCaller(request);
  const reg = readRegistry();
  const pick = (p: (typeof reg.profiles)[number]) => ({
    id: p.id,
    label: p.label,
    archived: p.archived === true,
    ...(admin ? { filename: p.filename, createdAt: p.createdAt } : {}),
  });
  return NextResponse.json({
    profiles: reg.profiles.map(pick),
    activeProfileId: reg.activeProfileId,
    activeProfile: pick(getActiveProfile()),
    unlocked: isUnlocked(),
  });
}

const createSchema = z.object({
  label: z.string().min(1).max(80),
  passphrase: z.string().min(1),
});

/** POST /api/databases — register a new profile + create its
 *  SQLCipher file with the supplied passphrase. Admin-only since it
 *  writes a new file to the data volume + commits migrations. The
 *  new profile becomes ACTIVE on success; the response signals the
 *  client to redirect to `/unlock` so the operator re-enters the
 *  same passphrase against the freshly-created file. */
export const POST = withAdminAuth(async (request) => {
  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;
  const { label, passphrase } = parsed.data;

  let profileId: string;
  try {
    const profile = createProfile(label);
    profileId = profile.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const init = initProfileFile(profileId, passphrase);
  if (!init.ok) {
    // Roll the registry entry back so the operator can retry with the
    // same label — without this, the failed create leaves an
    // orphaned profile and the next attempt hits the
    // duplicate-label guard in createProfile.
    try {
      deleteProfile(profileId);
    } catch (e) {
      console.error(
        `[databases] failed to roll back orphan profile ${profileId}:`,
        e,
      );
    }
    return NextResponse.json(
      { error: `Failed to initialise database: ${init.error}` },
      { status: 500 },
    );
  }

  // Switch the active pointer + drop the current connection so
  // `unlock()` opens the new file (not the previously-active one).
  try {
    switchProfile(profileId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Created but failed to switch: ${msg}` },
      { status: 500 },
    );
  }

  // Auto-unlock the freshly-created file with the same passphrase the
  // operator just supplied — saves them from re-typing on the next
  // page load. The key still lives only in this process's memory;
  // the JSON body never echoes the passphrase back.
  const u = unlock(passphrase);
  if (!u.ok) {
    return NextResponse.json(
      {
        error: `Created and switched, but auto-unlock failed: ${u.error}. Visit /unlock to retry.`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    profileId,
    redirect: "/dashboard",
  });
});
