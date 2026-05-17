import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, isAdmin } from "@/lib/auth";
import {
  deleteBackup,
  isSafeBackupFilename,
  setBackupNotes,
} from "@/lib/backup/sqlite-backup";

/** DELETE /api/backup/[filename] — drop a backup file. Admin-only:
 * a backup is a full unencrypted snapshot of every household
 * member's data and dropping one is destructive. The filename is
 * validated against the allowlist regex before any fs operation,
 * so a path-traversal probe (`..%2F..%2Fetc%2Fpasswd`) gets a 400. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }
  const { filename } = await params;
  if (!isSafeBackupFilename(filename)) {
    return NextResponse.json(
      { ok: false, error: "Invalid backup filename" },
      { status: 400 },
    );
  }
  try {
    deleteBackup(filename);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Backup not found" ? 404 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

const patchSchema = z.object({
  notes: z.string().max(2000),
});

/** PATCH /api/backup/[filename] — update the user-supplied notes on
 *  a backup. Stored in a `<filename>.meta.json` sidecar so the
 *  annotation lives outside the encrypted SQLCipher file (readable
 *  without the passphrase + survives swaps). Empty / whitespace-only
 *  notes delete the sidecar. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { filename } = await params;
  if (!isSafeBackupFilename(filename)) {
    return NextResponse.json(
      { ok: false, error: "Invalid backup filename" },
      { status: 400 },
    );
  }
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    setBackupNotes(filename, parsed.data.notes);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Backup not found" ? 404 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
