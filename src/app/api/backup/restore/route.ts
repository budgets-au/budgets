import { NextResponse } from "next/server";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { withAdminAuth } from "@/lib/api/route-guards";
import {
  backupDir,
  isSafeBackupFilename,
  looksLikeSqlcipher,
  swapLive,
  takeBackup,
  verifyBackup,
} from "@/lib/backup/sqlite-backup";

/**
 * POST /api/backup/restore — replace the live DB with a backup.
 *
 * Two body shapes:
 *   - `application/json`: `{ filename, passphrase }` — restore an
 *     existing backup from the backups dir.
 *   - `multipart/form-data`: `file=<.sqlite>` + `passphrase=<...>` —
 *     restore from an uploaded file the user grabbed from off-server
 *     storage.
 *
 * Flow (same for both shapes):
 *   1. Validate the candidate file is a SQLCipher DB and the
 *      supplied passphrase opens it.
 *   2. Take a `pre-restore` snapshot of the current live DB (so the
 *      user always has an undo).
 *   3. swapLive() — closes the live connection, removes WAL/SHM
 *      siblings, atomic-renames the candidate into the live path.
 *   4. Respond `{ok:true, redirect:"/unlock"}` so the client can send
 *      the user to re-enter the passphrase the backup was taken with.
 *
 * Failure modes:
 *   - 400 for bad input (missing fields, invalid filename, file too
 *     large, doesn't look encrypted).
 *   - 401 for wrong passphrase / corrupt backup.
 *   - 500 if the swap itself fails after validation succeeded — at
 *     this point the pre-restore snapshot is the recovery path.
 */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export const POST = withAdminAuth(async (request) => {
  // Resolve the candidate file path on disk. Existing backups live in
  // backupDir(); uploaded files are written to a temp staging path in
  // the same directory so the eventual swapLive() rename is atomic
  // (same filesystem).
  let candidatePath: string;
  let passphrase: string;
  let cleanupOnFailure: string | null = null;

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const pass = form.get("passphrase");
      if (!(file instanceof File)) {
        return NextResponse.json(
          { ok: false, error: "Missing 'file' field" },
          { status: 400 },
        );
      }
      if (typeof pass !== "string" || pass.length === 0) {
        return NextResponse.json(
          { ok: false, error: "Passphrase is required" },
          { status: 400 },
        );
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { ok: false, error: `File exceeds ${MAX_UPLOAD_BYTES} byte cap` },
          { status: 400 },
        );
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const stagingName = `budgets_pre-restore_upload-${Date.now()}.staging`;
      candidatePath = join(backupDir(), stagingName);
      writeFileSync(candidatePath, buf);
      cleanupOnFailure = candidatePath;
      passphrase = pass;
    } else {
      const body = (await request.json()) as {
        filename?: unknown;
        passphrase?: unknown;
      };
      const filename = body.filename;
      const pass = body.passphrase;
      if (typeof filename !== "string" || !isSafeBackupFilename(filename)) {
        return NextResponse.json(
          { ok: false, error: "Invalid backup filename" },
          { status: 400 },
        );
      }
      if (typeof pass !== "string" || pass.length === 0) {
        return NextResponse.json(
          { ok: false, error: "Passphrase is required" },
          { status: 400 },
        );
      }
      candidatePath = join(backupDir(), filename);
      passphrase = pass;
    }

    // Sanity check the file shape — refuse plaintext SQLite.
    if (!looksLikeSqlcipher(candidatePath)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "File doesn't look like an encrypted SQLCipher database.",
        },
        { status: 400 },
      );
    }

    const verified = verifyBackup(candidatePath, passphrase);
    if (!verified.ok) {
      return NextResponse.json({ ok: false, error: verified.error }, { status: 401 });
    }

    // Take a pre-restore snapshot of the LIVE db before we swap. This
    // is the user's undo path if the new file turns out to be wrong.
    await takeBackup("pre-restore");

    // The actual swap: lock the live connection and rename the
    // candidate file over the live path.
    swapLive(candidatePath);
    // candidatePath has now been moved; clear the cleanup flag.
    cleanupOnFailure = null;

    return NextResponse.json({ ok: true, redirect: "/unlock" });
  } catch (e) {
    // Best-effort cleanup of staging files when something failed
    // before the swap.
    if (cleanupOnFailure) {
      try {
        const { rmSync } = await import("node:fs");
        rmSync(cleanupOnFailure);
      } catch {
        /* ignore */
      }
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
});
