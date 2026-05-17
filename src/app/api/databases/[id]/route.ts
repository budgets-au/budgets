import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, isAdmin } from "@/lib/auth";
import { isValidProfileId, renameProfile } from "@/lib/db-profiles";

const patchSchema = z.object({
  label: z.string().min(1).max(80),
});

/** PATCH /api/databases/[id] — rename a profile's display label.
 *  Admin-only; the registry file is plaintext metadata, but only
 *  the operator should be re-labelling profiles. Filename / id
 *  are immutable post-create (the on-disk file is named after
 *  the id; renaming the file would orphan backups). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }
  const { id } = await params;
  if (!isValidProfileId(id)) {
    return NextResponse.json(
      { error: "Invalid profile id" },
      { status: 400 },
    );
  }
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const updated = renameProfile(id, parsed.data.label);
    return NextResponse.json({ ok: true, profile: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
