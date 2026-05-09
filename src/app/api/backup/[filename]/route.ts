import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deleteBackup, isSafeBackupFilename } from "@/lib/backup/sqlite-backup";

/** DELETE /api/backup/[filename] — drop a backup file. The filename
 * is validated against the allowlist regex before any fs operation,
 * so a path-traversal probe (`..%2F..%2Fetc%2Fpasswd`) gets a 400. */
export async function DELETE(
  _request: Request,
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
  try {
    deleteBackup(filename);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Backup not found" ? 404 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
