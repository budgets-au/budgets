import { NextResponse } from "next/server";
import { rmSync, existsSync } from "node:fs";
import { z } from "zod";
import {
  archiveProfile,
  deleteProfile,
  isValidProfileId,
  pathForProfile,
  readRegistry,
  renameProfile,
} from "@/lib/db-profiles";
import { backupDirForProfile } from "@/lib/backup/sqlite-backup";
import { withAdminAuthAndProfileId } from "@/lib/api/route-guards";
import { badRequest, parseJsonBody } from "@/lib/api/parse-body";

const patchSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  archived: z.boolean().optional(),
});

/** PATCH /api/databases/[id] — rename a profile's display label
 *  and/or toggle its archived flag. Admin-only; the registry file
 *  is plaintext metadata, but only the operator should be
 *  re-labelling profiles. Filename / id are immutable post-create
 *  (the on-disk file is named after the id; renaming the file
 *  would orphan backups). */
export const PATCH = withAdminAuthAndProfileId(async (id, request) => {
  if (!isValidProfileId(id)) {
    return NextResponse.json(
      { error: "Invalid profile id" },
      { status: 400 },
    );
  }
  const parsed = await parseJsonBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;
  if (parsed.data.label === undefined && parsed.data.archived === undefined) {
    return badRequest("At least one of label or archived must be supplied");
  }
  try {
    let updated;
    if (parsed.data.label !== undefined) {
      updated = renameProfile(id, parsed.data.label);
    }
    if (parsed.data.archived !== undefined) {
      updated = archiveProfile(id, parsed.data.archived);
    }
    return NextResponse.json({ ok: true, profile: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
});

/** DELETE /api/databases/[id] — permanently remove a profile, its
 *  encrypted SQLCipher file, and its per-profile backup subdir.
 *  Admin-only. Server-side guards: the active profile is rejected
 *  (caller must switch first); the last remaining profile is
 *  rejected (the app needs at least one DB to talk to). */
export const DELETE = withAdminAuthAndProfileId(async (id, request) => {
  if (!isValidProfileId(id)) {
    return NextResponse.json(
      { error: "Invalid profile id" },
      { status: 400 },
    );
  }
  // Resolve paths BEFORE mutating the registry so we know where to
  // sweep even after the profile entry is gone. The registry guards
  // (active, last) run inside deleteProfile and throw on violation —
  // those throws return 400 below and the filesystem is untouched.
  const reg = readRegistry();
  const target = reg.profiles.find((p) => p.id === id);
  if (!target) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 404 });
  }
  const filePath = pathForProfile(target);
  const backupSubdir = backupDirForProfile(target.id);
  try {
    const removed = deleteProfile(id);
    // Best-effort filesystem sweep. A failure here logs but doesn't
    // fail the API call — the registry has already moved on, and an
    // orphaned file is a minor inconvenience the operator can mop up
    // manually; rolling back the registry write would be messier.
    try {
      if (existsSync(filePath)) rmSync(filePath, { force: true });
    } catch (e) {
      console.error(`[databases] failed to delete file ${filePath}:`, e);
    }
    try {
      if (existsSync(backupSubdir)) {
        rmSync(backupSubdir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error(
        `[databases] failed to delete backup dir ${backupSubdir}:`,
        e,
      );
    }
    return NextResponse.json({ ok: true, profile: removed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
});
