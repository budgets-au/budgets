import { existsSync, statSync } from "node:fs";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";
import { NextResponse } from "next/server";
import {
  backupDir,
  isSafeBackupFilename,
} from "@/lib/backup/sqlite-backup";
import { withAdminAuth } from "@/lib/api/route-guards";

/** GET /api/backup/[filename]/download — stream the raw .sqlite
 * file to the browser. Admin-only — the file is SQLCipher-encrypted
 * but it still represents every household member's data and only
 * the operator who owns the passphrase should be able to take it
 * off the box. */
export const GET = withAdminAuth<{ params: Promise<{ filename: string }> }>(
  async (_request, { params }) => {
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
  },
);
