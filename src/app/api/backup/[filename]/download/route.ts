import { auth, isAdmin } from "@/lib/auth";
import { existsSync, statSync } from "node:fs";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";
import { NextResponse } from "next/server";
import {
  backupDir,
  isSafeBackupFilename,
} from "@/lib/backup/sqlite-backup";

/** GET /api/backup/[filename]/download — stream the raw .sqlite
 * file to the browser. Admin-only — the file is SQLCipher-encrypted
 * but it still represents every household member's data and only
 * the operator who owns the passphrase should be able to take it
 * off the box. */
export async function GET(
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
      { error: "Invalid backup filename" },
      { status: 400 },
    );
  }
  const path = join(backupDir(), filename);
  if (!existsSync(path)) {
    return NextResponse.json({ error: "Backup not found" }, { status: 404 });
  }
  const stat = statSync(path);
  // Convert the Node read stream to a Web ReadableStream so the
  // Next.js handler can return it directly.
  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
