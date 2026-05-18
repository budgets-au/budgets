import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, isAdmin } from "@/lib/auth";
import {
  initProfileFile,
  isUnlocked,
  switchProfile,
  unlock,
} from "@/db";
import {
  createProfile,
  getActiveProfile,
  readRegistry,
} from "@/lib/db-profiles";

/** GET /api/databases — list every profile + which one is currently
 *  active. Public (no auth) so the /unlock page can render the
 *  switcher before the operator has signed in. The data exposed
 *  (labels chosen by the operator + the active pointer) isn't
 *  sensitive; only filenames could conceivably leak data-volume
 *  layout, which is uninteresting on a self-hosted single-tenant
 *  app. */
export async function GET() {
  const reg = readRegistry();
  return NextResponse.json({
    profiles: reg.profiles.map((p) => ({
      id: p.id,
      label: p.label,
      filename: p.filename,
      createdAt: p.createdAt,
      archived: p.archived === true,
    })),
    activeProfileId: reg.activeProfileId,
    activeProfile: getActiveProfile(),
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
export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
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
    return NextResponse.json(
      { error: `Profile registered but file init failed: ${init.error}` },
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
}
