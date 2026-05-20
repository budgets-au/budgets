import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteBackup,
  isSafeBackupFilename,
  setBackupNotes,
} from "@/lib/backup/sqlite-backup";
import { withAdminAuth, withAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

/** DELETE /api/backup/[filename] — drop a backup file. Admin-only:
 * a backup is a full unencrypted snapshot of every household
 * member's data and dropping one is destructive. The filename is
 * validated against the allowlist regex before any fs operation,
 * so a path-traversal probe (`..%2F..%2Fetc%2Fpasswd`) gets a 400. */
export const DELETE = withAdminAuth<{ params: Promise<{ filename: string }> }>(
  async (_request, { params }) => {
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
  },
);

const patchSchema = z.object({
  notes: z.string().max(2000),
});

/** PATCH /api/backup/[filename] — update the user-supplied notes on
 *  a backup. Stored in a `<filename>.meta.json` sidecar so the
 *  annotation lives outside the encrypted SQLCipher file (readable
 *  without the passphrase + survives swaps). Empty / whitespace-only
 *  notes delete the sidecar. */
export const PATCH = withAuth<{ params: Promise<{ filename: string }> }>(
  async (request, { params }) => {
    const { filename } = await params;
    if (!isSafeBackupFilename(filename)) {
      return NextResponse.json(
        { ok: false, error: "Invalid backup filename" },
        { status: 400 },
      );
    }
    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.ok) return parsed.response;
    try {
      setBackupNotes(filename, parsed.data.notes);
      return NextResponse.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg === "Backup not found" ? 404 : 500;
      return NextResponse.json({ ok: false, error: msg }, { status });
    }
  },
);
